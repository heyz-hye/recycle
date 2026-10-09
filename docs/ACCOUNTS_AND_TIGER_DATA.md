# Individual accounts and Tiger Data PostgreSQL

Each person has a separate identity. Recyclers register with name, email, and password. Operators create staff and funding-member accounts. All three use the same sign-in form; account permissions come from the database, never a browser role selector. Passwords are salted scrypt hashes; sessions use hashed random tokens and HttpOnly cookies.

## Schema

The authoritative, repeatable schema is [`backend/sql/schema.sql`](../backend/sql/schema.sql). New tables are additive and preserve existing wallet identities, claims, center assignments, and rewards.

| Table | Purpose and important fields |
| --- | --- |
| `users` | Individual `id`, `username`, `role`, unique `wallet`, and `center_id` |
| `account_credentials` | One login per user: unique normalized `email`, `password_hash`, `created_at`, `password_changed_at` |
| `staff_profiles` | One staff profile per user: `user_id`, `job_title` |
| `centers` | Job/drop-off locations: `id`, `name` (such as Greenhill Recycling Center), `address` |
| `center_locations` | Optional registered center latitude/longitude and demo marker |
| `funding_member_profiles` | One funding-member profile per user: `user_id`, `organization` |
| `government_funding_profiles` | Government fund-manager employment: `user_id` references `funding_member_profiles`, `department`, `job_title`; the government agency is the linked `organization` |
| `sessions` | Hashed session token, individual `user_id`, expiry |
| `auth_attempts` | Temporary hashed email/IP rate-limit keys, attempt count, expiry |

Staff job location is the foreign key **`users.center_id → centers.id`**. `/api/auth/me` exposes the center name as **`job_location`**, its address as `job_address`, and the staff member's `job_title`. The account screen and staff workspace display these values. Center assignments are checked on every ticket read and confirmation. Confirmations retain the individual `verifier_id`, and funding deposits retain the individual `actor_id`.

Roles retain their existing internal values: `recycler`, `verifier` (staff), and `funding_partner` (funding member). One shared identity table avoids duplicate accounts and keeps claim/session foreign keys stable. Profile records add role-specific information. Provisioning validates staff locations and funding organizations transactionally.

Government fund managers use the funding permission role plus a government employment profile. `/api/auth/me` returns `government_agency`, `government_department`, and `job_title`, displayed in **My account**. The operator verifies employment outside the app before provisioning; public registration cannot assign this role or these fields. Existing funding accounts remain compatible. Managers can view the shared budget and record funding, which reserves funds for already-confirmed rewards. They cannot submit or confirm recycling tickets. Workers cannot access funding controls. The current MVP simulates funds and redemptions; it does not connect to a government treasury or transfer bank money.

Email accounts initially have a unique `account:<user-id>` wallet marker for compatibility with the existing non-null wallet schema. It is not a wallet address or private key. **My account → Link Solana wallet** requires a signed challenge and preserves the existing account ID. A wallet already belonging to another account cannot be claimed. Devnet tickets require a linked wallet; simulated rewards do not. Wallet replacement/merging requires operator review.

## Connect Tiger Data

1. Create a Tiger Data PostgreSQL service and copy its connection URL from the service's connection details. Use its actual hostname, port, database, and password. Preserve `sslmode=require` (or stronger). Percent-encode password characters if constructing the URL yourself.
2. Copy [`backend/tiger.env.example`](../backend/tiger.env.example) to repository-root `.env` and replace the placeholder `DATABASE_URL`. Do not overwrite an existing configured `.env`; edit its settings instead. The resulting `.env` is ignored by Git and belongs only on the backend host.
3. Keep `DEMO_ACCOUNTS_ENABLED=false`. This disables shared demo logins, rejects existing shared demo sessions, and skips sample centers/accounts/funding on initialization. It does not delete previous demo data. `APP_MODE=demo` keeps token transfers simulated independently of the login mode.
4. Verify the connection, then apply the additive schema:

   ```bash
   PYTHONPATH=backend .venv/bin/python -m app.cli db-check
   PYTHONPATH=backend .venv/bin/python -m app.cli init
   ```

   `db-check` reports PostgreSQL connectivity and TLS without printing the connection URL or password. It does not initialize tables. The API also applies the additive schema at startup. Existing SQLite data is not automatically copied to Tiger Data.
5. Register your participating centers, then provision their individual staff and funding members as below. A new database starts without invented locations or funding.
6. Restart the API and any standalone worker so they load the new `.env`. The frontend continues using its existing API proxy. For deployment, use your HTTPS `PUBLIC_ORIGIN` and `SECURE_COOKIES=true`.

These are ordinary PostgreSQL tables. The optional TimescaleDB analytics migration remains separate (`app.cli enable-timescale`) and is not required for accounts. Token mode is recorded in the database: use a separate database for real Devnet transactions, as documented in the main README.

## Create staff and funding-member logins

Register a real location using verified coordinates. Substitute the actual address and coordinates; the command below is a template, not a claim that Greenhill is a verified facility:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli configure-center \
  --id greenhill --name 'Greenhill Recycling Center' \
  --address 'ACTUAL_STREET_ADDRESS' \
  --latitude ACTUAL_LATITUDE --longitude ACTUAL_LONGITUDE

