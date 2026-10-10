"use client";
import { useState, useEffect, useCallback, useRef, ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Plus,
  Recycle,
  LayoutDashboard,
  Wallet,
  Leaf,
  LogOut,
  ChevronRight,
  MapPin,
  Check,
  Package,
  ScanLine,
  CircleDollarSign,
  ShieldCheck,
  Copy,
  RefreshCw,
  Menu,
  X,
  Share2,
  CheckCircle2,
  Sprout,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  api,
  ApiError,
  User,
  Claim,
  WalletData,
  Impact,
  Funding,
  Center,
  tokens,
  date,
  material,
  quantity,
} from "@/lib/api";
import Modal from "@/components/Modal";
import Share from "@/components/Share";
import Chatbot from "@/components/Chatbot";

import { Badge, Empty } from "@/components/ui";
import { Review } from "@/components/CenterWorkspace";
import Connect from "@/components/Connect";
import Redeem from "@/components/Redeem";
import type { Page } from "@/components/screens-types";
import OverviewScreen from "@/components/OverviewScreen";
import DropoffScreen from "@/components/DropoffScreen";
import ReviewScreen from "@/components/ReviewScreen";
import WalletScreen from "@/components/WalletScreen";
import ImpactScreen from "@/components/ImpactScreen";
import FundingScreen from "@/components/FundingScreen";

