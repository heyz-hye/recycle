"use client";
import { useEffect, useRef, useState } from "react";
import { Crosshair, MapPin, Navigation, LoaderCircle, X } from "lucide-react";
import type { Center } from "@/lib/api";
import GoogleCenterMap from "./GoogleCenterMap";
import LocationSearch from "./LocationSearch";
import { Coordinates, directionsUrl, validCoordinates } from "@/lib/location";

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
  const [positionLabel, setPositionLabel] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      request.current++;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    },
    [],
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
    setPositionLabel(null);
    setAccuracy(null);
    onChange("");
    setMessage(
      "Location cleared. Use your location or search an address to find a center.",
    );
  }
  function applyPosition(
    next: Coordinates,
    precision: number | null,
    label: string | null = null,
  ) {
    setPosition(next);
    setPositionLabel(label);
    setAccuracy(precision);
    onChange("");
    setMessage(
      label
        ? "Search area selected. Choose a participating center from the map results."
        : "Location found. Choose a participating center from the map results.",
    );
  }

  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setMessage(
        "Location is unavailable here. Open localhost in Chrome or Safari, or search an address below.",
      );
      return;
    }
    cancelRequest();
    const id = request.current;
    setLocating(true);
    onLocatingChange(true);
    setMessage(
      "Allow location in your browser if prompted. You can also search an address without GPS.",
    );
    function finish() {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      setLocating(false);
      onLocatingChange(false);
    }
    const timedOut =
      "Your browser took too long to return a location. If you are in VS Code’s preview, open localhost:3000 in Chrome or Safari, or search an address below.";
    // The browser's own timeout can exclude time spent awaiting permission.
    pendingTimer.current = setTimeout(() => {
      if (id !== request.current) return;
      request.current++;
      finish();
      setMessage(timedOut);
    }, 40000);
    function attempt(highAccuracy: boolean) {
      try {
        navigator.geolocation.getCurrentPosition(
          (result) => {
            if (id !== request.current) return;
            request.current++;
            finish();
            const next = {
              latitude: result.coords.latitude,
              longitude: result.coords.longitude,
            };
            if (!validCoordinates(next)) {
              setMessage(
                "Your device returned an unavailable location. Search an address below.",
              );
              return;
            }
            applyPosition(
              next,
              Number.isFinite(result.coords.accuracy)
                ? result.coords.accuracy
                : null,
            );
          },
          (error) => {
            if (id !== request.current) return;
            if (error.code !== 1 && !highAccuracy) {
              setMessage(
                "Trying another device location method. You can search an address now instead of waiting.",
              );
              attempt(true);
              return;
            }
            request.current++;
            finish();
            setMessage(
              error.code === 1
                ? "Location permission was declined. Allow location for this browser in your browser and system settings, or search an address below."
                : error.code === 3
                  ? timedOut
                  : "Your browser could not determine your location. Open the app in Chrome or Safari, or search an address below.",
            );
          },
          {
            enableHighAccuracy: highAccuracy,
            maximumAge: 60000,
            timeout: highAccuracy ? 20000 : 10000,
          },
        );
      } catch {
        if (id === request.current) {
          request.current++;
          finish();
          setMessage("Location is unavailable. Search an address below.");
        }
      }
    }
    attempt(false);
  }
  function choose(id: string) {
    cancelRequest();
    onChange(id);
    setMessage(
      position
        ? positionLabel
          ? "Center selected. Distances are sorted from your selected search area."
          : "Center selected. Distances are sorted from your last location."
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
        Find nearby recycling centers on Google Maps. Choose an enrolled
        LoopMint center to create a ticket.
      </p>
      <div className="location-actions">
        <button
          type="button"
          className="button secondary"
          disabled={disabled || locating}
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
        Using location shares your coordinates with Google to display the map
        and find nearby places. LoopMint does not store your GPS coordinates.
        Only your selected participating center is saved with the ticket.{" "}
        <a href="/maps-information#privacy" target="_blank" rel="noreferrer">
          Location privacy
        </a>
        {" · "}
        <a href="/maps-information#terms" target="_blank" rel="noreferrer">
          Map terms
        </a>
      </p>
      <p className="location-status" role="status" aria-live="polite">
        {message}
      </p>
      <LocationSearch
        disabled={disabled}
        onStart={() => {
          cancelRequest();
          setMessage("");
        }}
        onSelect={(next, label) => {
          cancelRequest();
          applyPosition(next, null, label);
        }}
      />
      {position && (
        <GoogleCenterMap
          position={position}
          accuracy={accuracy}
          positionLabel={positionLabel}
          centers={centers}
          selected={value}
          disabled={disabled}
          onSelect={choose}
        />
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
          Choose a participating center using “Use for my ticket” or a green L
          marker.
        </p>
      )}
    </section>
  );
}
