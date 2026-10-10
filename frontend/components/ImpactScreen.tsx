"use client";
import type { Impact } from "@/lib/api";
import { number } from "@/lib/api";
import {
  CheckCircle2,
  Leaf,
  MapPin,
  Package,
  Recycle,
  ShieldCheck,
} from "lucide-react";
import { PageHeading, Stat } from "@/components/ui";
import ImpactChart from "@/components/ImpactChart";

type Props = { impact: Impact | null };
export default function ImpactScreen({ impact }: Props) {
  return (
    <>
      <PageHeading
        eyebrow="BETTER, TOGETHER"
        title="Little actions. Lasting impact."
        text="A collective view of recycling intake confirmed by our participating centers."
      />
      <div className="stats-grid four">
        <Stat
          label="Bottles accepted"
          value={number(impact?.bottles || 0)}
          icon={<Recycle size={19} />}
          note="Counted by center staff"
        />
        <Stat
          label="Cardboard accepted"
          value={number((impact?.cardboard_grams || 0) / 1000)}
          unit="kg"
          icon={<Package size={19} />}
          note="Verified intake weight"
        />
        <Stat
          label="Confirmed drop-offs"
          value={number(impact?.dropoffs || 0)}
          icon={<CheckCircle2 size={19} />}
          note="Each drop-off counted once"
        />
        <Stat
          label="People taking action"
          value={number(impact?.participants || 0)}
          icon={<Leaf size={19} />}
          note="Recyclers with confirmed intake"
        />
      </div>
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Small steps, adding up</h2>
            <p className="muted small">
              Plastic bottles accepted per day · Last 7 days · UTC
            </p>
          </div>
          <span className="pill">
            <span className="live-dot" /> Updates every 5s
          </span>
        </div>
        <ImpactChart impact={impact} />
      </section>
      <div className="section-gap panel">
        <div className="panel-heading">
          <h2>Our participating centers</h2>
        </div>
        {impact?.centers.map((c) => (
          <div key={c.id} className="transaction-row">
            <span className="material-icon">
              <MapPin size={21} />
            </span>
            <strong>{c.name}</strong>
            <span className="push-right muted">
              {c.dropoffs} confirmed drop-offs
            </span>
          </div>
        ))}
      </div>
      <p className="footnote">
        <ShieldCheck size={16} /> These figures represent verified intake for
        recycling, not proof of downstream processing.
      </p>
    </>
  );
}
