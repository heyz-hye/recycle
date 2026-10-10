"use client";
import { useRef, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import {
  api,
  dollars,
  tokens,
  type Redemption,
  type User,
  type WalletData,
} from "@/lib/api";
import { signBurn } from "@/lib/wallet";
import Modal from "@/components/Modal";

function Redeem({
  user,
  wallet,
  demo,
  onClose,
  onComplete,
}: {
  user: User;
  wallet: WalletData;
  demo: boolean;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Redemption | null>(
    wallet.redemptions.find((r) => r.state === "pending") || null,
  );
  const key = useRef<string | null>(null);
  const [signature, setSignature] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      key.current ||= crypto.randomUUID();
      const r =
        pending ||
        (await api<Redemption>("/redemptions", {
          amount_base_units: Number(amount) * 100,
          request_key: key.current,
        }));
      setPending(r);
      if (r.state !== "completed") {
        let sig = signature || sessionStorage.getItem(`burn:${r.id}`) || "";
        if (!sig) {
          sig = await signBurn(r.transaction_b64!, user.wallet);
          sessionStorage.setItem(`burn:${r.id}`, sig);
          setSignature(sig);
        }
        await api(`/redemptions/${r.id}/confirm`, { signature: sig });
        sessionStorage.removeItem(`burn:${r.id}`);
      }
      await onComplete();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Redemption is pending. Retry to reconcile the same burn.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Simulate a redemption" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          {demo
            ? "This demo records a simulated token burn and a simulated payout."
            : "Your wallet authorizes a Devnet token burn. After confirmation, we record a simulated payout."}{" "}
          No real money is paid.
        </p>
        {pending ? (
          <div className="info-box">
            Resume your pending redemption of{" "}
            {tokens(pending.amount_base_units)} LOOP. It remains reserved until
            the burn is reconciled.
          </div>
        ) : (
          <>
            <label htmlFor="redeem-amount">Whole LOOP tokens to redeem</label>
            <input
              id="redeem-amount"
              type="number"
              min="1"
              max={Math.floor(wallet.balance_base_units / 100)}
              step="1"
              required
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                key.current = null;
              }}
            />
            <p className="small muted">
              {dollars(Number(amount))} simulated credit · Available:{" "}
              {tokens(wallet.balance_base_units)} LOOP
            </p>
          </>
        )}
        {pending && !demo && (
          <>
            <label htmlFor="burn-signature">
              Burn signature (if already sent)
            </label>
            <input
              id="burn-signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Paste the original transaction signature"
            />
            <p className="small muted">
              If a wallet send was interrupted, recover its signature from
              wallet history before continuing.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button disabled={busy} className="button primary full">
          {busy
            ? "Checking redemption…"
            : demo
              ? "Confirm simulated redemption"
              : pending
                ? "Resume burn confirmation"
                : "Authorize Devnet burn"}
          <ArrowRight size={17} />
        </button>
      </form>
    </Modal>
  );
}

export default Redeem;
