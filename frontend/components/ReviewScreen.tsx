"use client";
import type { ReactNode } from "react";
import type { Claim } from "@/lib/api";
import { ArrowRight } from "lucide-react";
import { PageHeading } from "@/components/ui";
import { TicketLookup } from "@/components/CenterWorkspace";

type Props = {
  busy: boolean;
  claims: Claim[];
  activity: (list: Claim[], staff?: boolean) => ReactNode;
  onOpenTicket: (code: string) => void;
  filter: string;
  setFilter: (filter: string) => void;
};
export default function ReviewScreen({
  busy,
  claims,
  activity,
  onOpenTicket,
  filter,
  setFilter,
}: Props) {
  return (
    <>
      <PageHeading
        eyebrow="CENTER WORKSPACE"
        title="Good work starts here."
        text="Inspect the materials, record the actual intake, and confirm the drop-off."
      />
      <div className="review-grid">
        <TicketLookup busy={busy} onOpen={onOpenTicket} />
        <section className="panel">
          <div className="panel-heading">
            <h2>Drop-off queue</h2>
            <select
              aria-label="Filter claims"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">All drop-offs</option>
              <option value="pending">Awaiting review</option>
              <option value="verified">Confirmed</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          {activity(
            claims.filter(
              (c) =>
                filter === "all" ||
                (filter === "pending"
                  ? ["submitted", "awaiting_review"].includes(c.status)
                  : c.status === filter),
            ),
            true,
          )}
        </section>
      </div>
    </>
  );
}
