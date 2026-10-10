# LoopMint

A recycling rewards MVP with a Next.js interface and Python/FastAPI backend. Recycling center staff confirm physical intake; the backend calculates funded token rewards from their measured quantities. Ask Loop is a Gemini-powered recycling support chat; physical intake verification remains with center staff.

## Recycling support chat

Click **Ask Loop** on any page for practical recycling advice and LoopMint help. Replies are conversational and normally 60–140 words, with follow-up context within the current session. Configure `GEMINI_API_KEY` in the root `.env` and restart the backend; `GEMINI_MODEL` optionally overrides `gemini-3.8-flash`. The key stays on the Python server. Chat messages are sent to Google's Gemini API and are not stored in LoopMint's database or browser storage. Reloading clears the conversation. The guide has no live local search or account access and asks users to confirm local recycling rules. It includes bounded history, timeouts, retry controls and a per-process request limit; deployments with multiple workers should add a shared gateway limit.

## Run the local demo

```bash
./scripts/dev.sh
```

Open **http://localhost:3000**. The script installs project dependencies, uses Python 3.12 through `uv` (or an installed `python3.12`), and downloads a project-local Node 22 runtime if your installed Node is older. It starts the API, demo reward worker, and frontend. Requires npm and either uv or Python 3.12. Ctrl+C stops the services.

Starting the default demo needs no wallet, cloud account, API key, or Docker. The map-based ticket picker requires a configured Google Maps key and a real registered center; fictional demo centers are not offered in that picker. Automated browser tests mock Google and center enrollment to exercise the full flow offline. SQLite data persists in `.data/loopmint.db`. It starts with five clearly labeled demo accounts (a recycler, three center staff accounts, and a funding partner) and $500 of simulated funding. Tokens, burns, and payouts are **simulated**, not blockchain transactions. Signing in with an actual wallet while in demo mode still uses the simulated token service.

1. After configuring Google Maps and enrolling a center with its assigned staff login, sign in as a recycler. Open **New drop-off**, enter 2 kg of cardboard, and use location or address search, then explicitly choose a participating center from the Google map results. Create the ticket and copy its QR code text.
2. Sign in as the worker assigned to the selected center. Scan or paste the ticket, enter the accepted quantity, and confirm physical receipt.
3. Switch back to the recycler. Within a few seconds, 40 LOOP appears as received. Center approval and transaction confirmation have separate states.
4. Once the token reward is confirmed, open **Share** on that ticket. The standard template includes the accepted quantities and tokens actually received. Edit it, then choose **Share on X** or **Share on Reddit** to review and publish from your own account. Download the PNG card to attach it. Each rewarded ticket remains shareable from its activity row.
5. Open **My wallet** for history and simulated redemption. Open **Funding partner** to add simulated funding and inspect reservations.

API documentation: http://127.0.0.1:8000/docs.

## What is implemented

- Individual email/password sign-up for recyclers, site-restricted worker accounts, government fund-manager agency/department profiles, password changes/resets, and generated role test logins. See [accounts, Tiger Data setup, and test scenarios](docs/ACCOUNTS_AND_TIGER_DATA.md).
- Recycler, assigned center verifier, and funding partner roles, enforced by the API.
- Wallet Standard sign-in with one-time Ed25519 challenges and HttpOnly session cookies. New wallets always receive recycler access. Trusted roles are provisioned with an operator command.
- Plastic bottle counts and integer-gram cardboard submissions, unique expiring QR tickets, camera scanning where supported, manual code entry, and ticket renewal.
- Opt-in GPS with interactive Google Maps, real nearby Google Places listings, directions, approximate distances, and tickets restricted to registered participating centers.
- Physical receipt confirmation, measured quantities, partial acceptance, rejection reasons, center restrictions, and self-approval prevention.
- Rate snapshots, separate verification/payment states, integer reward calculations, atomic funding reservations, waiting-for-funding processing, and idempotent approvals/deposits/redemptions.
- A durable worker with signed-transaction persistence before broadcast, signature reconciliation, and duplicate-safe retries. Distinct rewards include unique on-chain memos even when amounts and wallets match.
- A real Solana Devnet SPL minting/burn adapter plus an explicitly simulated local adapter.
- Wallet reward/redemption history, Devnet explorer links for actual signatures, aggregate impact and funding dashboards, and five-second polling.
- Per-ticket share prompts after reward confirmation, standard captions and PNG cards, X/Reddit composer links, editable previews, copy/download fallbacks, and no server-side social content. See [social sharing behavior](docs/SOCIAL_SHARING.md).
- PostgreSQL through Psycopg 3, local SQLite fallback, and an optional TimescaleDB hypertable/continuous aggregate migration.
- Docker definitions, a local launch script, backend tests against SQLite or PostgreSQL, and desktop/mobile Playwright flows.

## Find a recycling center

