import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";
import type {
  SolanaSignMessageFeature,
  SolanaSignAndSendTransactionFeature,
} from "@solana/wallet-standard-features";
import { getBase58Decoder } from "@solana/kit";
import { api, User } from "./api";

let connected: { wallet: Wallet; account: WalletAccount } | null = null;
export function wallets() {
  return getWallets()
    .get()
    .filter(
      (w) =>
        w.chains.includes("solana:devnet") &&
        "standard:connect" in w.features &&
        "solana:signMessage" in w.features,
    );
}
export async function loginWallet(
  wallet: Wallet,
  username = "Recycler",
  link = false,
): Promise<User> {
  const feature = wallet.features as StandardConnectFeature &
    SolanaSignMessageFeature;
  const { accounts } = await feature["standard:connect"].connect();
  const account = accounts.find((a) => a.chains.includes("solana:devnet"));
  if (!account)
    throw new Error("Choose a wallet account that supports Solana Devnet.");
  const challenge = await api<{ challenge_id: string; message: string }>(
    "/auth/challenge",
    { wallet: account.address },
  );
  const [result] = await feature["solana:signMessage"].signMessage({
    account,
    message: new TextEncoder().encode(challenge.message),
  });
  const user = await api<User>(link ? "/auth/link-wallet" : "/auth/verify", {
    challenge_id: challenge.challenge_id,
    signature: getBase58Decoder().decode(result.signature),
    username,
  });
  connected = { wallet, account };
  return user;
}
export async function signBurn(transaction: string, expectedAddress: string) {
  if (!connected || connected.account.address !== expectedAddress)
    throw new Error(
      "Reconnect your matching wallet before signing a redemption.",
    );
  const feature = connected.wallet
    .features as SolanaSignAndSendTransactionFeature;
  if (!feature["solana:signAndSendTransaction"])
    throw new Error("This wallet does not support signing transactions.");
  const bytes = Uint8Array.from(atob(transaction), (c) => c.charCodeAt(0));
  const [result] = await feature[
    "solana:signAndSendTransaction"
  ].signAndSendTransaction({
    account: connected.account,
    chain: "solana:devnet",
    transaction: bytes,
    options: { commitment: "confirmed" },
  });
  return getBase58Decoder().decode(result.signature);
}

// Government funding uses the selected wallet without changing the signed-in role.
export function fundingWallets() {
  return getWallets()
    .get()
    .filter(
      (w) =>
        w.chains.includes("solana:devnet") &&
        "standard:connect" in w.features &&
        "solana:signAndSendTransaction" in w.features,
    );
}
export async function sendFundingDeposit(
  wallet: Wallet,
  amountBaseUnits: number,
) {
  const features = wallet.features as StandardConnectFeature &
    SolanaSignAndSendTransactionFeature;
  const { accounts } = await features["standard:connect"].connect();
  const account = accounts.find((a) => a.chains.includes("solana:devnet"));
  if (!account)
    throw new Error("Select your government funding wallet on Solana Devnet.");
  const prepared = await api<{ transaction_b64: string }>("/funding/prepare", {
    source_wallet: account.address,
    amount_base_units: amountBaseUnits,
  });
  const [sent] = await features[
    "solana:signAndSendTransaction"
  ].signAndSendTransaction({
    account,
    chain: "solana:devnet",
    transaction: Uint8Array.from(atob(prepared.transaction_b64), (c) =>
      c.charCodeAt(0),
    ),
    options: { commitment: "confirmed" },
  });
  return getBase58Decoder().decode(sent.signature);
}
