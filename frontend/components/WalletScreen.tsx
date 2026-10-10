"use client";
import type { WalletData } from "@/lib/api";
import { Badge, Empty, PageHeading } from "@/components/ui";
import { ArrowUpRight, ExternalLink, ShieldCheck, Wallet } from "lucide-react";
import { date, dollars, explorer, tokens } from "@/lib/api";

type Props = {
  wallet: WalletData | null;
  demo: boolean;
  onShowRedeem: () => void;
  onShowConnect: () => void;
};
export default function WalletScreen({
  wallet,
  demo,
  onShowRedeem,
  onShowConnect,
}: Props) {
  return (
    <>
      <PageHeading
        eyebrow="YOUR EFFORT, RECOGNIZED"
        title="Good things come around."
        text="Your rewards, from center confirmation to your wallet."
      />
      <div className="wallet-grid">
        <div className="wallet-card">
          <span className="hero-kicker">AVAILABLE BALANCE</span>
          <div>
            {tokens(wallet?.balance_base_units || 0)} <small>LOOP</small>
          </div>
          <p>
            {tokens(wallet?.pending_base_units || 0)} LOOP awaiting funding or
            transaction confirmation
          </p>
          <button
            className="button lime"
            disabled={!wallet || wallet.balance_base_units < 100}
            onClick={onShowRedeem}
          >
            Simulate redemption <ArrowUpRight size={17} />
          </button>
          <span className="wallet-label">
            {demo ? "Simulated tokens" : "Solana Devnet tokens"} · No real
            monetary value
          </span>
        </div>
        <div className="panel wallet-explainer">
          <ShieldCheck size={30} />
          <h2>Confirmed means received.</h2>
          <p>
            Rewards become available once the token transaction is confirmed.
            Center approval is the first step.
          </p>
          <p className="small">
            Demo conversion: 1 LOOP = $0.01 of simulated credit. No actual money
            is paid.
          </p>
          {!demo && (
            <button className="button secondary" onClick={onShowConnect}>
              Reconnect wallet
            </button>
          )}
        </div>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <h2>Reward history</h2>
          <span className="pill">
            {demo ? "Simulated ledger" : "Solana Devnet"}
          </span>
        </div>
        {wallet?.rewards.length ? (
          wallet.rewards.map((r) => (
            <div className="transaction-row" key={r.id}>
              <span className="material-icon">
                <ArrowUpRight size={21} />
              </span>
              <div>
                <strong>Recycling reward</strong>
                <p>{date(r.created_at)}</p>
              </div>
              <Badge state={r.state} />
              <strong className="green">
                +{tokens(r.amount_base_units)} LOOP
              </strong>
              {r.signature && !r.signature.startsWith("demo:") && (
                <a
                  className="icon-button"
                  href={explorer(r.signature)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View transaction in Solana Explorer"
                >
                  <ExternalLink size={18} />
                </a>
              )}
            </div>
          ))
        ) : (
          <Empty title="A fresh start">
            Your confirmed recycling rewards will appear here.
          </Empty>
        )}
      </section>
      {!!wallet?.redemptions.length && (
        <section className="panel section-gap">
          <div className="panel-heading">
            <h2>Simulated redemptions</h2>
          </div>
          {wallet.redemptions.map((r) => (
            <div className="transaction-row" key={r.id}>
              <span className="material-icon cardboard">
                <Wallet size={20} />
              </span>
              <div>
                <strong>{tokens(r.amount_base_units)} LOOP</strong>
                <p>
                  {r.state === "completed"
                    ? `${dollars(r.payout_cents)} simulated credit`
                    : "Awaiting your confirmed burn"}
                </p>
              </div>
              <Badge state={r.state} />
              {r.state === "pending" && (
                <button className="text-button" onClick={onShowRedeem}>
                  Resume
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
