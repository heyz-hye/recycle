CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS centers (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS center_locations (
 center_id TEXT PRIMARY KEY REFERENCES centers(id),
 latitude DOUBLE PRECISION NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 is_demo BIGINT NOT NULL DEFAULT 0 CHECK(is_demo IN (0,1))
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, wallet TEXT UNIQUE NOT NULL, username TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('recycler','verifier','funding_partner')),
 center_id TEXT REFERENCES centers(id)
);
CREATE TABLE IF NOT EXISTS center_google_places (
 center_id TEXT PRIMARY KEY REFERENCES centers(id), google_place_id TEXT UNIQUE NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS account_credentials (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 email TEXT UNIQUE NOT NULL CHECK(email=lower(email)),
 password_hash TEXT NOT NULL, created_at BIGINT NOT NULL, password_changed_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), job_title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funding_member_profiles (
 user_id TEXT PRIMARY KEY REFERENCES users(id), organization TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS government_funding_profiles (
 user_id TEXT PRIMARY KEY REFERENCES funding_member_profiles(user_id),
 department TEXT NOT NULL CHECK(length(trim(department)) BETWEEN 1 AND 150),
 job_title TEXT NOT NULL CHECK(length(trim(job_title)) BETWEEN 1 AND 100)
);
CREATE TABLE IF NOT EXISTS auth_attempts (
 key_hash TEXT PRIMARY KEY, attempts BIGINT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempt_expiry ON auth_attempts(expires_at);
CREATE INDEX IF NOT EXISTS staff_job_location ON users(center_id, role);
CREATE TABLE IF NOT EXISTS challenges (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, message TEXT NOT NULL, expires_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS claims (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), center_id TEXT NOT NULL REFERENCES centers(id),
 status TEXT NOT NULL CHECK(status IN ('submitted','awaiting_review','verified','rejected')),
 ticket TEXT UNIQUE NOT NULL, ticket_expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS claim_items (
 claim_id TEXT NOT NULL REFERENCES claims(id), material TEXT NOT NULL CHECK(material IN ('bottles','cardboard')),
 submitted_quantity BIGINT NOT NULL CHECK(submitted_quantity>0),
 accepted_quantity BIGINT CHECK(accepted_quantity>=0), rate_base_units BIGINT, rate_denominator BIGINT,
 PRIMARY KEY(claim_id, material)
);
CREATE TABLE IF NOT EXISTS verifications (
 claim_id TEXT PRIMARY KEY REFERENCES claims(id), verifier_id TEXT NOT NULL REFERENCES users(id),
 center_id TEXT NOT NULL REFERENCES centers(id), decision TEXT NOT NULL, reason TEXT NOT NULL, confirmed_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS reward_rules (
 material TEXT PRIMARY KEY, unit TEXT NOT NULL, rate_base_units BIGINT NOT NULL, denominator BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS funding_account (
 id TEXT PRIMARY KEY, received_cents BIGINT NOT NULL DEFAULT 0, available_cents BIGINT NOT NULL DEFAULT 0 CHECK(available_cents>=0),
 reserved_cents BIGINT NOT NULL DEFAULT 0 CHECK(reserved_cents>=0), issued_cents BIGINT NOT NULL DEFAULT 0,
 redeemed_cents BIGINT NOT NULL DEFAULT 0, pending_reimbursement_cents BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS rewards (
 id TEXT PRIMARY KEY, claim_id TEXT UNIQUE NOT NULL REFERENCES claims(id), user_id TEXT NOT NULL REFERENCES users(id),
 amount_base_units BIGINT NOT NULL CHECK(amount_base_units>0), cost_cents BIGINT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('awaiting_funding','queued','sent','confirmed')),
 signature TEXT UNIQUE, created_at BIGINT NOT NULL, confirmed_at BIGINT
);
CREATE TABLE IF NOT EXISTS reward_jobs (
 reward_id TEXT PRIMARY KEY REFERENCES rewards(id), transaction_b64 TEXT, signature TEXT UNIQUE,
 last_valid_block_height BIGINT, attempts BIGINT NOT NULL DEFAULT 0, last_error TEXT, needs_review BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS funding_ledger (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, amount_cents BIGINT NOT NULL,
 reference TEXT UNIQUE NOT NULL, actor_id TEXT REFERENCES users(id), created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS redemptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_base_units BIGINT NOT NULL CHECK(amount_base_units>0),
 payout_cents BIGINT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','completed')),
 transaction_b64 TEXT, signature TEXT UNIQUE, request_key TEXT UNIQUE NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS recycling_events (
 id TEXT NOT NULL, created_at BIGINT NOT NULL, center_id TEXT NOT NULL, user_id TEXT NOT NULL,
 material TEXT NOT NULL, quantity BIGINT NOT NULL, reward_base_units BIGINT NOT NULL, event_type TEXT NOT NULL,
 PRIMARY KEY(id, created_at)
);
CREATE INDEX IF NOT EXISTS claims_owner ON claims(user_id, created_at);
CREATE INDEX IF NOT EXISTS claims_center ON claims(center_id, status);
CREATE INDEX IF NOT EXISTS reward_state ON rewards(state, created_at);
CREATE INDEX IF NOT EXISTS events_time ON recycling_events(created_at);
CREATE TABLE IF NOT EXISTS reward_custody (
 reward_id TEXT PRIMARY KEY REFERENCES rewards(id),
 delivery TEXT NOT NULL CHECK(delivery IN ('internal','external'))
);
CREATE TABLE IF NOT EXISTS conversion_quotes (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 loop_base_units BIGINT NOT NULL, asset TEXT NOT NULL CHECK(asset IN ('USDC','SOL')),
 output_base_units BIGINT NOT NULL, usd_micros BIGINT NOT NULL,
 fund_usd_micros BIGINT NOT NULL, supply_base_units BIGINT NOT NULL,
 sol_usd_micros BIGINT NOT NULL, expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversions (
 id TEXT PRIMARY KEY, quote_id TEXT UNIQUE NOT NULL REFERENCES conversion_quotes(id),
 user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT UNIQUE NOT NULL,
 loop_base_units BIGINT NOT NULL CHECK(loop_base_units>0),
 asset TEXT NOT NULL CHECK(asset IN ('USDC','SOL')),
 output_base_units BIGINT NOT NULL CHECK(output_base_units>0),
 usd_micros BIGINT NOT NULL CHECK(usd_micros>0), created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS withdrawals (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 asset TEXT NOT NULL CHECK(asset IN ('LOOP','USDC','SOL')),
 amount_base_units BIGINT NOT NULL CHECK(amount_base_units>0), destination TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','sent','confirmed','review')),
 request_key TEXT UNIQUE NOT NULL, transaction_b64 TEXT, signature TEXT UNIQUE,
 last_valid_block_height BIGINT, attempts BIGINT NOT NULL DEFAULT 0,
 last_error TEXT, created_at BIGINT NOT NULL, confirmed_at BIGINT
);
CREATE INDEX IF NOT EXISTS conversions_owner ON conversions(user_id,created_at);
CREATE INDEX IF NOT EXISTS withdrawals_owner ON withdrawals(user_id,created_at);

CREATE TABLE IF NOT EXISTS reward_funding_status (
 reward_id TEXT PRIMARY KEY REFERENCES rewards(id),
 code TEXT NOT NULL, message TEXT NOT NULL, checked_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS funding_deposits (
 signature TEXT PRIMARY KEY, amount_base_units BIGINT NOT NULL CHECK(amount_base_units>0),
 treasury TEXT NOT NULL, mint TEXT NOT NULL, slot BIGINT NOT NULL,
 actor_id TEXT REFERENCES users(id), created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversion_quote_mints (
 quote_id TEXT PRIMARY KEY REFERENCES conversion_quotes(id), mint TEXT NOT NULL
);
