export type Role = "recycler" | "verifier" | "funding_partner";
export type User = {
  id: string;
  username: string;
  wallet: string;
  role: Role;
  center_id: string | null;
  email: string | null;
  job_location: string | null;
  job_address: string | null;
  job_title: string | null;
  organization: string | null;
  government_agency?: string | null;
  government_department?: string | null;
};
export type Item = {
  material: "bottles" | "cardboard";
  submitted_quantity: number;
  accepted_quantity: number | null;
};
export type Reward = {
  id: string;
  claim_id: string;
  amount_base_units: number;
  state: string;
  signature: string | null;
  created_at: number;
  last_error?: string;
  needs_review?: number;
  funding_reason?: string | null;
  funding_message?: string | null;
};
export type Claim = {
  id: string;
  user_id: string;
  username: string;
  center_name: string;
  status: string;
  ticket: string;
  ticket_expires_at: number;
  created_at: number;
  items: Item[];
  reward: Reward | null;
  verification: { reason: string; decision: string } | null;
};
export type Redemption = {
  id: string;
  state: string;
  amount_base_units: number;
  payout_cents: number;
  signature: string | null;
  transaction_b64: string | null;
  created_at: number;
};
export type RecyclingTotals = {
  bottles: number;
  cardboard_grams: number;
  reward_base_units: number;
};
export type WalletData = {
  totals: RecyclingTotals;
  balance_base_units: number;
  pending_base_units: number;
  rewards: Reward[];
  redemptions: Redemption[];
};
export type Impact = {
  bottles: number;
  cardboard_grams: number;
  reward_base_units: number;
  dropoffs: number;
  participants: number;
  centers: { id: string; name: string; dropoffs: number }[];
  daily: { day: number; bottles: number; cardboard_grams: number }[];
};
export type Funding = {
  usdc?: {
    received_usdc_base_units: number;
    remaining_usdc_base_units: number;
    converted_usd_micros: number;
    distributed_loop_base_units: number;
    treasury_address: string | null;
    usdc_mint: string;
    deposits: {
      signature: string;
      amount_base_units: number;
      created_at: number;
    }[];
  };
  received_cents: number;
  available_cents: number;
  reserved_cents: number;
  issued_cents: number;
  redeemed_cents: number;
  pending_reimbursement_cents: number;
  awaiting_funding: number;
  blocked_rewards?: Pick<
    Reward,
    "id" | "amount_base_units" | "funding_reason" | "funding_message"
  >[];
  ledger: {
    id: string;
    kind: string;
    amount_cents: number;
    created_at: number;
  }[];
};
export type Center = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  is_demo: number;
  google_place_id?: string | null;
};
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = await response.json().catch(() => {
    throw new ApiError(
      "The service is temporarily unavailable. Please try again.",
      response.status,
    );
  });
  if (!response.ok) {
    const message = Array.isArray(result.detail)
      ? result.detail.map((e: { msg: string }) => e.msg).join(" ")
      : result.detail;
    throw new ApiError(
      message || "Something went wrong. Please try again.",
      response.status,
    );
  }
  return result;
}
export const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
export const tokens = (n: number) => number(n / 100);
export const dollars = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
export const date = (n: number) =>
  new Date(n * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export const material = (m: string) =>
  m === "bottles" ? "Plastic bottles" : "Dry cardboard";
export const quantity = (item: Item, verified = false) => {
  const n = verified ? (item.accepted_quantity ?? 0) : item.submitted_quantity;
  return item.material === "bottles"
    ? `${number(n)} bottles`
    : `${number(n / 1000)} kg cardboard`;
};
export const explorer = (signature: string) =>
  `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
