"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, Funding, explorer } from "@/lib/api";
import { fundingWallets, sendFundingDeposit } from "@/lib/wallet";

export default function UsdcFundingForm({
  userId,
  details,
  onVerified,
}: {
  userId: string;
  details: Funding["usdc"];
  onVerified: (funding: Funding) => void;
}) {
  const [amount, setAmount] = useState("100");
  const [walletList, setWalletList] = useState<
    ReturnType<typeof fundingWallets>
  >([]);
  const [walletIndex, setWalletIndex] = useState("0");
  const [pending, setPending] = useState("");
  const [signature, setSignature] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const storageKey = `loopmint:funding-deposit:${userId}`;
  useEffect(() => {
    setWalletList(fundingWallets());
    try {
      setPending(localStorage.getItem(storageKey) || "");
    } catch {
      /* Recovery remains available by receipt. */
    }
  }, [storageKey]);
  function remember(value: string) {
    setPending(value);
    try {
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      /* Show receipt in the page if storage is disabled. */
    }
  }
  async function verify(receipt: string) {
    setMessage("Deposit sent. Waiting for confirmation…");
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const funded = await api<Funding>("/funding/deposits", {
          signature: receipt,
        });
        remember("");
        setSignature("");
        setMessage("USDC deposit confirmed and added to the funding pool.");
        onVerified(funded);
        return;
      } catch (e) {
        if (
          e instanceof ApiError &&
          e.status === 409 &&
          e.message.includes("not finalized") &&
          attempt < 19
        ) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else throw e;
      }
    }
  }
  async function run(work: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage("");
      setError(
        e instanceof Error ? e.message : "Unable to complete this deposit.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <h2>Deposit USDC funding</h2>
      <p className="muted">
        Release government funding into the platform’s USDC pool. Enter the
        amount and approve the transfer in your wallet.
      </p>
      <span className="pill">Solana Devnet · Test USDC</span>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {pending ? (
        <div className="info-box" style={{ display: "block" }}>
          <p>
            A deposit was submitted. Verify it before starting another transfer.
          </p>
          <a
            className="text-link"
            href={explorer(pending)}
            target="_blank"
            rel="noreferrer"
          >
            View submitted deposit
          </a>
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => void run(() => verify(pending))}
          >
            Check deposit status
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (!/^\d+(\.\d{1,6})?$/.test(amount))
                throw new Error(
                  "Enter a USDC amount with up to six decimal places.",
                );
              const [whole, fraction = ""] = amount.split(".");
              const units =
                BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
              if (units <= 0n || units > 1000000000000n)
                throw new Error("Enter between 0.000001 and 1,000,000 USDC.");
              const wallet = walletList[Number(walletIndex)];
              if (!wallet)
                throw new Error(
                  "Open your Solana wallet extension, then refresh the wallet list.",
                );
              setMessage(
                "Approve the USDC deposit in your wallet. Your wallet needs Devnet SOL for the network fee.",
              );
              const receipt = await sendFundingDeposit(wallet, Number(units));
              remember(receipt);
              await verify(receipt);
            });
          }}
        >
          <label htmlFor="usdc-deposit-amount">USDC amount</label>
          <input
            id="usdc-deposit-amount"
            type="number"
            min="0.000001"
            max="1000000"
            step="0.000001"
            required
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label htmlFor="funding-wallet">Government funding wallet</label>
          <select
            id="funding-wallet"
            value={walletIndex}
            disabled={busy}
            onChange={(e) => setWalletIndex(e.target.value)}
          >
            {!walletList.length && (
              <option value="0">No wallet detected</option>
            )}
            {walletList.map((w, i) => (
              <option value={i} key={i}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setWalletList(fundingWallets());
              setWalletIndex("0");
            }}
          >
            Refresh wallets
          </button>
          <p className="muted">
            Receiving wallet:{" "}
            <span style={{ overflowWrap: "anywhere" }}>
              {details?.treasury_address || "Loading…"}
            </span>
          </p>
          <button
            className="button primary full"
            disabled={busy || !details?.treasury_address || !walletList.length}
          >
            {busy ? "Processing deposit…" : "Deposit USDC"}
          </button>
        </form>
      )}
      <p className="muted">
        Your funding is added after the transfer is confirmed. One USDC provides
        $1 of backing. LOOP supply is managed separately by the platform
        operator.
      </p>
      {!pending && (
        <details>
          <summary>Already sent USDC from your wallet?</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => verify(signature.trim()));
            }}
          >
            <p className="muted">
              Use the transaction receipt from that transfer, not a wallet
              address.
            </p>
            <label htmlFor="deposit-signature">
              Deposit transaction signature
            </label>
            <input
              id="deposit-signature"
              required
              minLength={64}
              maxLength={88}
              value={signature}
              disabled={busy}
              onChange={(e) => setSignature(e.target.value)}
            />
            <button className="button secondary full" disabled={busy}>
              Verify existing deposit
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
