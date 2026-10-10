# Wallets, treasury distribution, and conversions (Devnet)

A confirmed recycling ticket earns LOOP in the recycler's platform balance. The server reserves existing LOOP held by its treasury; it does not mint new tokens. If inventory or the reward budget is insufficient, the reward stays `awaiting_funding` and the worker retries when funded.

Recyclers link a Solana wallet in My account by signing an ownership challenge. In My wallet they can withdraw LOOP, or convert LOOP to USDC/SOL and withdraw the converted balance. Each withdrawal is reviewed before submission and can only target that account's linked wallet. Wallet linking is not required to submit or earn from tickets.

## Exchange value

**1 LOOP = remaining recorded fund / distributed, unredeemed LOOP.**

Distributed supply is all confirmed ticket rewards recorded by this application, minus completed conversions and completed legacy redemptions. It includes LOOP withdrawn to external wallets. Unallocated tokens in the main wallet and operational treasury are excluded. Tokens already allocated to users count even while physically held by the operational treasury. Unrelated token transfers outside the application's reward ledger do not create redeemable balances.

For example, a $500 fund and 40 distributed LOOP produce $12.50 per LOOP, regardless of how much unallocated LOOP the treasury holds. Converting 10 LOOP reserves 125 USDC, leaving a $375 fund and 30 unredeemed LOOP. Withdrawing LOOP alone does not change the fund or distributed supply. New rewards increase distributed supply; new funding increases the numerator. With no distributed supply, conversion is unavailable.

Quotes expire after 60 seconds and must be refreshed if funding or supply changes. USDC uses six decimals. SOL uses Coinbase's SOL/USD spot reference, captured in the quote, and nine decimals. Outputs round down. The treasury must already hold enough of the output asset to cover the conversion and existing liabilities.

Conversion exchanges ledger balances against treasury inventory; it does not execute a DEX swap. Converted LOOP returns to unallocated inventory, while the USDC/SOL becomes reserved for the user. Users cannot spend that LOOP again. Depositing previously withdrawn LOOP back into the platform is not implemented.

## Configure an existing mint

Use a separate PostgreSQL database or schema for Devnet; never reuse demo balances. Configure server-side environment variables:

```dotenv
APP_MODE=devnet
DEMO_ACCOUNTS_ENABLED=false
DEMO_AUTO_WORKER=false
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_MINT=364HABCb9VpbC8LLnZwmF7rAKhMrd1p2d4dUrG12EYHB
SOLANA_ISSUER_KEYPAIR=/absolute/private/path/to/treasury-keypair.json
SOLANA_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
TOKEN_DECIMALS=2
TREASURY_FEE_RESERVE_LAMPORTS=10000000
```

Also set `DATABASE_URL`, `PUBLIC_ORIGIN`, and cookie settings for your deployment. Keep keypairs outside the repository with owner-only permissions. The server treasury needs signing access to its own wallet, not the main token-creating wallet. A public address alone cannot authorize transfers.

Fund the server treasury with existing LOOP, Devnet SOL for fees/account rent, and Circle test USDC. Send the tokens using the configured mint. The adapter supports classic SPL LOOP mints with 2–9 decimals and converts the platform's 0.01 LOOP units into the correct chain units; the existing mint above has nine decimals. It never needs mint authority for withdrawals and preserves the mint/metadata.

`./scripts/dev.sh` starts the API, frontend, and a Devnet worker automatically when `APP_MODE=devnet`. For separate service deployments, start the worker explicitly:

```bash
PYTHONPATH=backend .venv/bin/python -m app.worker
```

For a separate local wallet preview, save these settings privately in `.data/devnet.env`, use a separate Devnet database/schema, set `PUBLIC_ORIGIN=http://localhost:3002`, and run `./scripts/devnet-preview.sh`. This starts the API, worker, and frontend on ports 8002/3002 while the normal demo stays on 8000/3000. The preview database needs its own accounts and center configuration.

The API initializes the additive `reward_custody`, `conversion_quotes`, `conversions`, and `withdrawals` tables. Existing Devnet rewards are marked externally delivered so historical payments cannot be withdrawn again. Existing demo rewards remain simulated platform balances. Provision worker and fund-manager accounts using the account setup guide.

## Reliability and limits

Balance-changing operations share a database financial lock. Idempotency keys prevent duplicate conversions and withdrawal requests. The worker persists signed transaction bytes and their signature before broadcasting; retries reconcile/rebroadcast the same transaction. Failed or expired transfers enter `review` and keep the amount reserved until an operator reconciles the signature. Do not delete these records or issue replacement payouts before checking the chain.

Treasury inventory and all user liabilities are checked before new rewards/conversions. The treasury pays withdrawal fees and retains 0.01 SOL as a fee reserve. Refill it when liquidity runs low. Mainnet is explicitly rejected.

The government funding amount is still an operator-entered test ledger, not a verified bank deposit or reserve attestation. The existing reward-budget reservation accounting is separate from the conversion exchange rate; its historical one-cent-per-LOOP allocation does not set the conversion price. Devnet tokens and test USDC have no real monetary value. A production launch needs verified reserve funding, audited custody/reconciliation, and external token deposit/redemption support.

Primary references: [Solana token transfers](https://solana.com/docs/tokens/basics/transfer-tokens), [Circle USDC on Solana](https://www.circle.com/multi-chain-usdc/solana), and [Coinbase price API](https://docs.cdp.coinbase.com/coinbase-app/track-apis/prices).

## Moving a local demo to Devnet

Keep the demo database intact. Move only account credentials, role/workplace profiles, and registered center configuration into the Devnet database; do not copy simulated rewards, funding, conversions, or withdrawals into token entitlements. Users sign in again after switching. Use a single Devnet liability ledger per treasury wallet so two databases cannot independently reserve the same tokens. Existing simulated withdrawal records are not blockchain receipts.

The API only creates rewards after an approved center verification, and the worker checks the stored confirmation again before processing. Approval credits the platform balance. The user's withdrawal request is the step that transfers treasury tokens to the linked wallet. Both the current withdrawal path and legacy reward preparation use SPL transfers, never minting. Demo withdrawal controls explicitly say “Simulate” and report that no tokens were sent.
