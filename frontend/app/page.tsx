"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  FormEvent,
  ReactNode,
} from "react";
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
  Clock3,
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
  ExternalLink,
  Sprout,
  MoveUpRight,
  Trash2,
  UserRound,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  api,
  ApiError,
  User,
  Claim,
  WalletData,
  Impact,
  Funding,
  Center,
  Redemption,
  number,
  tokens,
  dollars,
  date,
  material,
  quantity,
  explorer,
} from "@/lib/api";
import { wallets, loginWallet, signBurn } from "@/lib/wallet";
import Modal from "@/components/Modal";
import Share from "@/components/Share";
import Scanner from "@/components/Scanner";
import CenterPicker from "@/components/CenterPicker";
import { AccountLogin, AccountDetails } from "@/components/Account";
import Assistant from "@/components/Assistant";

type Page = "overview" | "dropoff" | "wallet" | "impact" | "review" | "funding";
const names: Record<Page, string> = {
  overview: "Overview",
  dropoff: "New drop-off",
  wallet: "My wallet",
  impact: "Our impact",
  review: "Center workspace",
  funding: "Funding",
};
function Badge({ state }: { state: string }) {
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
function Stat({
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
function Empty({ title, children }: { title: string; children: ReactNode }) {
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

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState("");
  const [demoAccounts, setDemoAccounts] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
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
      api<{
        mode: string;
        demo_accounts_enabled: boolean;
        assistant_enabled: boolean;
      }>("/health"),
      api<User>("/auth/me").catch((e) => {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }),
    ])
      .then(([health, account]) => {
        setMode(health.mode);
        setDemoAccounts(health.demo_accounts_enabled);
        setAssistantEnabled(health.assistant_enabled);
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
    setMobileNav(false);
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
    setShowAccount(false);
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
            <AccountLogin onLogin={signedIn} />
            <div className="login-actions">
              {demoAccounts && (
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
            {demoAccounts && (
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
            onClick={() => {
              setShowAccount(true);
              setMobileNav(false);
            }}
          >
            <UserRound size={18} /> My account
          </button>
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
            {demoAccounts && user.wallet.startsWith("demo:") && (
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
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">SMALL STEPS. REAL IMPACT.</span>
                  <h1>
                    A little greener, {user.username.split(" ")[0]}{" "}
                    <span className="leaf-heading">✳</span>
                  </h1>
                  <p>
                    Good habits come full circle. Here’s what yours look like.
                  </p>
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
                      Your drop-off is center confirmed. Create a post for your
                      own social platform.
                    </p>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() =>
                      action(async () =>
                        setShare(await api<Claim>(`/claims/${prompt.id}`)),
                      )
                    }
                  >
                    <Share2 size={16} /> Share your impact
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Dismiss sharing prompt"
                    onClick={() => setDismissed([...dismissed, prompt.id])}
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
          )}
          {page === "dropoff" && (
            <>
              <PageHeading
                eyebrow="YOUR NEXT GOOD DEED"
                title="Give it a new beginning."
                text="Tell us what you’re bringing. Your center will confirm the final quantities."
              />
              <Dropoff
                centers={centers}
                busy={busy}
                onSubmit={(data) =>
                  action(async () => {
                    const created = await api<Claim>("/claims", data);
                    setTicket(created);
                    await load();
                    setPage("overview");
                  })
                }
              />
            </>
          )}
          {page === "review" && (
            <>
              <PageHeading
                eyebrow="CENTER WORKSPACE"
                title="Good work starts here."
                text={`${user.job_location || "Your assigned center"} · ${user.job_title || "Center staff"}. Inspect the materials, record the actual intake, and confirm the drop-off.`}
              />
              <div className="review-grid">
                <TicketLookup
                  busy={busy}
                  onOpen={(code) =>
                    action(async () => {
                      const c = await api<Claim>("/claims/ticket", {
                        ticket: code,
                      });
                      setSelected(c);
                      await load();
                    })
                  }
                />
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
          )}
          {page === "wallet" && (
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
                    {tokens(wallet?.balance_base_units || 0)}{" "}
                    <small>LOOP</small>
                  </div>
                  <p>
                    {tokens(wallet?.pending_base_units || 0)} LOOP awaiting
                    funding or transaction confirmation
                  </p>
                  <button
                    className="button lime"
                    disabled={!wallet || wallet.balance_base_units < 100}
                    onClick={() => setShowRedeem(true)}
                  >
                    Simulate redemption <ArrowUpRight size={17} />
                  </button>
                  <span className="wallet-label">
                    {demo ? "Simulated tokens" : "Solana Devnet tokens"} · No
                    real monetary value
                  </span>
                </div>
                <div className="panel wallet-explainer">
                  <ShieldCheck size={30} />
                  <h2>Confirmed means received.</h2>
                  <p>
                    Rewards become available once the token transaction is
                    confirmed. Center approval is the first step.
                  </p>
                  <p className="small">
                    Demo conversion: 1 LOOP = $0.01 of simulated credit. No
                    actual money is paid.
                  </p>
                  {!demo && (
                    <button
                      className="button secondary"
                      onClick={() => setShowConnect(true)}
                    >
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
                        <button
                          className="text-button"
                          onClick={() => setShowRedeem(true)}
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {page === "impact" && (
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
                <ShieldCheck size={16} /> These figures represent verified
                intake for recycling, not proof of downstream processing.
              </p>
            </>
          )}
          {page === "funding" && (
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
                      <strong className="push-right">
                        {dollars(l.amount_cents)}
                      </strong>
                    </div>
                  ))}
                </section>
              </div>
            </>
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
        <Connect
          link={!!user.email}
          onClose={() => setShowConnect(false)}
          onLogin={signedIn}
        />
      )}
      {showAccount && (
        <AccountDetails
          user={user}
          onClose={() => setShowAccount(false)}
          onWallet={() => {
            setShowAccount(false);
            setShowConnect(true);
          }}
        />
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
      {assistantEnabled && user.role === "recycler" && <Assistant />}
    </div>
  );
}

function PageHeading({
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
function Dropoff({
  centers,
  busy,
  onSubmit,
}: {
  centers: Center[];
  busy: boolean;
  onSubmit: (body: unknown) => void;
}) {
  const [bottles, setBottles] = useState("");
  const [cardboard, setCardboard] = useState("");
  const [center, setCenter] = useState("greenpoint");
  const [locating, setLocating] = useState(false);
  const selectedCenter =
    centers.find((c) => c.id === center)?.id || centers[0]?.id || "";
  const [error, setError] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    const items = [];
    if (Number(bottles) > 0)
      items.push({
        material: "bottles",
        quantity: Number(bottles),
        unit: "count",
      });
    if (Number(cardboard) > 0)
      items.push({
        material: "cardboard",
        quantity: Math.round(Number(cardboard) * 1000),
        unit: "grams",
      });
    if (!items.length) {
      setError("Add at least one bottle or a cardboard weight.");
      return;
    }
    setError("");
    if (!selectedCenter || locating) {
      setError("Choose a center or wait for the location search to finish.");
      return;
    }
    onSubmit({ center_id: selectedCenter, items });
  }
  return (
    <div className="form-grid">
      <form className="panel form-panel" onSubmit={submit}>
        <h2>What are you bringing?</h2>
        <p className="muted">
          An estimate is fine. We’ll use the center’s actual measurements for
          your reward.
        </p>
        <div className="material-input">
          <span className="material-icon">
            <Recycle size={24} />
          </span>
          <div>
            <label htmlFor="bottles">Plastic bottles</label>
            <span className="small muted">
              Empty, clean, and ready for their next chapter
            </span>
          </div>
          <div className="quantity-input">
            <input
              id="bottles"
              type="number"
              min="0"
              max="1000000"
              step="1"
              placeholder="0"
              value={bottles}
              onChange={(e) => setBottles(e.target.value)}
            />
            <span>bottles</span>
          </div>
        </div>
        <div className="material-input">
          <span className="material-icon cardboard">
            <Package size={24} />
          </span>
          <div>
            <label htmlFor="cardboard">Dry cardboard</label>
            <span className="small muted">
              Flattened, dry, and free of food residue
            </span>
          </div>
          <div className="quantity-input">
            <input
              id="cardboard"
              type="number"
              min="0"
              max="1000"
              step="0.001"
              placeholder="0"
              value={cardboard}
              onChange={(e) => setCardboard(e.target.value)}
            />
            <span>kg</span>
          </div>
        </div>
        <CenterPicker
          centers={centers}
          value={selectedCenter}
          onChange={setCenter}
          disabled={busy}
          onLocatingChange={setLocating}
        />
        <div className="estimate">
          <span>Estimated reward</span>
          <strong>
            {number(Number(bottles || 0) * 5 + Number(cardboard || 0) * 20)}{" "}
            LOOP
          </strong>
          <small>
            Final reward depends on center-confirmed intake and available
            funding.
          </small>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button
          className="button primary full"
          disabled={busy || !selectedCenter || locating}
          type="submit"
        >
          {busy ? "Creating your ticket…" : "Create drop-off ticket"}
          <ArrowRight size={17} />
        </button>
      </form>
      <div>
        <div className="panel prep-card">
          <span className="eyebrow">A LITTLE PREP GOES A LONG WAY</span>
          <h2>
            Ready for a<br />
            fresh start.
          </h2>
          <div className="prep-art">
            <Package size={80} strokeWidth={1} />
            <Recycle size={45} strokeWidth={1.4} />
          </div>
          <p>
            <Check size={17} /> Empty and rinse plastic bottles
          </p>
          <p>
            <Check size={17} /> Keep cardboard clean and dry
          </p>
          <p>
            <Check size={17} /> Bring your ticket to the center
          </p>
        </div>
        <p className="footnote">
          <ShieldCheck size={20} /> Only center staff can confirm intake. Photos
          are never used for AI verification.
        </p>
      </div>
    </div>
  );
}
function TicketLookup({
  busy,
  onOpen,
}: {
  busy: boolean;
  onOpen: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [scan, setScan] = useState(false);
  const read = useCallback((value: string) => {
    setCode(value);
    setScan(false);
  }, []);
  return (
    <form
      className="panel form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        onOpen(code.trim());
      }}
    >
      <span className="material-icon">
        <ScanLine size={25} />
      </span>
      <h2>Start with their ticket.</h2>
      <p className="muted">
        Scan the recycler’s QR code, or paste their ticket code to open the
        claim.
      </p>
      {scan && <Scanner onRead={read} />}
      <button
        type="button"
        className="button secondary full"
        onClick={() => setScan(!scan)}
      >
        <ScanLine size={17} />
        {scan ? "Stop camera" : "Scan QR ticket"}
      </button>
      <label htmlFor="ticket-code">Ticket code</label>
      <input
        id="ticket-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Paste the drop-off ticket code"
        required
        minLength={10}
        maxLength={150}
      />
      <button className="button primary full" disabled={busy}>
        Open drop-off <ArrowRight size={16} />
      </button>
      <p className="small muted">
        Opening a ticket does not confirm receipt or issue tokens.
      </p>
    </form>
  );
}
function Review({
  claim,
  busy,
  onClose,
  onConfirm,
  onOpen,
  error,
}: {
  error: string;
  claim: Claim;
  busy: boolean;
  onClose: () => void;
  onConfirm: (data: unknown) => void;
  onOpen: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(
      claim.items.map((i) => [
        i.material,
        String(i.submitted_quantity / (i.material === "cardboard" ? 1000 : 1)),
      ]),
    ),
  );
  const [received, setReceived] = useState(false);
  const [reject, setReject] = useState(false);
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState("");
  const final = ["verified", "rejected"].includes(claim.status);
  return (
    <Modal title="Confirm physical intake" onClose={onClose}>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <p className="muted">
        {claim.username} · {claim.center_name}
      </p>
      <Badge state={claim.status} />
      {final ? (
        <div className="review-result">
          <h3>This decision is recorded.</h3>
          {claim.items.map((i) => (
            <p key={i.material}>{quantity(i, true)}</p>
          ))}
          <p>{claim.verification?.reason}</p>
          {claim.reward && (
            <>
              <strong>{tokens(claim.reward.amount_base_units)} LOOP</strong>
              <Badge state={claim.reward.state} />
            </>
          )}
        </div>
      ) : claim.status === "submitted" ? (
        <div className="review-result">
          <p>Open this ticket before inspecting and confirming the drop-off.</p>
          <button disabled={busy} className="button primary" onClick={onOpen}>
            Open ticket for review <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const items = reject
              ? []
              : claim.items
                  .filter((i) => Number(values[i.material]) > 0)
                  .map((i) => ({
                    material: i.material,
                    quantity: Math.round(
                      Number(values[i.material]) *
                        (i.material === "cardboard" ? 1000 : 1),
                    ),
                    unit: i.material === "cardboard" ? "grams" : "count",
                  }));
            if (!reject && !items.length) {
              setValidation(
                "Enter at least one accepted quantity, or reject the drop-off.",
              );
              return;
            }
            setValidation("");
            onConfirm({
              decision: reject ? "rejected" : "approved",
              received: !reject && received,
              items,
              reason,
            });
          }}
        >
          <div className="button-row tabs">
            <button
              className={!reject ? "selected" : ""}
              type="button"
              onClick={() => setReject(false)}
            >
              Accept intake
            </button>
            <button
              className={reject ? "selected" : ""}
              type="button"
              onClick={() => setReject(true)}
            >
              Reject drop-off
            </button>
          </div>
          {!reject && (
            <>
              <p className="small muted">
                Enter actual accepted quantities. Set an unaccepted material to
                zero.
              </p>
              {claim.items.map((i) => (
                <div className="review-input" key={i.material}>
                  <label htmlFor={`accepted-${i.material}`}>
                    Accepted {material(i.material).toLowerCase()}
                    <small>Submitted: {quantity(i)}</small>
                  </label>
                  <div className="quantity-input">
                    <input
                      id={`accepted-${i.material}`}
                      type="number"
                      required
                      min="0"
                      max={i.material === "bottles" ? 1000000 : 1000}
                      step={i.material === "cardboard" ? ".001" : "1"}
                      value={values[i.material]}
                      onChange={(e) =>
                        setValues({ ...values, [i.material]: e.target.value })
                      }
                    />
                    <span>{i.material === "bottles" ? "bottles" : "kg"}</span>
                  </div>
                </div>
              ))}
              <label className="checkbox">
                <input
                  type="checkbox"
                  required
                  checked={received}
                  onChange={(e) => setReceived(e.target.checked)}
                />
                <span>
                  I physically received and inspected these materials at this
                  center.
                </span>
              </label>
            </>
          )}
          <label htmlFor="reason">
            {reject ? "Reason for rejection" : "Intake note (optional)"}
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required={reject}
            maxLength={500}
            rows={3}
          />
          {validation && (
            <p className="error-text" role="alert">
              {validation}
            </p>
          )}
          <button
            disabled={busy}
            className={`button ${reject ? "danger" : "primary"} full`}
            type="submit"
          >
            {reject ? <X size={17} /> : <ShieldCheck size={17} />}
            {busy
              ? "Recording decision…"
              : reject
                ? "Reject drop-off"
                : "Confirm accepted recycling"}
          </button>
        </form>
      )}
    </Modal>
  );
}
function FundingForm({
  busy,
  waiting,
  onFund,
}: {
  busy: boolean;
  waiting: number;
  onFund: (data: unknown) => Promise<boolean>;
}) {
  const [amount, setAmount] = useState("100");
  const key = useRef<string | null>(null);
  return (
    <form
      className="panel form-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        key.current ||= crypto.randomUUID();
        const success = await onFund({
          amount_cents: Math.round(Number(amount) * 100),
          request_key: key.current,
        });
        if (success) key.current = null;
      }}
    >
      <span className="material-icon">
        <CircleDollarSign size={25} />
      </span>
      <h2>Fund a better cycle.</h2>
      <p className="muted">
        Add simulated funding to the demo budget. No card, bank account, or real
        payment is involved.
      </p>
      <label htmlFor="fund-amount">Demo funding amount (USD)</label>
      <input
        id="fund-amount"
        type="number"
        min=".01"
        max="100000"
        step=".01"
        required
        value={amount}
        onChange={(e) => {
          setAmount(e.target.value);
          key.current = null;
        }}
      />
      <button className="button primary full" disabled={busy}>
        Add demo funding <Plus size={17} />
      </button>
      <div className="info-box">
        <Clock3 size={18} />
        <span>
          {waiting} confirmed {waiting === 1 ? "claim is" : "claims are"}{" "}
          waiting for funding. Available funds are reserved automatically.
        </span>
      </div>
    </form>
  );
}
function ImpactChart({ impact }: { impact: Impact | null }) {
  const data = Array.from({ length: 7 }, (_, i) => {
    const day = Math.floor(Date.now() / 86400000) - 6 + i;
    return {
      name: new Date(day * 86400000).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
      }),
      bottles: impact?.daily.find((d) => d.day === day)?.bottles || 0,
    };
  });
  return (
    <div
      className="chart"
      role="img"
      aria-label={`Bottles accepted in the last seven days: ${data.map((d) => `${d.name} ${d.bottles}`).join(", ")}`}
    >
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart
          data={data}
          margin={{ top: 15, right: 15, left: -25, bottom: 0 }}
        >
          <defs>
            <linearGradient id="impact-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a8c788" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#a8c788" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 4"
            vertical={false}
            stroke="#e8ece7"
          />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#7b857e" }}
            dy={8}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "#7b857e" }}
          />
          <Tooltip
            contentStyle={{ borderRadius: 12, border: "1px solid #dce4db" }}
          />
          <Area
            type="monotone"
            dataKey="bottles"
            stroke="#3b795d"
            strokeWidth={3}
            fill="url(#impact-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
function Connect({
  onClose,
  onLogin,
  link = false,
}: {
  onClose: () => void;
  onLogin: (u: User) => void;
  link?: boolean;
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
        Choose a Solana Devnet wallet. You’ll sign a one-time message to{" "}
        {link ? "link it to your existing account." : "securely sign in."}
      </p>
      {!link && (
        <>
          <label htmlFor="wallet-username">Display name (new wallets)</label>
          <input
            id="wallet-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={40}
          />
        </>
      )}
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
                onLogin(
                  await loginWallet(w, username.trim() || "Recycler", link),
                );
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
function Redeem({
  user,
  wallet,
  demo,
  onClose,
  onComplete,
}: {
  user: User;
  wallet: WalletData;
  demo: boolean;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("1");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Redemption | null>(
    wallet.redemptions.find((r) => r.state === "pending") || null,
  );
  const key = useRef<string | null>(null);
  const [signature, setSignature] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      key.current ||= crypto.randomUUID();
      const r =
        pending ||
        (await api<Redemption>("/redemptions", {
          amount_base_units: Number(amount) * 100,
          request_key: key.current,
        }));
      setPending(r);
      if (r.state !== "completed") {
        let sig = signature || sessionStorage.getItem(`burn:${r.id}`) || "";
        if (!sig) {
          sig = await signBurn(r.transaction_b64!, user.wallet);
          sessionStorage.setItem(`burn:${r.id}`, sig);
          setSignature(sig);
        }
        await api(`/redemptions/${r.id}/confirm`, { signature: sig });
        sessionStorage.removeItem(`burn:${r.id}`);
      }
      await onComplete();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Redemption is pending. Retry to reconcile the same burn.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Simulate a redemption" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="muted">
          {demo
            ? "This demo records a simulated token burn and a simulated payout."
            : "Your wallet authorizes a Devnet token burn. After confirmation, we record a simulated payout."}{" "}
          No real money is paid.
        </p>
        {pending ? (
          <div className="info-box">
            Resume your pending redemption of{" "}
            {tokens(pending.amount_base_units)} LOOP. It remains reserved until
            the burn is reconciled.
          </div>
        ) : (
          <>
            <label htmlFor="redeem-amount">Whole LOOP tokens to redeem</label>
            <input
              id="redeem-amount"
              type="number"
              min="1"
              max={Math.floor(wallet.balance_base_units / 100)}
              step="1"
              required
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                key.current = null;
              }}
            />
            <p className="small muted">
              {dollars(Number(amount))} simulated credit · Available:{" "}
              {tokens(wallet.balance_base_units)} LOOP
            </p>
          </>
        )}
        {pending && !demo && (
          <>
            <label htmlFor="burn-signature">
              Burn signature (if already sent)
            </label>
            <input
              id="burn-signature"
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Paste the original transaction signature"
            />
            <p className="small muted">
              If a wallet send was interrupted, recover its signature from
              wallet history before continuing.
            </p>
          </>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button disabled={busy} className="button primary full">
          {busy
            ? "Checking redemption…"
            : demo
              ? "Confirm simulated redemption"
              : pending
                ? "Resume burn confirmation"
                : "Authorize Devnet burn"}
          <ArrowRight size={17} />
        </button>
      </form>
    </Modal>
  );
}
