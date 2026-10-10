"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, MapPin, RefreshCw } from "lucide-react";
import { api, Center } from "@/lib/api";
import { Coordinates, formatDistance } from "@/lib/location";
import {
  loadGoogleMaps,
  nearbyPlaces,
  mergeRegisteredPlaces,
  NearbyPlace,
  googleDirections,
  safeProviderUrl,
} from "@/lib/google-maps";

type Props = {
  position: Coordinates;
  accuracy: number | null;
  positionLabel?: string | null;
  centers: Center[];
  selected: string;
  disabled: boolean;
  onSelect: (id: string) => void;
};
export default function GoogleCenterMap({
  position,
  accuracy,
  positionLabel,
  centers,
  selected,
  disabled,
  onSelect,
}: Props) {
  const canvas = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const accuracyCircle = useRef<google.maps.Circle | null>(null);
  const lastFit = useRef("");
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [radius, setRadius] = useState(10000);
  const [unavailableIds, setUnavailableIds] = useState<string[]>([]);
  const results = useMemo(
    () =>
      mergeRegisteredPlaces(places, centers, position, radius, unavailableIds),
    [places, centers, position, radius, unavailableIds],
  );
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState("");
  const [ready, setReady] = useState(false);
  const [searched, setSearched] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    const fail = () => {
      setError(
        "Google Maps is unavailable. The site operator needs to check the Google API key, enabled services, and billing.",
      );
      setPlaces([]);
      setReady(false);
      setBusy(false);
    };
    window.addEventListener("loopmint-maps-auth-error", fail);
    return () => window.removeEventListener("loopmint-maps-auth-error", fail);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    setPlaces([]);
    setSearched(false);
    setActive("");
    async function search() {
      try {
        const config = await api<{ api_key: string; map_id: string }>(
          "/maps/config",
        );
        if (cancelled) return;
        if (!config.api_key)
          throw new Error(
            "Google Maps is not configured yet. Please contact the site operator.",
          );
        await loadGoogleMaps(config.api_key);
        const [{ Map }, { Place }] = await Promise.all([
          google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
          google.maps.importLibrary(
            "places",
          ) as Promise<google.maps.PlacesLibrary>,
          google.maps.importLibrary("marker"),
        ]);
        if (cancelled || !canvas.current) return;
        const center = { lat: position.latitude, lng: position.longitude };
        if (!map.current)
          map.current = new Map(canvas.current, {
            center,
            zoom: 13,
            mapId: config.map_id || "DEMO_MAP_ID",
            mapTypeControl: false,
            streetViewControl: false,
            gestureHandling: "cooperative",
          });
        map.current.setCenter(center);
        setReady(true);
        // Recycling is not a supported Places type. Text Search finds actual listings.
        const result = await Promise.race([
          Place.searchByText({
            textQuery: "recycling center",
            fields: [
              "id",
              "displayName",
              "formattedAddress",
              "location",
              "businessStatus",
              "attributions",
            ],
            locationBias: { center, radius },
            rankPreference: "DISTANCE",
            maxResultCount: 20,
          }),
          new Promise<never>((_, reject) => {
            searchTimer = setTimeout(
              () =>
                reject(new Error("Nearby search timed out. Please try again.")),
              15000,
            );
          }),
        ]);
        if (cancelled) return;
        setUnavailableIds(
          result.places
            .filter((p) => p.businessStatus === "CLOSED_PERMANENTLY")
            .map((p) => p.id)
            .filter((id): id is string => !!id),
        );
        setPlaces(nearbyPlaces(result.places, position, radius));
        setSearched(true);
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error &&
              (e.message.startsWith("Google Maps") ||
                e.message.startsWith("Nearby search"))
              ? e.message
              : "Google Places search is unavailable. Try again later; the site operator can check API access and billing.",
          );
      } finally {
        if (searchTimer) clearTimeout(searchTimer);
        if (!cancelled) setBusy(false);
      }
    }
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    void search();
    return () => {
      cancelled = true;
      if (searchTimer) clearTimeout(searchTimer);
    };
  }, [position, radius, retry]);

  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach((marker) => {
      marker.map = null;
    });
    markers.current = [];
    accuracyCircle.current?.setMap(null);
    const currentMap = map.current;
    const origin = { lat: position.latitude, lng: position.longitude };
    function marker(
      location: google.maps.LatLngLiteral,
      title: string,
      label: string,
      color: string,
      click?: () => void,
    ) {
      const pin = document.createElement("span");
      pin.className = "google-pin";
      pin.textContent = label;
      pin.style.backgroundColor = color;
      const value = new google.maps.marker.AdvancedMarkerElement({
        map: currentMap,
        position: location,
        title,
        content: pin,
      });
      if (click) value.addListener("click", click);
      markers.current.push(value);
    }
    marker(
      origin,
      positionLabel ? `Search area: ${positionLabel}` : "Your current location",
      positionLabel ? "Area" : "You",
      "#2767bf",
    );
    if (accuracy !== null && accuracy >= 0)
      accuracyCircle.current = new google.maps.Circle({
        map: currentMap,
        center: origin,
        radius: accuracy,
        strokeColor: "#2767bf",
        strokeOpacity: 0.4,
        fillColor: "#2767bf",
        fillOpacity: 0.08,
        clickable: false,
      });
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(origin);
    results.forEach((place, index) => {
      const location = {
        lat: place.location.latitude,
        lng: place.location.longitude,
      };
      marker(
        location,
        place.name,
        place.registeredListing ? "L" : String(index + 1),
        place.id === active
          ? "#173e35"
          : place.registeredCenterId
            ? "#668440"
            : "#7d582a",
        () => {
          setActive(place.id);
          if (place.registeredCenterId && !disabledRef.current)
            selectRef.current(place.registeredCenterId);
        },
      );
      bounds.extend(location);
    });
    const fitKey = JSON.stringify([
      position,
      radius,
      results.map((p) => [p.id, p.location]),
    ]);
    if (lastFit.current !== fitKey) {
      if (markers.current.length > 1) currentMap.fitBounds(bounds, 45);
      else currentMap.setZoom(13);
      lastFit.current = fitKey;
    }
    return () => {
      markers.current.forEach((marker) => {
        marker.map = null;
      });
      accuracyCircle.current?.setMap(null);
    };
  }, [
    ready,
    results,
    centers,
    selected,
    position,
    accuracy,
    radius,
    active,
    positionLabel,
  ]);

  return (
    <section
      className="google-discovery"
      aria-label="Nearby recycling on Google Maps"
    >
      <div className="google-map-heading">
        <h3>
          <MapPin size={18} />{" "}
          {positionLabel ? "Recycling near this area" : "Recycling near you"}
        </h3>
        <label>
          Search radius
          <select
            aria-label="Google search radius"
            value={radius}
            disabled={busy || disabled}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {[5000, 10000, 25000, 50000].map((n) => (
              <option key={n} value={n}>
                {n / 1000} km
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        ref={canvas}
        className={`google-map-canvas ${ready || busy ? "" : "map-unavailable"}`}
        aria-label={
          positionLabel
            ? "Map of selected area and recycling centers"
            : "Map of your location and recycling centers"
        }
      />
      <p className="google-map-legend">
        Blue: {positionLabel ? "selected search area" : "your location"} ·
        Numbers: Google results · L: LoopMint centers
      </p>
      {positionLabel && (
        <p className="small muted">
          Searching around {positionLabel}. This is your selected area, not a
          detected device location.
        </p>
      )}
      {busy && (
        <p role="status" className="small muted">
          Finding real recycling centers on Google Maps…
        </p>
      )}
      {error && (
        <p role="alert" className="location-warning">
          {error}
        </p>
      )}
      {!busy && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => setRetry((n) => n + 1)}
        >
          <RefreshCw size={14} />{" "}
          {error ? "Retry Google search" : "Refresh nearby results"}
        </button>
      )}
      {!busy && !error && searched && !results.length && (
        <p className="small muted">
          No recycling listings were returned within {radius / 1000} km. Try a
          larger radius. Google may not list every facility.
        </p>
      )}
      {!!results.length && (
        <>
          <p className="small muted">
            Registered centers and Google Maps listings, ordered by
            straight-line distance. Confirm opening hours and accepted materials
            before traveling.
          </p>
          <ol className="google-place-list">
            {results.map((place, index) => {
              const enrolled = centers.find(
                (c) => !c.is_demo && c.id === place.registeredCenterId,
              );
              return (
                <li
                  key={place.id}
                  className={active === place.id ? "active" : ""}
                >
                  <button
                    type="button"
                    className="google-place-title"
                    onClick={() => {
                      setActive(place.id);
                      map.current?.panTo({
                        lat: place.location.latitude,
                        lng: place.location.longitude,
                      });
                    }}
                  >
                    <span>{index + 1}</span>
                    {place.name}
                  </button>
                  <p>{place.address}</p>
                  <strong className="small">
                    {formatDistance(place.distance)}
                    {index === 0
                      ? accuracy !== null &&
                        results.length > 1 &&
                        (results[1].distance - place.distance) * 1000 <=
                          2 * accuracy
                        ? " · Similar distance to next result; location accuracy may change the order"
                        : " · Closest result"
                      : ""}
                  </strong>
                  <p
                    className="small muted"
                    id={`ticket-availability-${place.id}`}
                  >
                    {enrolled
                      ? "LoopMint participating center"
                      : "Not enrolled in LoopMint — center setup is required before tickets can be created."}
                  </p>
                  <div className="button-row">
                    <a
                      href={googleDirections(place)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-button"
                    >
                      Directions <ExternalLink size={13} />
                    </a>
                    <button
                      type="button"
                      className="button secondary small-button"
                      disabled={disabled || !enrolled}
                      aria-describedby={`ticket-availability-${place.id}`}
                      onClick={() => enrolled && onSelect(enrolled.id)}
                    >
                      {enrolled && selected === enrolled.id
                        ? "Selected for ticket"
                        : "Use for my ticket"}
                    </button>
                  </div>
                  {place.attributions.map((a, i) => (
                    <small key={i} className="google-attribution">
                      {safeProviderUrl(a.providerURI) ? (
                        <a
                          href={safeProviderUrl(a.providerURI)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {a.provider}
                        </a>
                      ) : (
                        a.provider
                      )}
                    </small>
                  ))}
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
