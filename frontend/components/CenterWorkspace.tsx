"use client";
import { useCallback, useState } from "react";
import type { Claim } from "@/lib/api";
import { material, quantity, tokens } from "@/lib/api";
import { ArrowRight, ScanLine, ShieldCheck, X } from "lucide-react";
import Modal from "@/components/Modal";
import Scanner from "@/components/Scanner";
import { Badge } from "@/components/ui";

export function TicketLookup({
  busy,
  onOpen,
}: {
  busy: boolean;
  onOpen: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const read = useCallback((value: string) => {
    setCode(value);
    setScan(false);
  }, []);
  return (
    <form
      className="panel form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(code.trim());
      }}
    >
      <span className="material-icon">
        <ScanLine size={25} />
      </span>
      <h2>Start with their ticket.</h2>
      <p className="muted">
        Scan the recycler’s QR code, or paste their ticket code to open the
        claim.
      </p>
      {scan && <Scanner onRead={read} />}
      <button
        type="button"
        className="button secondary full"
        onClick={() => setScan(!scan)}
      >
        <ScanLine size={17} />
        {scan ? "Stop camera" : "Scan QR ticket"}
      </button>
      <label htmlFor="ticket-code">Ticket code</label>
      <input
        id="ticket-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste the drop-off ticket code"
        required
        minLength={10}
        maxLength={150}
      />
      <button className="button primary full" disabled={busy}>
        Open drop-off <ArrowRight size={16} />
      </button>
      <p className="small muted">
        Opening a ticket does not confirm receipt or issue tokens.
      </p>
    </form>
  );
}

export function Review({
  claim,
  busy,
  onClose,
  onConfirm,
  onOpen,
  error,
}: {
  error: string;
  claim: Claim;
  busy: boolean;
  onClose: () => void;
  onConfirm: (data: unknown) => void;
  onOpen: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      claim.items.map((i) => [
        i.material,
        String(i.submitted_quantity / (i.material === "cardboard" ? 1000 : 1)),
      ]),
    ),
  );
  const [received, setReceived] = useState(false);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const final = ["verified", "rejected"].includes(claim.status);
  return (
    <Modal title="Confirm physical intake" onClose={onClose}>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <p className="muted">
        {claim.username} · {claim.center_name}
      </p>
      <Badge state={claim.status} />
      {final ? (
        <div className="review-result">
          <h3>This decision is recorded.</h3>
          {claim.items.map((i) => (
            <p key={i.material}>{quantity(i, true)}</p>
          ))}
          <p>{claim.verification?.reason}</p>
          {claim.reward && (
            <>
              <strong>{tokens(claim.reward.amount_base_units)} LOOP</strong>
              <Badge state={claim.reward.state} />
            </>
          )}
        </div>
      ) : claim.status === "submitted" ? (
        <div className="review-result">
          <p>Open this ticket before inspecting and confirming the drop-off.</p>
          <button disabled={busy} className="button primary" onClick={onOpen}>
            Open ticket for review <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const items = reject
              ? []
              : claim.items
                  .filter((i) => Number(values[i.material]) > 0)
                  .map((i) => ({
                    material: i.material,
                    quantity: Math.round(
                      Number(values[i.material]) *
                        (i.material === "cardboard" ? 1000 : 1),
                    ),
                    unit: i.material === "cardboard" ? "grams" : "count",
                  }));
            if (!reject && !items.length) {
              setValidation(
                "Enter at least one accepted quantity, or reject the drop-off.",
              );
              return;
            }
            setValidation("");
            onConfirm({
              decision: reject ? "rejected" : "approved",
              received: !reject && received,
              items,
              reason,
            });
          }}
        >
          <div className="button-row tabs">
            <button
              className={!reject ? "selected" : ""}
              type="button"
              onClick={() => setReject(false)}
            >
              Accept intake
            </button>
            <button
              className={reject ? "selected" : ""}
              type="button"
              onClick={() => setReject(true)}
            >
              Reject drop-off
            </button>
          </div>
          {!reject && (
            <>
              <p className="small muted">
                Enter actual accepted quantities. Set an unaccepted material to
                zero.
              </p>
              {claim.items.map((i) => (
                <div className="review-input" key={i.material}>
                  <label htmlFor={`accepted-${i.material}`}>
                    Accepted {material(i.material).toLowerCase()}
                    <small>Submitted: {quantity(i)}</small>
                  </label>
                  <div className="quantity-input">
                    <input
                      id={`accepted-${i.material}`}
                      type="number"
                      required
                      min="0"
                      max={i.material === "bottles" ? 1000000 : 1000}
                      step={i.material === "cardboard" ? ".001" : "1"}
                      value={values[i.material]}
                      onChange={(e) =>
                        setValues({ ...values, [i.material]: e.target.value })
                      }
                    />
                    <span>{i.material === "bottles" ? "bottles" : "kg"}</span>
                  </div>
                </div>
              ))}
              <label className="checkbox">
                <input
                  type="checkbox"
                  required
                  checked={received}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                <span>
                  I physically received and inspected these materials at this
                  center.
                </span>
              </label>
            </>
          )}
          <label htmlFor="reason">
            {reject ? "Reason for rejection" : "Intake note (optional)"}
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={reject}
            maxLength={500}
            rows={3}
          />
          {validation && (
            <p className="error-text" role="alert">
              {validation}
            </p>
          )}
          <button
            disabled={busy}
            className={`button ${reject ? "danger" : "primary"} full`}
            type="submit"
          >
            {reject ? <X size={17} /> : <ShieldCheck size={17} />}
            {busy
              ? "Recording decision…"
              : reject
                ? "Reject drop-off"
                : "Confirm accepted recycling"}
          </button>
        </form>
      )}
    </Modal>
  );
}