PYTHONPATH=backend .venv/bin/python -m app.cli create-account \
  --email staff@example.com --name 'Sam Green' --role staff \
  --center greenhill --job-title 'Intake specialist'

PYTHONPATH=backend .venv/bin/python -m app.cli create-account \
  --email member@example.com --name 'Morgan Lee' --role funding_member \
  --organization 'Green Future Fund'
```

Each command privately prompts for a 15–128 character password and confirmation. Passwords are never passed in command-line arguments or printed. Use actual individual addresses and provide credentials through your organization's established private process. The app does not send email. Recyclers can register in the app; operators can also use `create-account --role recycler`.

For a government fund manager, use the explicit operator role alias and their verified agency and department:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli create-account \
  --email official@example.com --name 'Morgan Lee' --role fund_manager \
  --organization 'ACTUAL_GOVERNMENT_AGENCY' --department 'Environmental Services' \
  --job-title 'Recycling Fund Manager'
```

## Test logins and role scenarios

Run the following explicitly against the intended **simulated** database. It creates four individual email/password logins and two clearly fictional test sites, with sample coordinates marked as demo. Shared demo login remains disabled when `DEMO_ACCOUNTS_ENABLED=false`.

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli create-test-accounts
```

The generated passwords are unique and stored only in `.data/test-role-logins.json` (file permissions `0600`, ignored by Git). The database stores password hashes. Existing output files, accounts, and centers are never replaced. Use the existing credential file on subsequent runs, or the private `reset-password` command when necessary. Provisioning creates no tickets, funding entries, or rewards and refuses to run outside `APP_MODE=demo`.

| Login | Role and assignment |
| --- | --- |
| `recycler@loopmint.example` | Recycler; creates tickets |
| `worker.greenhill@loopmint.example` | Worker assigned only to `test-greenhill` |
| `worker.riverside@loopmint.example` | Worker assigned only to `test-riverside` |
| `fund.manager@loopmint.example` | Government fund manager; fictional agency and Environmental Services department |

Sign in at `http://localhost:3000` using the normal email/password form. Use separate browser profiles or sign out between roles:

1. Recycler: create a ticket for **TEST ONLY — Greenhill Recycling Center** and copy its ticket code. No reward exists yet.
2. Riverside worker: the Greenhill ticket is absent from the queue, and entering its code is denied.
3. Greenhill worker: open that ticket, confirm physical receipt and accepted quantities. A reward is queued if the simulated budget has funds, or waits for funding otherwise. Confirmation records this worker's individual ID. Repeating confirmation cannot create another reward.
4. Government fund manager: inspect **My account** for agency, department, and job title; open **Funding** and add simulated funding. Already-confirmed rewards waiting for funding become eligible for processing. Recycling confirmation is denied for this login.
5. Recycler: refresh the wallet after the demo worker processes the reward. Funding alone never creates a reward without a site's confirmation.

Automated API scenarios in `backend/tests/test_role_scenarios.py` run against isolated databases and cover both directions of cross-site read/open/approve/reject denial, individual audit IDs, manager permission boundaries, duplicate funding, and reward issuance. For browser login checks, provision the same fixtures in an isolated database and pass its credential-file path through `E2E_ROLE_CREDENTIALS` when running `frontend/tests/role-logins.spec.ts`. Never run the full browser suite against your live Tiger Data database.

```bash
PYTHONPATH=backend DATABASE_URL=sqlite:///.data/role-browser-tests.db \
  DEMO_ACCOUNTS_ENABLED=true .venv/bin/python -m app.cli create-test-accounts \
  --output .data/role-browser-test-logins.json
# Start a test API/frontend for this database (see GOOGLE_MAPS.md), then:
PATH="$PWD/.tools/node_modules/node/bin:$PATH" E2E_URL=http://127.0.0.1:3001 \
  E2E_ROLE_CREDENTIALS="$PWD/.data/role-browser-test-logins.json" \
  npm run test:e2e --prefix frontend -- role-logins.spec.ts accounts.spec.ts
```

## Password recovery

Users change their password in **My account**. Other sessions are revoked. For recovery, an operator verifies the person's identity outside the app, then runs:

```bash
PYTHONPATH=backend .venv/bin/python -m app.cli reset-password --email staff@example.com
```

This prompts privately for a new password and revokes all current sessions. Email verification, emailed invitations/reset links, MFA, and a browser-based administration portal are not implemented. Existing wallet-only accounts continue to use signed wallet login; attaching email credentials to those existing accounts is not exposed as self-service.

## Validation and limits

Backend tests cover email normalization, duplicate prevention, privilege injection, secret-free validation errors, password hashing, login throttling, cookie/session behavior, password resets, staff location checks, funding audit identity, wallet linking, disabled demo accounts, and schema compatibility on SQLite and PostgreSQL. Browser tests cover registration, returning login, password changes, account details, and staff job locations on desktop/mobile.

Auth limits are persisted in the database (10 attempts per email and 60 per observed client IP per 15 minutes). A successful login clears that email's limit. Configure trusted proxy IP handling and edge rate limits for public deployments; don't trust client-supplied forwarding headers. There is no automatic email ownership verification.

References: [Tiger Data connection details](https://www.tigerdata.com/docs/use-timescale/latest/integrations/find-connection-details), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
