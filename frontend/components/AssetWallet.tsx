"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Wallet } from "lucide-react";
import { api, date, explorer, tokens, User } from "@/lib/api";
import Modal from "./Modal";

type Asset = "LOOP" | "USDC" | "SOL";
type Balance = {
  available_base_units: number;
  pending_base_units: number;
  decimals: number;
};
type Withdrawal = {
  id: string;
  asset: Asset;
  amount_base_units: number;
  destination: string;
  state: string;
  signature: string | null;
  last_error: string | null;
  created_at: number;
};
type Conversion = {
  id: string;
  asset: Asset;
  loop_base_units: number;
  output_base_units: number;
  created_at: number;
};
type Assets = {
  balances: Record<Asset, Balance>;
  valuation: { fund_usd_micros: number; supply_base_units: number };
  network: string;
  mock_usdc?: boolean;
  usdc_mint?: string;
  withdrawals_configured: boolean;
  withdrawals: Withdrawal[];
  conversions: Conversion[];
};
type Quote = {
  id: string;
  asset: "USDC" | "SOL";
  loop_base_units: number;
  output_base_units: number;
  usd_micros: number;
  fund_usd_micros: number;
  supply_base_units: number;
  sol_usd_micros: number;
  expires_at: number;
};
const assetLabel = (asset: Asset, data?: Assets | null) =>
  asset === "USDC" && data?.mock_usdc ? "Mock USD" : asset;
const decimals: Record<Asset, number> = { LOOP: 2, USDC: 6, SOL: 9 };
const amountText = (value: number, asset: Asset) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals[asset],
  }).format(value / 10 ** decimals[asset]);

export function parseAssetAmount(value: string, asset: Asset) {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error("Enter a positive amount.");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals[asset])
    throw new Error(`${asset} allows up to ${decimals[asset]} decimal places.`);
  const units =
    BigInt(whole) * 10n ** BigInt(decimals[asset]) +
    BigInt(fraction.padEnd(decimals[asset], "0"));
  if (units <= 0n || units > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Enter a valid positive amount.");
  return Number(units);
}