In **New drop-off**, click **Use my location** and allow the browser's location request. Google Maps displays your position and nearby recycling listings, including centers that have not enrolled in LoopMint. Change the radius or open directions from each result. See [Google Maps setup and behavior](docs/GOOGLE_MAPS.md). Choose **Use for my ticket** on an enrolled Google listing or select a green L marker for a registered center. You can also search a Google address, neighborhood, or postal code, then select a matching area to find nearby listings without device location. In VS Code, open `http://localhost:3000` in Chrome or Safari for device positioning; the embedded preview may time out. The separate ticket-center list and automatic test-center selection have been removed.

Location is requested only on click and is shared with Google for maps and nearby search. LoopMint keeps it in browser memory until the page is closed, the form is left, or **Clear location** is used. The LoopMint API receives only the selected center ID, never the recycler's coordinates. Distances are approximate, not travel routes. Browser geolocation requires HTTPS or localhost. A distant nearest result does not mean a center operates near you.

The demo includes **sample Brooklyn locations**, not verified public drop-off facilities. These samples have no directions links. Google search results contain actual listings, but only registered participating centers can receive tickets because their assigned staff must confirm intake. Operators match enrolled centers to Google results using verified Place IDs; discovery alone does not enable rewards.

Register a participating center using its verified address and coordinates:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli configure-center \
  --id YOUR_CENTER_ID --name 'Your center name' --address 'Verified street address' \
  --latitude YOUR_LATITUDE --longitude YOUR_LONGITUDE

PYTHONPATH=backend .venv/bin/python -m app.cli grant-role \
  --wallet YOUR_CENTER_WALLET --username 'Center staff' \
  --role verifier --center YOUR_CENTER_ID
```

Refresh the app to load new centers. Reusing a center ID updates its name, address, and coordinates while preserving existing tickets. Coordinates are validated and stored in an additive `center_locations` table; existing centers without coordinates remain manually selectable. Configured real centers offer a Google Maps directions link containing only the destination. Demo seeding does not overwrite operator-configured coordinates.

## Configuration

Copy `backend/.env.example` to the repository root as `.env`. Never commit keys or `.env`.

| Setting | Purpose |
| --- | --- |
| `APP_MODE` | `demo` or `devnet`; demo accounts exist only in demo mode |
| `DATABASE_URL` | SQLite file in demo; PostgreSQL required for Devnet |
| `PUBLIC_ORIGIN` | Exact frontend origin permitted for browser mutations and wallet sign-in |
| `SECURE_COOKIES` | Set `true` when served over HTTPS |
| `DEMO_AUTO_WORKER` | In-process demo worker; disable when using the standalone worker |
| `DEMO_ACCOUNTS_ENABLED` | Disable shared demo logins and sample seeding for individual accounts; independent of simulated token mode |
| `TIMESCALE_ENABLED` | Read the continuous aggregate after applying the Timescale migration |
| `GOOGLE_MAPS_BROWSER_KEY` | Referrer-restricted browser key for Maps JavaScript API and Places API (New) |
| `GOOGLE_MAPS_MAP_ID` | JavaScript map ID for Advanced Markers; `DEMO_MAP_ID` for local development |
| `SOLANA_RPC_URL` | Devnet RPC; the adapter verifies the network genesis hash |
| `SOLANA_MINT` | A classic SPL Token mint with exactly two decimals |
| `SOLANA_ISSUER_KEYPAIR` | Server-side path to the mint authority/payer keypair JSON |

`API_URL` is a **frontend build-time** setting for Next.js's `/api` proxy; defaults to `http://127.0.0.1:8000`. Browser requests remain same-origin. Keep the Python API behind that proxy or private networking when deployed.

Use different databases for demo and Devnet. The database records its mode and refuses reuse across modes so simulated balances cannot become on-chain entitlements.

## Solana Devnet setup

The included adapter is implemented and tested with signed transactions and mocked RPC responses. **No live tokens have been issued by this checkout.** Actual issuance requires your PostgreSQL database, Devnet-funded issuer keypair, mint, and a user-controlled Devnet wallet. The issuer's Devnet SOL pays transaction fees and associated token account rent.

1. Configure a new PostgreSQL database, `APP_MODE=devnet`, your origin, and issuer keypair path. Fund the issuer with Devnet SOL. Keep the key outside this repository.
2. Configure an existing compatible mint, or run the following explicit command to create one:

   ```bash
   PYTHONPATH=backend .venv/bin/python -m app.cli create-devnet-mint
   ```

   Put the printed mint address in `SOLANA_MINT`. The configured issuer must be its mint authority. Mint decimals are fixed at 2.
3. Register your real center with `configure-center` (see above), then provision trusted wallets from your server. Use its registered ID in `--center`:

   ```bash
   PYTHONPATH=backend .venv/bin/python -m app.cli grant-role \
     --wallet YOUR_CENTER_WALLET --username 'Center staff' \
     --role verifier --center greenpoint

   PYTHONPATH=backend .venv/bin/python -m app.cli grant-role \
     --wallet YOUR_PARTNER_WALLET --username 'Funding partner' \
     --role funding_partner
   ```

4. Start the API/frontend with `./scripts/dev.sh`. Start the separate worker in another terminal:

   ```bash
   PYTHONPATH=backend .venv/bin/python -m app.worker
   ```

