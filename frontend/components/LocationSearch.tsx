"use client";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { loadGoogleMaps, safeProviderUrl } from "@/lib/google-maps";
import { Coordinates, validCoordinates } from "@/lib/location";

type Candidate = {
  id: string;
  name: string;
  address: string;
  position: Coordinates;
  attributions: { name: string; url: string | null }[];
};
type Props = {
  disabled: boolean;
  onStart: () => void;
  onSelect: (position: Coordinates, label: string) => void;
};
export default function LocationSearch({ disabled, onStart, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function search() {
    if (!query.trim() || busy || disabled) return;
    onStart();
    const id = ++generation.current;
    setBusy(true);
    setMessage("");
    setResults([]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const searchTask = async () => {
        const config = await api<{ api_key: string }>("/maps/config");
        if (!config.api_key)
          throw new Error("Google search is not configured yet.");
        await loadGoogleMaps(config.api_key);
        if (id !== generation.current) return [];
        const { Place } = (await google.maps.importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;
        if (id !== generation.current) return [];
        const response = await Place.searchByText({
          textQuery: query.trim(),
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
            "attributions",
          ],
          maxResultCount: 5,
        });
        return response.places.flatMap((place) => {
          if (!place.location) return [];
          const position = {
            latitude: place.location.lat(),
            longitude: place.location.lng(),
          };
          if (!validCoordinates(position)) return [];
          return [
            {
              id: place.id,
              name: place.displayName || query.trim(),
              address: place.formattedAddress || "",
              position,
              attributions: (place.attributions || []).map((a) => ({
                name: a.provider || "Data provider",
                url: a.providerURI,
              })),
            },
          ];
        });
      };
      const candidates = await Promise.race([
        searchTask(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error("Address search timed out. Please try again.")),
            20000,
          );
        }),
      ]);
      if (id !== generation.current) return;
      setResults(candidates);
      setMessage(
        candidates.length
          ? "Choose the area you want to search around."
          : "No matching location found. Include a city, region, or country and try again.",
      );
    } catch (error) {
      if (id === generation.current)
        setMessage(
          error instanceof Error &&
            /not configured|timed out/.test(error.message)
            ? error.message
            : "Google address search is unavailable. Please try again later.",
        );
    } finally {
      if (timer) clearTimeout(timer);
      if (id === generation.current) setBusy(false);
    }
  }
  return (
    <section
      className="address-search"
      aria-label="Search a location without GPS"
    >
      <label htmlFor="location-address">
        Or search by address, neighborhood, or postal code
      </label>
      <div className="address-search-row">
        <input
          id="location-address"
          type="search"
          maxLength={250}
          placeholder="e.g. Greenpoint, Brooklyn, NY"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            generation.current++;
            setBusy(false);
            setQuery(e.target.value);
            setResults([]);
            setMessage("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy || !query.trim()}
          onClick={() => void search()}
        >
          <Search size={16} />
          {busy ? "Searching…" : "Search location"}
        </button>
      </div>
      <p className="location-privacy">
        Your search is sent to Google. No device location permission is needed.
      </p>
      {message && (
        <p className="address-status small" role="status">
          {message}
        </p>
      )}
      {!!results.length && (
        <>
          <span className="google-text-attribution" translate="no">
            Google Maps
          </span>
          <ul className="address-results">
            {results.map((result) => (
              <li key={result.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    generation.current++;
                    setResults([]);
                    setMessage("");
                    onSelect(result.position, result.address || result.name);
                  }}
                >
                  <strong>{result.name}</strong>
                  <span>{result.address}</span>
                </button>
                {result.attributions.map((a, i) => (
                  <small key={i}>
                    {safeProviderUrl(a.url) ? (
                      <a
                        href={safeProviderUrl(a.url)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {a.name}
                      </a>
                    ) : (
                      a.name
                    )}
                  </small>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
