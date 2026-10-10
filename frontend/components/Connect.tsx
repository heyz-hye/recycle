"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Wallet } from "lucide-react";
import type { User } from "@/lib/api";
import { wallets, loginWallet } from "@/lib/wallet";
import Modal from "@/components/Modal";

function Connect({
  onClose,
  onLogin,
}: {
  onClose: () => void;
  onLogin: (u: User) => void;
}) {
  const [username, setUsername] = useState("Recycler");
  const [available, setAvailable] = useState<ReturnType<typeof wallets>>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAvailable(wallets());
    const t = setInterval(() => setAvailable(wallets()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <Modal title="Connect your wallet" onClose={onClose}>
      <p className="muted">
        Choose a Solana Devnet wallet. You’ll sign a one-time message to
        securely sign in.
      </p>
      <label htmlFor="wallet-username">Display name (new wallets)</label>
      <input
        id="wallet-username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        maxLength={40}
      />
      {available.length ? (
        available.map((w) => (
          <button
            className="button secondary full"
            disabled={busy}
            key={w.name}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                onLogin(await loginWallet(w, username.trim() || "Recycler"));
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Wallet connection failed.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <Wallet size={19} />
            {w.name}
            <ArrowUpRight size={17} />
          </button>
        ))
      ) : (
        <div className="info-box">
          No compatible wallet detected. Enable a Solana Wallet Standard browser
          wallet that supports Devnet, then return here.
        </div>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </Modal>
  );
}

export default Connect;
