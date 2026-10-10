"use client";
import { useRef, useState } from "react";
import { CircleDollarSign, Clock3, Plus } from "lucide-react";

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

export default FundingForm;
