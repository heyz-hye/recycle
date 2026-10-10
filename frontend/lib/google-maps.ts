import {
  Coordinates,
  distanceKm,
  validCoordinates,
  hasCoordinates,
} from "./location";
import type { Center } from "./api";

declare global {
  interface Window {
    loopmintMapsReady?: () => void;
    gm_authFailure?: () => void;
  }
}

let loading: Promise<void> | null = null;
export function loadGoogleMaps(key: string): Promise<void> {
  if (
    typeof google !== "undefined" &&
    typeof google.maps?.importLibrary === "function"
  )
    return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => fail(), 20000);
    function fail() {
      clearTimeout(timer);
      script.remove();
      loading = null;
      reject(
        new Error(
          "Google Maps could not load. Check your connection or try again later.",
        ),
      );
    }
    window.loopmintMapsReady = () => {
      clearTimeout(timer);
      resolve();
    };
    window.gm_authFailure = () => {
      fail();
      window.dispatchEvent(new Event("loopmint-maps-auth-error"));
    };
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      callback: "loopmintMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return loading;
}

export type NearbyPlace = {
  id: string;
  name: string;
  address: string;
  location: Coordinates;
  distance: number;
  registeredCenterId?: string;
  registeredListing?: boolean;
  attributions: { provider: string; providerURI: string | null }[];
};

export function nearbyPlaces(
  places: google.maps.places.Place[],
  origin: Coordinates,
  radius: number,
): NearbyPlace[] {
  const unique = new Set<string>();
  return places
    .flatMap((place) => {
      if (
        !place.id ||
        !place.location ||
        place.businessStatus === "CLOSED_PERMANENTLY" ||
        unique.has(place.id)
      )
        return [];
      const location = {
        latitude: place.location.lat(),
        longitude: place.location.lng(),
      };
      if (!validCoordinates(location)) return [];
      const distance = distanceKm(origin, location);
      if (distance > radius / 1000) return [];
      unique.add(place.id);
      return [
        {
          id: place.id,
          name: place.displayName || "Recycling location",
          address: place.formattedAddress || "Address unavailable",
          location,
          distance,
          attributions: (place.attributions || []).map((a) => ({
            provider: a.provider || "Data provider",
            providerURI: a.providerURI || null,
          })),
        },
      ];
    })
    .sort((a, b) => a.distance - b.distance);
}

// Keep operator-registered locations selectable even if Google's top results
// omit them. Match enrollment only by exact Place ID, never by business name.
export function mergeRegisteredPlaces(
  places: NearbyPlace[],
  centers: Center[],
  origin: Coordinates,
  radius: number,
  unavailablePlaceIds: string[] = [],
): NearbyPlace[] {
  const results = places.map((place) => ({ ...place }));
  for (const center of centers) {
    if (
      center.is_demo ||
      !hasCoordinates(center) ||
      (center.google_place_id &&
        unavailablePlaceIds.includes(center.google_place_id))
    )
      continue;
    const distance = distanceKm(origin, center);
    if (distance > radius / 1000) continue;
    const match = results.find((place) => place.id === center.google_place_id);
    if (match) {
      match.registeredCenterId = center.id;
      continue;
    }
    results.push({
      id: center.google_place_id || `center:${center.id}`,
      registeredCenterId: center.id,
      registeredListing: true,
      name: center.name,
      address: center.address,
      location: { latitude: center.latitude, longitude: center.longitude },
      distance,
      attributions: [],
    });
  }
  return results.sort(
    (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
  );
}

export function googleDirections(place: NearbyPlace) {
  const query = new URLSearchParams({
    api: "1",
    destination: `${place.location.latitude},${place.location.longitude}`,
  });
  if (!place.id.startsWith("center:"))
    query.set("destination_place_id", place.id);
  return `https://www.google.com/maps/dir/?${query}`;
}

export function safeProviderUrl(value: string | null): string | undefined {
  try {
    const u = new URL(value || "");
    return u.protocol === "https:" ? u.href : undefined;
  } catch {
    return undefined;
  }
}
