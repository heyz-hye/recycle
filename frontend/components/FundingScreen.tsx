"use client";
import type { Funding } from "@/lib/api";
import {
  CircleDollarSign,
  CheckCircle2,
  Clock3,
  RefreshCw,
} from "lucide-react";
import { date, dollars } from "@/lib/api";
import { PageHeading, Stat } from "@/components/ui";
import FundingForm from "@/components/FundingForm";

type Props = {
  funding: Funding | null;
  busy: boolean;
  onFund: (data: unknown) => Promise<boolean>;
};
export default function FundingScreen({ funding, busy, onFund }: Props) {
  return (
    <>
      <PageHeading
        eyebrow="MAKE GOOD THINGS POSSIBLE"
        title="Fuel the next good habit."
        text="Keep rewards funded, traceable, and ready for the people making a difference."
      />
      <div className="stats-grid four">
        <Stat
          label="Available funding"
          value={dollars(funding?.available_cents || 0)}
          icon={<CircleDollarSign size={19} />}
          note="Available for new reservations"
        />
        <Stat
          label="Reserved"
          value={dollars(funding?.reserved_cents || 0)}
          icon={<Clock3 size={19} />}
          note="Committed to pending rewards"
        />
        <Stat
          label="Rewards issued"
          value={dollars(funding?.issued_cents || 0)}
          icon={<CheckCircle2 size={19} />}
          note="Confirmed reward allocation"
        />
        <Stat
          label="Pending reimbursement"
          value={dollars(funding?.pending_reimbursement_cents || 0)}
          icon={<RefreshCw size={19} />}
          note="Excluded from available funding"
        />
      </div>
      <div className="review-grid">
        <FundingForm
          busy={busy}
          waiting={funding?.awaiting_funding || 0}
          onFund={onFund}
        />
        <section className="panel">
          <div className="panel-heading">
            <h2>Funding activity</h2>
            <span className="pill">Simulated funds</span>
          </div>
          {funding?.ledger.map((l) => (
            <div className="transaction-row" key={l.id}>
              <span className="material-icon">
                <CircleDollarSign size={19} />
              </span>
              <div>
                <strong>
                  {(
                    {
                      received: "Funding received",
                      reserved: "Reward reserved",
                      issued: "Reward issued",
                      simulated_payout: "Simulated payout",
                    } as Record<string, string>
                  )[l.kind] || l.kind}
                </strong>
                <p>{date(l.created_at)}</p>
              </div>
              <strong className="push-right">{dollars(l.amount_cents)}</strong>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
