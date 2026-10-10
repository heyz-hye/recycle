"use client";
import type { Claim, User, WalletData } from "@/lib/api";
import { number, tokens } from "@/lib/api";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDollarSign,
  Leaf,
  Package,
  Plus,
  Recycle,
  Share2,
  ShieldCheck,
  X,
} from "lucide-react";
import { Badge, Empty, Stat } from "@/components/ui";
import type { Page } from "@/components/screens-types";
import type { ReactNode } from "react";

type Props = {
  user: User;
  wallet: WalletData | null;
  claims: Claim[];
  myBottleCount: number;
  myCardboard: number;
  prompt?: Claim;
  activity: (list: Claim[], staff?: boolean) => ReactNode;
  navigate: (page: Page) => void;
  onShareClaim: (claim: Claim) => void;
  onDismissShare: (id: string) => void;
};
export default function OverviewScreen({
  user,
  wallet,
  claims,
  myBottleCount,
  myCardboard,
  prompt,
  activity,
  navigate,
  onShareClaim,
  onDismissShare,
}: Props) {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SMALL STEPS. REAL IMPACT.</span>
          <h1>
            A little greener, {user.username.split(" ")[0]}{" "}
            <span className="leaf-heading">✳</span>
          </h1>
          <p>Good habits come full circle. Here’s what yours look like.</p>
        </div>
        <button
          className="button primary"
          onClick={() =>
            navigate(
              user.role === "recycler"
                ? "dropoff"
                : user.role === "verifier"
                  ? "review"
                  : "funding",
            )
          }
        >
          {user.role === "recycler" ? (
            <Plus size={18} />
          ) : (
            <ArrowRight size={18} />
          )}
          {user.role === "recycler"
            ? "New drop-off"
            : user.role === "verifier"
              ? "Open center workspace"
              : "Manage funding"}
        </button>
      </div>
      <section className="hero-card">
        <div className="hero-content">
          <span className="hero-kicker">
            <span /> A BETTER CYCLE STARTS WITH YOU
          </span>
          <h2>
            Your recycling.
            <br />A world of possibility.
          </h2>
          <p>
            Give everyday materials a new beginning.
            <br />
            We’ll make sure your effort gets recognized.
          </p>
          <button onClick={() => navigate("impact")}>
            See our collective impact <ArrowUpRight size={17} />
          </button>
        </div>
        <div className="hero-art">
          <div className="hero-ring r1" />
          <div className="hero-ring r2" />
          <div className="hero-ring r3" />
          <Recycle className="hero-recycle" strokeWidth={1.2} />
          <div className="hero-sticker">
            <Leaf size={15} /> Every little bit counts
          </div>
          <span className="spark s1">✳</span>
          <span className="spark s2">✦</span>
        </div>
      </section>
      <section className="stats-grid">
        <Stat
          label="Your confirmed rewards"
          value={tokens(
            wallet?.rewards
              .filter((r) => r.state === "confirmed")
              .reduce((n, r) => n + r.amount_base_units, 0) || 0,
          )}
          unit="LOOP"
          icon={<CircleDollarSign size={19} />}
          note="Earned from center-confirmed intake"
        />
        <Stat
          label="Plastic bottles"
          value={number(myBottleCount)}
          unit="bottles"
          icon={<Recycle size={19} />}
          note="Accepted for a new beginning"
        />
        <Stat
          label="Dry cardboard"
          value={number(myCardboard / 1000)}
          unit="kg"
          icon={<Package size={19} />}
          note="Measured and confirmed by your center"
        />
      </section>
      {user.role === "recycler" && prompt && (
        <div className="share-prompt">
          <span className="check-disc">
            <Check size={18} />
          </span>
          <div>
            <strong>That’s an impact worth sharing.</strong>
            <p>
              Your drop-off is center confirmed. Create a post for your own
              social platform.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => onShareClaim(prompt)}
          >
            <Share2 size={16} /> Share your impact
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss sharing prompt"
            onClick={() => onDismissShare(prompt.id)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {user.role === "verifier"
                ? "Center activity"
                : "Your recent drop-offs"}
            </h2>
            <span className="count-label">{claims.length} total</span>
          </div>
          {activity(claims.slice(0, 4), user.role === "verifier")}
          <div className="panel-footer">
            <ShieldCheck size={15} /> Every reward begins with center
            confirmation.
          </div>
        </section>
        <section className="panel how-it-works">
          <div className="panel-heading">
            <h2>A simple, better cycle</h2>
            <Recycle size={18} />
          </div>
          {[
            {
              n: "01",
              title: "Bring the good stuff",
              text: "Collect plastic bottles and clean, dry cardboard.",
            },
            {
              n: "02",
              title: "Make it official",
              text: "Your center confirms the materials and actual quantities.",
            },
            {
              n: "03",
              title: "Enjoy your rewards",
              text: "Receive LOOP, then share your impact if you like.",
            },
          ].map((s) => (
            <div className="step" key={s.n}>
              <span>{s.n}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
          <button
            className="text-button"
            onClick={() =>
              navigate(user.role === "recycler" ? "dropoff" : "impact")
            }
          >
            Let’s make a difference <ArrowRight size={16} />
          </button>
        </section>
      </div>
    </>
  );
}
