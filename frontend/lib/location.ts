import type { Center } from "./api";

export type Coordinates = { latitude: number; longitude: number };
export type RankedCenter = Center & { distanceKm: number | null };
export function validCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.latitude) &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.latitude) <= 90 &&
    Math.abs(value.longitude) <= 180
  );
}
export function hasCoordinates(center: Center): center is Center & Coordinates {
  return (
    center.latitude !== null &&
    center.longitude !== null &&
    validCoordinates({ latitude: center.latitude, longitude: center.longitude })
  );
}
// Great-circle distance, not a walking/driving route estimate.
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const haversine =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return (
    6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
  );
}
export function rankCenters(
  centers: Center[],
  position: Coordinates | null,
): RankedCenter[] {
  return centers
    .map((center) => ({
      ...center,
      distanceKm:
        position && hasCoordinates(center)
          ? distanceKm(position, center)
          : null,
    }))
    .sort(
      (a, b) =>
        (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
        a.name.localeCompare(b.name),
    );
}
export function formatDistance(km: number): string {
  if (km < 0.1) return "Less than 100 m away";
  if (km < 1) return `${Math.round(km * 1000)} m away`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(km)} km away`;
}
export function directionsUrl(center: Center): string | null {
  if (!hasCoordinates(center) || center.is_demo) return null;
  // Only the center destination goes to Maps, never the location obtained by LoopMint.
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${center.latitude},${center.longitude}`)}`;
}
