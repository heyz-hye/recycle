-- Run once with `python -m app.cli enable-timescale` against Tiger Cloud / TimescaleDB.
-- Authoritative claims, funding, and rewards remain ordinary transactional tables.
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('recycling_events', 'created_at', chunk_time_interval => 604800::BIGINT, if_not_exists => TRUE, migrate_data => TRUE);
CREATE OR REPLACE FUNCTION loopmint_unix_now() RETURNS BIGINT LANGUAGE SQL STABLE AS $$
  SELECT floor(extract(epoch FROM now()))::BIGINT;
$$;
SELECT set_integer_now_func('recycling_events', 'loopmint_unix_now', replace_if_exists => TRUE);
CREATE MATERIALIZED VIEW IF NOT EXISTS recycling_hourly
WITH (timescaledb.continuous) AS
SELECT time_bucket(3600::BIGINT, created_at) AS hour,
       center_id, material, event_type,
       SUM(quantity) AS quantity,
       SUM(reward_base_units) AS reward_base_units,
       COUNT(*) AS events
FROM recycling_events
GROUP BY hour, center_id, material, event_type
WITH NO DATA;
ALTER MATERIALIZED VIEW recycling_hourly SET (timescaledb.materialized_only = FALSE);
SELECT add_continuous_aggregate_policy('recycling_hourly', start_offset => 2592000::BIGINT, end_offset => 3600::BIGINT, schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE);
