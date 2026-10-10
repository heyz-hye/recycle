"use client";
import { FormEvent, useState } from "react";
import { ArrowRight, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { api, User } from "@/lib/api";
import Modal from "./Modal";

export function AccountLogin({ onLogin }: { onLogin: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await api<User>(
        register ? "/auth/register" : "/auth/login",
        {
          email,
          password,
          ...(register ? { username: name } : {}),
        },
      );
      setPassword("");
      onLogin(user);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="account-login" aria-labelledby="account-login-title">
      <h2 id="account-login-title">
        {register ? "Create your recycler account" : "Sign in to your account"}
      </h2>
      <p className="small muted">
        {register
          ? "Track your drop-offs and rewards with your own login."
          : "For recyclers, recycling center staff, and fund managers."}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          {register && (
            <>
              <label htmlFor="account-name">Full name</label>
              <input
                id="account-name"
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </>
          )}
          <label htmlFor="account-email">Email</label>
          <input
            id="account-email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label htmlFor="account-password">Password</label>
          <input
            id="account-password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 15 : 1}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={register ? "password-guidance" : undefined}
          />
          {register && (
            <p id="password-guidance" className="small muted">
              Use 15–128 characters. A memorable passphrase works well.
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit">
            {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </fieldset>
      </form>
      <button
        className="text-button"
        disabled={busy}
        onClick={() => {
          setRegister(!register);
          setError("");
          setPassword("");
        }}
      >
        {register
          ? "Already have an account? Sign in"
          : "New recycler? Create an account"}
      </button>
      <p className="account-help small muted">
        Staff and funding members: your operator creates your account and
        assigns your workplace or organization. Contact them if you need access
        or a password reset.
      </p>
    </section>
  );
}

export function AccountDetails({
  user,
  onClose,
  onWallet,
}: {
  user: User;
  onClose: () => void;
  onWallet: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function change(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/auth/password", {
        current_password: current,
        new_password: next,
      });
      setCurrent("");
      setNext("");
      setMessage("Password updated. Other sessions have been signed out.");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to change password.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="My account" onClose={onClose}>
      <div className="account-identity">
        <UserRound size={28} />
        <div>
          <h3>{user.username}</h3>
          <p className="small muted">{user.email || "Wallet account"}</p>
        </div>
      </div>
      <dl className="account-fields">
        <dt>Account type</dt>
        <dd>
          {
            {
              recycler: "Recycler",
              verifier: "Center staff",
              funding_partner: user.government_agency
                ? "Government fund manager"
                : "Funding member",
            }[user.role]
          }
        </dd>
        {user.role === "verifier" && (
          <>
            <dt>Job location</dt>
            <dd>
              <MapPin size={15} /> {user.job_location || "Not assigned"}
              <small>{user.job_address}</small>
            </dd>
            <dt>Job title</dt>
            <dd>{user.job_title || "Center staff"}</dd>
          </>
        )}
        {user.role === "funding_partner" && (
          <>
            <dt>
              {user.government_agency ? "Government agency" : "Organization"}
            </dt>
            <dd>{user.organization || "Not assigned"}</dd>
            {user.government_agency && (
              <>
                <dt>Department</dt>
                <dd>{user.government_department}</dd>
                <dt>Job title</dt>
                <dd>{user.job_title}</dd>
              </>
            )}
          </>
        )}
        <dt>Wallet</dt>
        <dd className="account-wallet">
          {user.wallet.startsWith("account:")
            ? "Not linked"
            : user.wallet.startsWith("demo:")
              ? "Simulated demo wallet"
              : user.wallet}
        </dd>
      </dl>
      {user.email && (
        <button className="button secondary" onClick={onWallet}>
          {" "}
          {user.wallet.startsWith("account:")
            ? "Link Solana wallet"
            : "Reconnect wallet"}
        </button>
      )}
      {user.email && (
        <form className="password-form" onSubmit={change}>
          <h3>
            <ShieldCheck size={18} /> Change password
          </h3>
          <fieldset disabled={busy}>
            <label htmlFor="current-password">Current password</label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={15}
              maxLength={128}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <p className="small muted">Use 15–128 characters.</p>
            <button className="button primary" type="submit">
              {busy ? "Updating…" : "Update password"}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="location-status" role="status">
          {message}
        </p>
      )}
    </Modal>
  );
}