5. Sign in with each wallet; fund the simulated reward budget as the partner. Submit recycling as a recycler, then confirm as center staff. The worker mints Devnet tokens to the recycler's associated token account and waits for network confirmation.

Devnet redemption prepares an exact burn transaction. The user authorizes it in their wallet; the API verifies its confirmed message, mint, amount, signer, and unique redemption memo before recording simulated credit. A pending redemption reserves its balance. If wallet submission was interrupted, recover the transaction signature from wallet history and use **Resume** to reconcile it. An expired unsigned burn or a confirmed failure requires operator reconciliation; the application never silently releases an uncertain burn or creates a replacement transaction.

## Storage, money, and retries

Bottles earn 5 LOOP each; cardboard earns 20 LOOP/kg. The token base unit is 0.01 LOOP. Store grams and base units as integers. The configured rates produce exact integer results; reward calculation floors division. Reserve demo cents **upward** to cover fractional LOOP. Redemptions accept whole LOOP only, at 1 LOOP = 1 simulated cent.

All authoritative writes use a transaction. PostgreSQL uses a shared transaction-scoped advisory lock across API and worker; SQLite uses `BEGIN IMMEDIATE`. This deliberately serializes writes for the MVP. Unique constraints additionally enforce one verification, reward, and job per claim. For higher traffic, replace the global lock with a consistent row-lock order after load testing.

The worker commits signed bytes, signature, and last valid block height before broadcasting. A lost network response causes reconciliation of the same signature; retries rebroadcast identical bytes. Failed/expired transactions are marked `needs_review` and keep funding reserved. Operators must check the stored signature on Devnet before recovery; no automatic re-mint occurs. Inspect `reward_jobs.last_error` and the worker logs. This is intentionally conservative around uncertain transactions.

## PostgreSQL and TimescaleDB

For **Tiger Data cloud PostgreSQL**, use [the connection and account setup guide](docs/ACCOUNTS_AND_TIGER_DATA.md) and [`backend/tiger.env.example`](backend/tiger.env.example). The schema includes individual credentials, staff job profiles linked to centers, and funding-member organizations. Set the service's connection URL in server-side `DATABASE_URL`, run `app.cli db-check` and `app.cli init`, provision accounts, and restart the backend. SQLite records are not automatically transferred.

To run a full local PostgreSQL stack, with Docker running:

```bash
docker compose up --build
```

The frontend and API bind to loopback. Compose starts a separate worker and a persistent database volume. Demo credentials in Compose are for this local stack only.

For Tiger Cloud / TimescaleDB, set `DATABASE_URL`, initialize the database, then run:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli enable-timescale
```

Set `TIMESCALE_ENABLED=true` and restart the API. The migration makes `recycling_events` an integer-time hypertable, installs an hourly aggregate by center/material/event type, enables real-time aggregation, and schedules refreshes. Claims, funding, and rewards stay ordinary PostgreSQL tables. Dashboard totals count intake independently of reward events. PostgreSQL tests run without the Timescale extension; the optional Timescale migration needs validation on your target Tiger Cloud instance.

## Tests

```bash
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q

# Optional: the fixture creates and removes an isolated test schema for each case.
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost/loopmint_test \
  PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q

cd frontend
npm run typecheck
npm run build
npx playwright install chromium
# With the local demo running:
npm run test:e2e
```

Use Node 22+ for npm commands, or prepend `.tools/node_modules/node/bin` to `PATH` after the launch script has installed its local runtime. Browser tests create demo claims and funding records; run them against a demo database. They cover desktop and mobile layouts, submission/approval/reward flow, PNG downloads, share cancellation/fallbacks, simulated redemption, funding, rejection, GPS permission/failure cases, explicit map selection, cleared selections, and location privacy. GPS tests use mocked positions, not your device location.

## Deployment and remaining setup

Deploy the frontend, API, and worker as separate services using their Dockerfiles (the worker overrides the backend command with `python -m app.worker`). Set the frontend's `API_URL` build argument to the API's reachable private address. Set `PUBLIC_ORIGIN` to the frontend HTTPS URL and `SECURE_COOKIES=true`; use PostgreSQL, Devnet mode, and server-only issuer secrets. Configure external rate limits before opening wallet authentication to public traffic. The app includes a per-wallet challenge limit, not a distributed abuse-prevention service.

Hosting, domain registration, cloud credentials, and a real funding agreement are not provisioned. Optional private photo uploads/R2 storage are not wired into the MVP: the implemented submission flow uses materials and quantities, with physical center verification. No claim is automatically approved from a photo or QR scan.

Requirements: [MVP_PLAN.md](MVP_PLAN.md). Revised planning document: [PDF](output/pdf/Recycling_Rewards_MVP_Center_Verified.pdf).

Implementation references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Psycopg transactions](https://www.psycopg.org/psycopg3/docs/basic/transactions.html), [Solana.py SPL instructions](https://michaelhly.com/solana-py/spl/token/instructions/), [Timescale continuous aggregates](https://www.tigerdata.com/docs/learn/continuous-aggregates).

Location references: [Browser geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition), [Google Maps destination URLs](https://developers.google.com/maps/documentation/urls/get-started).