const names: Record<Page, string> = {
  overview: "Overview",
  dropoff: "New drop-off",
  wallet: "My wallet",
  impact: "Our impact",
  review: "Center workspace",
  funding: "Funding",
};
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("");
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<Page>("overview");
  const [claims, setClaims] = useState<Claim[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [funding, setFunding] = useState<Funding | null>(null);
  const [centers, setCenters] = useState<Center[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [ticket, setTicket] = useState<Claim | null>(null);
  const [share, setShare] = useState<Claim | null>(null);
  const [selected, setSelected] = useState<Claim | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [filter, setFilter] = useState("all");
  const generation = useRef(0);
  const demo = mode === "demo";
  useEffect(() => {
    Promise.all([
      api<{ mode: string }>("/health"),
      api<User>("/auth/me").catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([health, account]) => {
        setMode(health.mode);
        setUser(account);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  const load = useCallback(async () => {
    if (!user) return;
    const epoch = ++generation.current;
    try {
      const [c, w, i, z, f] = await Promise.all([
        api<Claim[]>("/claims"),
        api<WalletData>("/wallet"),
        api<Impact>("/impact"),
        api<Center[]>("/centers"),
        user.role === "funding_partner"
          ? api<Funding>("/funding")
          : Promise.resolve(null),
      ]);
      if (epoch !== generation.current) return;
      setClaims(c);
      setWallet(w);
      setImpact(i);
      setCenters(z);
      setFunding(f);
    } catch (e) {
      if (epoch === generation.current) {
        if (e instanceof ApiError && e.status === 401) setUser(null);
        setError(e instanceof Error ? e.message : "Unable to refresh data.");
      }
    }
  }, [user]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function action(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function signedIn(u: User) {
    generation.current++;
    setUser(u);
    setClaims([]);
    setWallet(null);
    setFunding(null);
    setPage(
      u.role === "verifier"
        ? "review"
        : u.role === "funding_partner"
          ? "funding"
          : "overview",
    );
    setShowConnect(false);
    setTicket(null);
    setSelected(null);
    setShare(null);
    setShowRedeem(false);
  }
  async function demoLogin(account: string) {
    await action(async () =>
      signedIn(await api<User>("/auth/demo", { account })),
    );
  }
  function navigate(p: Page) {
    setPage(p);
    setMobileNav(false);
    setError("");
  }
  const accepted = claims.filter((c) => c.status === "verified");
  const myBottleCount = accepted.reduce(
    (n, c) =>
      n +
      c.items
        .filter((i) => i.material === "bottles")
        .reduce((a, i) => a + (i.accepted_quantity || 0), 0),
    0,
  );
  const myCardboard = accepted.reduce(
    (n, c) =>
      n +
      c.items
        .filter((i) => i.material === "cardboard")
        .reduce((a, i) => a + (i.accepted_quantity || 0), 0),
    0,
  );
  const prompt = accepted.find((c) => !dismissed.includes(c.id));
  const nav: { id: Page; icon: ReactNode }[] = [
    { id: "overview", icon: <LayoutDashboard size={19} /> },
    ...(user?.role === "recycler"
      ? [
          { id: "dropoff" as Page, icon: <Plus size={19} /> },
          { id: "wallet" as Page, icon: <Wallet size={19} /> },
        ]
      : []),
    ...(user?.role === "verifier"
      ? [{ id: "review" as Page, icon: <ScanLine size={19} /> }]
      : []),
    ...(user?.role === "funding_partner"
      ? [{ id: "funding" as Page, icon: <CircleDollarSign size={19} /> }]
      : []),
    { id: "impact", icon: <Leaf size={19} /> },
  ];

  function activity(list: Claim[], staff = false) {
    return list.length ? (
      <div className="activity-list">
        {list.map((c) => (
          <div className="activity-row" key={c.id}>
            <div
              className={`material-icon ${c.items.some((i) => i.material === "cardboard") ? "cardboard" : ""}`}
            >
              {c.items.some((i) => i.material === "cardboard") ? (
                <Package size={21} />
              ) : (
                <Recycle size={21} />
              )}
            </div>
            <div className="activity-main">
              <strong>
                {c.items.map((i) => material(i.material)).join(" + ")}
              </strong>
              <span>
                {staff ? c.username : c.center_name}{" "}
                <span className="separator">·</span> {date(c.created_at)}
              </span>
              <span className="activity-quantity">
                {c.items
                  .map((i) => quantity(i, c.status === "verified"))
                  .join(" · ")}
              </span>
              {c.verification?.reason && (
                <small className="muted">{c.verification.reason}</small>
              )}
            </div>
            <div className="activity-state">
              {c.reward && (
                <strong
                  className={c.reward.state === "confirmed" ? "green" : ""}
                >
                  {c.reward.state === "confirmed" ? "+" : ""}
                  {tokens(c.reward.amount_base_units)} <small>LOOP</small>
                </strong>
              )}
              <Badge state={c.reward?.state || c.status} />
              {c.reward?.needs_review ? (
                <small className="error-text">
                  Transaction needs staff review
                </small>
              ) : null}
            </div>
            <div className="activity-action">
              {staff ? (
                <button
                  className="icon-button"
                  aria-label={`Review ${c.username}'s claim`}
                  onClick={() => setSelected(c)}
                >
                  <ChevronRight size={20} />
                </button>
              ) : c.status === "verified" ? (
                <button
                  className="button small-button secondary"
                  onClick={() =>
                    action(async () =>
                      setShare(await api<Claim>(`/claims/${c.id}`)),
                    )
                  }
                >
                  <Share2 size={14} /> Share
                </button>
              ) : c.status !== "rejected" ? (
                <button className="text-button" onClick={() => setTicket(c)}>
                  View ticket <ArrowUpRight size={14} />
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Empty title="Your next good habit starts here">
        Create a drop-off, bring your materials to the center, and let the
        rewards follow.
      </Empty>
    );
  }

  if (!ready)
    return (
      <div className="loading">
        <Recycle className="spin" size={34} />
        <p>Getting things ready…</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-page">
        <header>
          <a className="brand" href="/">
            <span className="brand-icon">
              <Recycle size={25} />
            </span>
            loopmint<span className="brand-dot">.</span>
          </a>
          <span className="pill">
            <span className="live-dot" /> A little better, together
          </span>
        </header>
        <main className="login-main">
          <div className="login-copy">
            <span className="eyebrow">GOOD FOR THE PLANET. GOOD FOR YOU.</span>
            <h1>
              Small steps.
              <br />
              <span>Full circle.</span>
            </h1>
            <p>
              Turn your everyday recycling into something rewarding. Bring it
              in, get it confirmed, and make your impact count.
            </p>
            <div className="login-actions">
              {demo && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => demoLogin("recycler")}
                >
                  Try the recycler demo <ArrowRight size={18} />
                </button>
              )}
              <button
                className={`button ${demo ? "secondary" : "primary"}`}
                disabled={!mode}
                onClick={() => setShowConnect(true)}
              >
                <Wallet size={18} /> Connect wallet
              </button>
            </div>
            {demo && (
              <div className="demo-links">
                <span>Explore another role</span>
                <button disabled={busy} onClick={() => demoLogin("verifier")}>
                  Center staff <ArrowUpRight size={14} />
                </button>
                <button disabled={busy} onClick={() => demoLogin("partner")}>
                  Funding partner <ArrowUpRight size={14} />
                </button>
              </div>
            )}
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <div className="login-proof">
              <ShieldCheck size={21} />
              <span>
                Confirmed by real recycling centers.
                <br />
                <strong>Your effort, recognized.</strong>
              </span>
            </div>
          </div>
          <div className="login-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="art-label">THE EVERYDAY IMPACT CLUB</div>
            <div className="recycle-art">
              <Recycle strokeWidth={1.15} />
            </div>
            <div className="floating-note">
              <div className="check-disc">
                <Check size={19} />
              </div>
              <div>
                Little actions.<strong>Meaningful change.</strong>
              </div>
              <Sprout size={30} />
            </div>
            <span className="art-bottom">Collect. Confirm. Celebrate. ↗</span>
          </div>
        </main>
        <footer>
          Built for a world with a little less waste.
          <span>
            {demo
              ? "Local demo · Simulated tokens · No monetary value"
              : "Solana Devnet · Tokens have no monetary value"}
          </span>
        </footer>
        {showConnect && (
          <Connect onClose={() => setShowConnect(false)} onLogin={signedIn} />
        )}
      </div>
    );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-icon">
            <Recycle size={25} />
          </span>
          loopmint<span className="brand-dot">.</span>
        </a>
        <span className="sidebar-label">YOUR EVERYDAY IMPACT</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => navigate(n.id)}
            >
              {n.icon}
              {names[n.id]}
              {n.id === "review" &&
                claims.some(
                  (c) =>
                    c.status === "submitted" || c.status === "awaiting_review",
                ) && (
                  <span className="nav-count">
                    {
                      claims.filter((c) =>
                        ["submitted", "awaiting_review"].includes(c.status),
                      ).length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="planet-note">
            <div>
              <Sprout size={24} />
              <span>It all adds up.</span>
            </div>
            <p>
              One bottle. One box.
              <br />
              One better tomorrow.
            </p>
          </div>
          <div className="network">
            <span className="live-dot" />{" "}
            {demo ? "Local demo" : "Solana Devnet"}
            <span className="tiny">No monetary value</span>
          </div>
          <button
            className="signout"
            disabled={busy}
            onClick={() =>
              action(async () => {
                await api("/auth/logout", {});
                generation.current++;
                setUser(null);
              })
            }
          >
            <LogOut size={17} /> Sign out
          </button>
        </div>
      </aside>
      {mobileNav && (
        <button
          aria-label="Close menu"
          className="nav-scrim"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Open navigation"
            >
              <Menu size={22} />
            </button>
            <span>My workspace</span>
            <ChevronRight size={14} />
            <strong>{names[page]}</strong>
          </div>
          <div className="topbar-right">
            {demo && (
              <label className="role-switch">
                <span>DEMO VIEW</span>
                <select
                  aria-label="Demo account"
                  disabled={busy}
                  value={user.id}
                  onChange={(e) => demoLogin(e.target.value)}
                >
                  <option value="recycler">Recycler</option>
                  <option value="verifier">Center staff · Greenpoint</option>
                  <option value="verifier-williamsburg">
                    Center staff · Williamsburg
                  </option>
                  <option value="verifier-downtown">
                    Center staff · Downtown
                  </option>
                  <option value="partner">Funding partner</option>
                </select>
              </label>
            )}
            <div className="avatar">
              {user.username
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("")}
            </div>
          </div>
        </header>
        <main className="workspace">
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {notice}
            </div>
          )}
          {page === "overview" && (
            <OverviewScreen
              user={user}
              wallet={wallet}
              claims={claims}
              myBottleCount={myBottleCount}
              myCardboard={myCardboard}
              prompt={prompt}
              activity={activity}
              navigate={navigate}
              onShareClaim={(claim) =>
                action(async () =>
                  setShare(await api<Claim>(`/claims/${claim.id}`)),
                )
              }
              onDismissShare={(id) => setDismissed([...dismissed, id])}
            />
          )}
          {page === "dropoff" && (
            <DropoffScreen
              centers={centers}
              busy={busy}
              onCreateTicket={(data) =>
                action(async () => {
                  const created = await api<Claim>("/claims", data);
                  setTicket(created);
                  await load();
                  setPage("overview");
                })
              }
            />
          )}
          {page === "review" && (
            <ReviewScreen
              busy={busy}
              claims={claims}
              activity={activity}
              filter={filter}
              setFilter={setFilter}
              onOpenTicket={(code) =>
                action(async () => {
                  const opened = await api<Claim>("/claims/ticket", {
                    ticket: code,
                  });
                  setSelected(opened);
                  await load();
                })
              }
            />
          )}
          {page === "wallet" && (
            <WalletScreen
              wallet={wallet}
              demo={demo}
              onShowRedeem={() => setShowRedeem(true)}
              onShowConnect={() => setShowConnect(true)}
            />
          )}
          {page === "impact" && <ImpactScreen impact={impact} />}
          {page === "funding" && (
            <FundingScreen
              funding={funding}
              busy={busy}
              onFund={(data) =>
                action(async () => {
                  setFunding(await api<Funding>("/funding", data));
                  setNotice(
                    "Demo funding added. Eligible waiting rewards are now queued.",
                  );
                  await load();
                })
              }
            />
          )}
          <footer className="workspace-footer">
            <span>Small steps. Full circle.</span>
            <span>
              LoopMint · {demo ? "Local demo" : "Solana Devnet"} · No real
              monetary value
            </span>
          </footer>
        </main>
      </div>
      <Chatbot />
      {ticket && (
        <Modal title="Your drop-off ticket" onClose={() => setTicket(null)}>
          {error && (
            <p role="alert" className="error-banner">
              {error}
            </p>
          )}
          <div className="ticket">
            <span className="pill">
              <MapPin size={14} /> {ticket.center_name}
            </span>
            <QRCodeSVG value={ticket.ticket} size={208} marginSize={2} />
            <h3>Bring this. Bring your recycling.</h3>
            <p>{ticket.items.map((i) => quantity(i)).join(" + ")}</p>
            <p className="muted small">
              Valid until{" "}
              {new Date(ticket.ticket_expires_at * 1000).toLocaleTimeString(
                [],
                { hour: "numeric", minute: "2-digit" },
              )}
              . Staff scan your ticket and confirm the physical intake.
            </p>
            <code>{ticket.ticket}</code>
            <div className="button-row">
              <button
                className="button secondary"
                onClick={() =>
                  action(async () => {
                    await navigator.clipboard.writeText(ticket.ticket);
                    setNotice("Ticket code copied");
                  })
                }
              >
                <Copy size={16} /> Copy ticket code
              </button>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() =>
                  action(async () => {
                    setTicket(
                      await api<Claim>(`/claims/${ticket.id}/renew`, {}),
                    );
                    await load();
                  })
                }
              >
                <RefreshCw size={16} /> Renew
              </button>
            </div>
          </div>
        </Modal>
      )}
      {share && (
        <Share
          claim={share}
          demo={demo}
          onClose={() => {
            setDismissed([...dismissed, share.id]);
            setShare(null);
          }}
        />
      )}
      {selected && (
        <Review
          error={error}
          claim={claims.find((c) => c.id === selected.id) || selected}
          busy={busy}
          onClose={() => setSelected(null)}
          onOpen={() =>
            action(async () => {
              setSelected(
                await api<Claim>("/claims/ticket", { ticket: selected.ticket }),
              );
              await load();
            })
          }
          onConfirm={(data) =>
            action(async () => {
              const c = await api<Claim>(
                `/claims/${selected.id}/confirm`,
                data,
              );
              setSelected(null);
              setNotice(
                c.status === "verified"
                  ? "Intake confirmed. The reward will be issued once funded and confirmed."
                  : "The drop-off was marked as not accepted.",
              );
              await load();
            })
          }
        />
      )}
      {showConnect && (
        <Connect onClose={() => setShowConnect(false)} onLogin={signedIn} />
      )}
      {showRedeem && wallet && (
        <Redeem
          user={user}
          wallet={wallet}
          demo={demo}
          onClose={() => setShowRedeem(false)}
          onComplete={async () => {
            await load();
            setNotice("Redemption updated. All payouts are simulated.");
          }}
        />
      )}
    </div>
  );
}
