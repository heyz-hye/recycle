"use client";
import type { ReactNode } from "react";
import { Sprout } from "lucide-react";

export function Badge({ state }: { state: string }) {
  const labels: Record<string, string> = {
    submitted: "Awaiting center",
    awaiting_review: "In review",
    awaiting_funding: "Awaiting funding",
    verified: "Center confirmed",
    rejected: "Not accepted",
    queued: "Reward queued",
    sent: "Confirming reward",
    confirmed: "Reward received",
    pending: "Pending",
    completed: "Completed",
  };
  return (
    <span className={`badge ${state}`}>
      <span />
      {labels[state] || state}
    </span>
  );
}

export function Stat({
  label,
  value,
  unit,
  icon,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: ReactNode;
  note: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <div className="stat-value">
        {value} <small>{unit}</small>
      </div>
      <p>{note}</p>
    </div>
  );
}

export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Sprout size={26} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text: string;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
    </div>
  );
}
