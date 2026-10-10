"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  MapPin,
  Navigation,
  Search,
  LoaderCircle,
  X,
} from "lucide-react";
import type { Center } from "@/lib/api";
import {
  Coordinates,
  directionsUrl,
  formatDistance,
  rankCenters,
  validCoordinates,
} from "@/lib/location";

type Props = {
  centers: Center[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  onLocatingChange: (locating: boolean) => void;
};

export default function CenterPicker({
  centers,
  value,
  onChange,
  disabled,
  onLocatingChange,
}: Props) {
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const request = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestCenters = useRef(centers);
  latestCenters.current = centers;
  useEffect(
    () => () => {
      request.current++;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [],
  );
  const ranked = useMemo(
    () => rankCenters(centers, position),
    [centers, position],
  );
  const nearest = ranked.find((center) => center.distanceKm !== null);
  const visible = ranked.filter((center) =>
    `${center.name} ${center.address}`
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  const selected = centers.find((center) => center.id === value);
  const directions = selected ? directionsUrl(selected) : null;

  function cancelRequest() {
    request.current++;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setLocating(false);
    onLocatingChange(false);
  }
  function clearLocation() {
    cancelRequest();
    setPosition(null);
    setAccuracy(null);
    setMessage("Location cleared. You can choose any participating center.");
  }
  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage(
        "Location is unavailable here. Use HTTPS or localhost, or choose your center below.",
      );
      return;
    }
    cancelRequest();
    const id = request.current;
    setLocating(true);
    onLocatingChange(true);
    setMessage("");
    function finish() {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      setLocating(false);
      onLocatingChange(false);
    }
    // Browsers may keep a permission prompt open beyond getCurrentPosition's timeout.
    pendingTimer.current = setTimeout(() => {
      if (id !== request.current) return;
      request.current++;
      finish();
      setMessage(
        "Finding your location took too long. Try again, or select a center manually.",
      );
    }, 20000);
    try {
      navigator.geolocation.getCurrentPosition(
        (result) => {
          if (id !== request.current) return;
          finish();
          const next = {
            latitude: result.coords.latitude,
            longitude: result.coords.longitude,
          };
          if (!validCoordinates(next)) {
            setMessage(
              "Your device returned an unavailable location. Please choose a center manually.",
            );
            return;
          }
          setPosition(next);
          setAccuracy(
            Number.isFinite(result.coords.accuracy)
              ? result.coords.accuracy
              : null,
          );
          setQuery("");
          const closest = rankCenters(latestCenters.current, next).find(
            (center) => center.distanceKm !== null,
          );
          if (closest) {
            onChange(closest.id);
            setMessage(
              "Location found. The nearest listed center is selected; you can choose another.",
            );
          } else
            setMessage(
              "These centers do not have coordinates yet. Please choose a center manually.",
            );
        },
        (error) => {
          if (id !== request.current) return;
          finish();
          setMessage(
            error.code === 1
              ? "Location permission was declined. Choose a center below, or allow location in your browser and try again."
              : error.code === 3
                ? "Finding your location took too long. Try again, or select a center manually."
                : "Your device could not find your location. Try again, or choose a center below.",
          );
        },
        { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 },
      );
    } catch {
      if (id === request.current) {
        finish();
        setMessage("Location is unavailable. Please choose a center below.");
      }
    }
  }
  function choose(id: string) {
    cancelRequest();
    onChange(id);
    setMessage(
      position
        ? "Center selected. Distances are sorted from your last location."
        : "Center selected. Your ticket will be assigned to this center.",
    );
  }

  return (
    <section className="center-picker" aria-labelledby="center-picker-title">
      <div className="center-picker-heading">
        <div>
          <span className="eyebrow">FIND YOUR DROP-OFF SPOT</span>
          <h3 id="center-picker-title">Your recycling center</h3>
        </div>
        <MapPin size={23} />
      </div>
      <p className="small muted">
        Find the closest participating center, then create a ticket for that
        location.
      </p>
      <div className="location-actions">
        <button
          type="button"
          className="button secondary"
          disabled={disabled || locating || !centers.length}
          onClick={locate}
        >
          {locating ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Crosshair size={16} />
          )}
          {locating
            ? "Finding your location…"
            : position
              ? "Update my location"
              : "Use my location"}
        </button>
        {(position || locating) && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={clearLocation}
          >
            <X size={14} />
            {locating ? "Cancel" : "Clear location"}
          </button>
        )}
      </div>
      <p className="location-privacy">
        Your location stays in this page. Only your selected center is saved
        with the ticket.
      </p>
      <p className="location-status" role="status" aria-live="polite">
        {message}
      </p>
      {position && nearest && nearest.distanceKm! > 50 && (
        <p className="location-warning">
          The closest listed center is{" "}
          {formatDistance(nearest.distanceKm!).toLowerCase()}. There may not be
          a participating center near you yet.
        </p>
      )}
      {centers.some((center) => center.is_demo) && (
        <p className="location-demo">
          Demo centers use sample Brooklyn locations, not verified public
          drop-off facilities.
        </p>
      )}
      <label htmlFor="center-search">Search centers</label>
      <div className="center-search">
        <Search size={16} />
        <input
          id="center-search"
          type="search"
          placeholder="Center name or neighborhood"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <fieldset className="center-options" disabled={disabled}>
        <legend className="sr-only">Choose a recycling center</legend>
        {visible.map((center) => (
          <label
            key={center.id}
            className={`center-option ${value === center.id ? "chosen" : ""}`}
          >
            <input
              type="radio"
              name="recycling-center"
              value={center.id}
              checked={value === center.id}
              onChange={() => choose(center.id)}
              aria-label={center.name}
            />
            <span className="center-option-body">
              <span className="center-name">
                {center.name}
                {position && center.id === nearest?.id && (
                  <span className="nearest-label">Nearest listed</span>
                )}
              </span>
              <span className="center-address">{center.address}</span>
              <span className="center-distance">
                {center.distanceKm !== null
                  ? formatDistance(center.distanceKm)
                  : position
                    ? "Distance unavailable"
                    : "Use location to see distance"}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      {!visible.length && (
        <p className="small muted">
          {centers.length
            ? "No centers match your search. Try another name or clear your search."
            : "No participating centers are registered yet. Please check back soon."}
        </p>
      )}
      {selected && (
        <div className="selected-center">
          <span>
            <MapPin size={14} /> Ticket center: <strong>{selected.name}</strong>
          </span>
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Directions <Navigation size={13} />
            </a>
          )}
        </div>
      )}
      {position && (
        <p className="location-privacy">
          Approximate straight-line distances, not travel routes.
          {accuracy !== null
            ? ` Device accuracy: about ${Math.max(1, Math.round(accuracy)).toLocaleString()} m.`
            : ""}{" "}
          Only centers with registered coordinates can be ranked.
        </p>
      )}
    </section>
  );
}
