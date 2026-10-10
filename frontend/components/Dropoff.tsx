"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Package, Recycle, ShieldCheck } from "lucide-react";
import type { Center } from "@/lib/api";
import { number } from "@/lib/api";
import CenterPicker from "@/components/CenterPicker";

function Dropoff({
  centers,
  busy,
  onSubmit,
}: {
  centers: Center[];
  busy: boolean;
  onSubmit: (body: unknown) => void;
}) {
  const [bottles, setBottles] = useState("");
  const [cardboard, setCardboard] = useState("");
  const [center, setCenter] = useState("greenpoint");
  const [locating, setLocating] = useState(false);
  const selectedCenter =
    centers.find((c) => c.id === center)?.id || centers[0]?.id || "";
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const items = [];
    if (Number(bottles) > 0)
      items.push({
        material: "bottles",
        quantity: Number(bottles),
        unit: "count",
      });
    if (Number(cardboard) > 0)
      items.push({
        material: "cardboard",
        quantity: Math.round(Number(cardboard) * 1000),
        unit: "grams",
      });
    if (!items.length) {
      setError("Add at least one bottle or a cardboard weight.");
      return;
    }
    setError("");
    if (!selectedCenter || locating) {
      setError("Choose a center or wait for the location search to finish.");
      return;
    }
    onSubmit({ center_id: selectedCenter, items });
  }
  return (
    <div className="form-grid">
      <form className="panel form-panel" onSubmit={submit}>
        <h2>What are you bringing?</h2>
        <p className="muted">
          An estimate is fine. We’ll use the center’s actual measurements for
          your reward.
        </p>
        <div className="material-input">
          <span className="material-icon">
            <Recycle size={24} />
          </span>
          <div>
            <label htmlFor="bottles">Plastic bottles</label>
            <span className="small muted">
              Empty, clean, and ready for their next chapter
            </span>
          </div>
          <div className="quantity-input">
            <input
              id="bottles"
              type="number"
              min="0"
              max="1000000"
              step="1"
              placeholder="0"
              value={bottles}
              onChange={(e) => setBottles(e.target.value)}
            />
            <span>bottles</span>
          </div>
        </div>
        <div className="material-input">
          <span className="material-icon cardboard">
            <Package size={24} />
          </span>
          <div>
            <label htmlFor="cardboard">Dry cardboard</label>
            <span className="small muted">
              Flattened, dry, and free of food residue
            </span>
          </div>
          <div className="quantity-input">
            <input
              id="cardboard"
              type="number"
              min="0"
              max="1000"
              step="0.001"
              placeholder="0"
              value={cardboard}
              onChange={(e) => setCardboard(e.target.value)}
            />
            <span>kg</span>
          </div>
        </div>
        <CenterPicker
          centers={centers}
          value={selectedCenter}
          onChange={setCenter}
          disabled={busy}
          onLocatingChange={setLocating}
        />
        <div className="estimate">
          <span>Estimated reward</span>
          <strong>
            {number(Number(bottles || 0) * 5 + Number(cardboard || 0) * 20)}{" "}
            LOOP
          </strong>
          <small>
            Final reward depends on center-confirmed intake and available
            funding.
          </small>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || !selectedCenter || locating}
          type="submit"
        >
          {busy ? "Creating your ticket…" : "Create drop-off ticket"}
          <ArrowRight size={17} />
        </button>
      </form>
      <div>
        <div className="panel prep-card">
          <span className="eyebrow">A LITTLE PREP GOES A LONG WAY</span>
          <h2>
            Ready for a<br />
            fresh start.
          </h2>
          <div className="prep-art">
            <Package size={80} strokeWidth={1} />
            <Recycle size={45} strokeWidth={1.4} />
          </div>
          <p>
            <Check size={17} /> Empty and rinse plastic bottles
          </p>
          <p>
            <Check size={17} /> Keep cardboard clean and dry
          </p>
          <p>
            <Check size={17} /> Bring your ticket to the center
          </p>
        </div>
        <p className="footnote">
          <ShieldCheck size={20} /> Only center staff can confirm intake. Photos
          are never used for AI verification.
        </p>
      </div>
    </div>
  );
}

export default Dropoff;