export default function AssetWallet({
  user,
  onConnect,
  onUpdated,
}: {
  user: User;
  onConnect: () => void;
  onUpdated: () => Promise<void>;
}) {
  const [data, setData] = useState<Assets | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"convert" | Asset | null>(null);
  const epoch = useRef(0);
  async function refresh() {
    const version = ++epoch.current;
    try {
      const next = await api<Assets>("/assets");
      if (version === epoch.current) {
        setData(next);
        setError("");
      }
    } catch (e) {
      if (version === epoch.current)
        setError(
          e instanceof Error ? e.message : "Could not refresh balances.",
        );
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      clearInterval(timer);
      epoch.current++;
    };
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 7000);
    return () => clearTimeout(timeout);
  }, [notice]);
  const linked =
    !user.wallet.startsWith("account:") && !user.wallet.startsWith("demo:");
  const simulated = data?.network === "simulated";
  return (
    <div className="asset-wallet">
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="info-box">
          {notice}
        </p>
      )}
      <section className="panel asset-summary">
        <div className="panel-heading">
          <h2>Available to withdraw</h2>
          <button className="text-button" onClick={() => void refresh()}>
            <RefreshCw size={16} /> Refresh balances
          </button>
        </div>
        <p className="muted">
          Earn LOOP from confirmed recycling. Convert it to USDC or SOL, or
          withdraw LOOP directly.
        </p>
        <p className="small muted">
          {simulated
            ? "Local simulation: no tokens leave the platform."
            : "Solana Devnet: test assets only, no real monetary value."}
        </p>
        {data?.mock_usdc && (
          <p className="info-box">
            Mock USD is a custom Devnet token, not Circle USDC. No monetary
            value. Mint:{" "}
            <span style={{ overflowWrap: "anywhere" }}>{data.usdc_mint}</span>
          </p>
        )}
        <div className="stats-grid asset-balances">
          {(["LOOP", "USDC", "SOL"] as Asset[]).map((asset) => (
            <div className="stat-card" key={asset}>
              <strong>{assetLabel(asset, data)}</strong>
              <div className="stat-value">
                {amountText(
                  data?.balances[asset].available_base_units || 0,
                  asset,
                )}
              </div>
              <p>
                {amountText(
                  data?.balances[asset].pending_base_units || 0,
                  asset,
                )}{" "}
                reserved for withdrawal
              </p>
              <button
                className="button secondary full"
                disabled={
                  !linked ||
                  !data?.withdrawals_configured ||
                  !data.balances[asset].available_base_units
                }
                onClick={() => setModal(asset)}
              >
                {simulated
                  ? `Simulate ${asset} withdrawal`
                  : `Withdraw ${assetLabel(asset, data)}`}{" "}
                <ArrowUpRight size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="asset-actions">
          <button
            className="button primary"
            disabled={!data?.balances.LOOP.available_base_units}
            onClick={() => setModal("convert")}
          >
            Convert LOOP
          </button>
          <button className="button secondary" onClick={onConnect}>
            <Wallet size={16} />
            {linked ? "Reconnect wallet" : "Link Solana wallet"}
          </button>
        </div>
        {linked ? (
          <p className="small account-wallet">
            Withdrawal wallet: {user.wallet}
          </p>
        ) : (
          <p className="small muted">
            Link your own Solana wallet before withdrawing.
          </p>
        )}
        {data && !data.withdrawals_configured && (
          <p className="small muted">
            Devnet withdrawals will be available once the operator configures
            and funds the treasury.
          </p>
        )}
        <p className="small muted">
          LOOP value = remaining fund ÷ distributed, unredeemed LOOP.{" "}
          {data &&
            `Fund: $${amountText(data.valuation.fund_usd_micros, "USDC")} · Outstanding: ${tokens(data.valuation.supply_base_units)} LOOP.`}{" "}
          Unallocated treasury LOOP is excluded. Withdrawn LOOP still counts
          until redeemed. Only LOOP held on the platform can be converted here.
        </p>
      </section>
      {!!data?.withdrawals.length && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Withdrawal history</h2>
          </div>
          {data.withdrawals.map((w) => (
            <div className="asset-history-row" key={w.id}>
              <div>
                <strong>
                  {amountText(w.amount_base_units, w.asset)}{" "}
                  {assetLabel(w.asset, data)}
                </strong>
                <p className="small account-wallet">To {w.destination}</p>
                <p className="small muted">
                  {date(w.created_at)}
                  {w.last_error ? ` · ${w.last_error}` : ""}
                </p>
              </div>
              <span className={`badge ${w.state}`}>
                {
                  (
                    {
                      queued: "Queued",
                      sent: "Confirming",
                      confirmed: simulated
                        ? "Simulated completion"
                        : "Sent to wallet",
                      review: "Needs review",
                    } as Record<string, string>
                  )[w.state]
                }
              </span>
              {w.signature && !w.signature.startsWith("demo:") && (
                <a
                  href={explorer(w.signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View transaction
                </a>
              )}
            </div>
          ))}
        </section>
      )}
      {!!data?.conversions.length && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Conversion history</h2>
          </div>
          {data.conversions.map((c) => (
            <div className="asset-history-row" key={c.id}>
              <strong>
                {tokens(c.loop_base_units)} LOOP →{" "}
                {amountText(c.output_base_units, c.asset)}{" "}
                {assetLabel(c.asset, data)}
              </strong>
              <span className="badge confirmed">Conversion complete</span>
              <span className="small muted">{date(c.created_at)}</span>
            </div>
          ))}
        </section>
      )}
      {modal && data && (
        <AssetAction
          key={modal}
          mode={modal}
          data={data}
          user={user}
          onClose={() => setModal(null)}
          onComplete={async (message) => {
            setNotice(message);
            setModal(null);
            await refresh();
            await onUpdated();
          }}
        />
      )}
    </div>
  );
}

function AssetAction({
  mode,
  data,
  user,
  onClose,
  onComplete,
}: {
  mode: "convert" | Asset;
  data: Assets;
  user: User;
  onClose: () => void;
  onComplete: (message: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [target, setTarget] = useState<"USDC" | "SOL">("USDC");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [review, setReview] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const convert = mode === "convert";
  const asset = convert ? "LOOP" : mode;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const units = parseAssetAmount(amount, asset);
      if (units > data.balances[asset].available_base_units)
        throw new Error("Insufficient available balance.");
      if (convert) {
        if (!quote) {
          setQuote(
            await api<Quote>("/assets/quotes", {
              loop_base_units: units,
              asset: target,
            }),
          );
          return;
        }
        const result = await api<Conversion>("/assets/conversions", {
          quote_id: quote.id,
          request_key: `quote:${quote.id}`,
        });
        await onComplete(
          `Converted ${tokens(result.loop_base_units)} LOOP to ${amountText(result.output_base_units, result.asset)} ${result.asset}. It is now available to withdraw.`,
        );
      } else {
        if (!review) {
          setReview(true);
          return;
        }
        const storageKey = `withdrawal:${user.id}:${asset}:${units}:${user.wallet}`;
        let requestKey = sessionStorage.getItem(storageKey);
        if (!requestKey) {
          requestKey = crypto.randomUUID();
          sessionStorage.setItem(storageKey, requestKey);
        }
        const result = await api<Withdrawal>("/assets/withdrawals", {
          asset,
          amount_base_units: units,
          destination: user.wallet,
          request_key: requestKey,
        });
        sessionStorage.removeItem(storageKey);
        await onComplete(
          data.network === "simulated"
            ? "Withdrawal simulation saved. No tokens were sent to your wallet."
            : `Withdrawal ${result.state === "confirmed" ? "completed" : "queued"}. ${amountText(units, asset)} ${asset} is reserved while we confirm the transfer.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={
        convert
          ? "Convert LOOP"
          : data.network === "simulated"
            ? `Simulate ${asset} withdrawal`
            : `Withdraw ${assetLabel(asset, data)}`
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <p className="muted">
          {data.network === "simulated"
            ? "This is a simulation. No blockchain funds are moved."
            : data.mock_usdc
              ? "This uses Mock USD, a custom Devnet token, not Circle USDC. No monetary value."
              : "This uses Solana Devnet test assets."}
        </p>
        <label htmlFor="asset-amount">{asset} amount</label>
        <input
          id="asset-amount"
          inputMode="decimal"
          required
          value={amount}
          disabled={busy || !!quote || review}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
        />
        <p className="small muted">
          Available:{" "}
          {amountText(data.balances[asset].available_base_units, asset)} {asset}
        </p>
        {convert && (
          <>
            <label htmlFor="convert-asset">Convert to</label>
            <select
              id="convert-asset"
              value={target}
              disabled={busy || !!quote}
              onChange={(e) => setTarget(e.target.value as "USDC" | "SOL")}
            >
              <option value="USDC">{assetLabel("USDC", data)}</option>
              <option>SOL</option>
            </select>
          </>
        )}
        {quote && (
          <div className="info-box quote-preview">
            <strong>
              You receive {amountText(quote.output_base_units, quote.asset)}{" "}
              {assetLabel(quote.asset, data)}
            </strong>
            <p>
              Fund: ${amountText(quote.fund_usd_micros, "USDC")} ÷{" "}
              {tokens(quote.supply_base_units)} distributed, unredeemed LOOP.
              Treasury inventory is excluded.
            </p>
            <p>
              {tokens(quote.loop_base_units)} LOOP will be deducted. The
              converted amount becomes available to withdraw immediately after
              confirmation.
            </p>
            {quote.asset === "SOL" && (
              <p>
                {data.network === "simulated"
                  ? "Demo fixture"
                  : "Coinbase spot reference"}
                : ${amountText(quote.sol_usd_micros, "USDC")} per SOL.
              </p>
            )}
            <p>
              Quote expires at{" "}
              {new Date(quote.expires_at * 1000).toLocaleTimeString()}. Changes
              to the fund or supply require a new quote. Amounts are rounded
              down to asset precision; no platform conversion fee.
            </p>
          </div>
        )}
        {!convert && (
          <div className="info-box">
            <strong>Destination: your linked wallet</strong>
            <p className="account-wallet">{user.wallet}</p>
            <p>
              Network: Solana Devnet. The platform pays the network fee.{" "}
              {review && `Confirm withdrawal of ${amount} ${asset}.`}
            </p>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="button-row">
          {(quote || review) && (
            <button
              type="button"
              disabled={busy}
              className="button secondary"
              onClick={() => {
                setQuote(null);
                setReview(false);
                setError("");
              }}
            >
              Edit amount / new quote
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : convert
                ? quote
                  ? "Confirm conversion"
                  : "Preview conversion"
                : review
                  ? data.network === "simulated"
                    ? "Confirm simulation"
                    : "Confirm withdrawal"
                  : "Review withdrawal"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
