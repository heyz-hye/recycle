from .config import get_settings
from .services.common import now, uid


def seed(c):
    mode = get_settings().app_mode
    recorded = c.one("SELECT value FROM app_metadata WHERE key='mode'")
    if recorded and recorded["value"] != mode:
        raise ValueError(
            "Use a separate database for demo and Devnet; mixing simulated and on-chain rewards is not allowed."
        )
    c.execute(
        "INSERT INTO app_metadata VALUES ('mode', ?) ON CONFLICT DO NOTHING", (mode,)
    )
    c.execute(
        "INSERT INTO reward_rules VALUES ('bottles','count',500,1) ON CONFLICT DO NOTHING"
    )
    c.execute(
        "INSERT INTO reward_rules VALUES ('cardboard','grams',2000,1000) ON CONFLICT DO NOTHING"
    )
    c.execute("INSERT INTO funding_account (id) VALUES ('main') ON CONFLICT DO NOTHING")
    # Historic quotes used Circle USDC; retain that identity through a mock switch.
    circle = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
    c.execute(
        "INSERT INTO conversion_quote_mints SELECT id,? FROM conversion_quotes WHERE 1=1 ON CONFLICT DO NOTHING",
        (circle,),
    )
    if mode == "devnet":
        bound = c.one("SELECT value FROM app_metadata WHERE key='usdc_mint'")
        previous = bound["value"] if bound else circle
        selected = get_settings().solana_usdc_mint
        if previous != selected and (
            c.one("SELECT COUNT(*) AS n FROM conversions WHERE asset='USDC'")["n"]
            or c.one("SELECT COUNT(*) AS n FROM withdrawals WHERE asset='USDC'")["n"]
        ):
            raise ValueError(
                "Cannot change the USDC mint after USDC conversions or withdrawals. Preserve the existing asset ledger."
            )
        c.execute(
            "INSERT INTO app_metadata VALUES ('usdc_mint',?) ON CONFLICT (key) DO UPDATE SET value=excluded.value",
            (selected,),
        )
    # Existing Devnet rewards were delivered directly to wallets. Never credit
    # them to the new withdrawable platform balance a second time.
    c.execute(
        "INSERT INTO reward_custody (reward_id,delivery) SELECT id,? FROM rewards WHERE 1=1 ON CONFLICT DO NOTHING",
        ("internal" if mode == "demo" else "external",),
    )
    if mode != "demo" or not get_settings().demo_accounts_enabled:
        return
    # Example neighborhood coordinates, not verified public drop-off facilities.
    # Never seed these locations into a Devnet/production database.
    for center_id, name, address, latitude, longitude in [
        (
            "greenpoint",
            "Greenpoint Recycling Center",
            "Greenpoint, Brooklyn · Demo location",
            40.7305,
            -73.9544,
        ),
        (
            "williamsburg",
            "Williamsburg Demo Center",
            "Williamsburg, Brooklyn · Demo location",
            40.7145,
            -73.9614,
        ),
        (
            "downtown",
            "Downtown Brooklyn Demo Center",
            "Downtown Brooklyn · Demo location",
            40.6925,
            -73.9903,
        ),
    ]:
        c.execute(
            "INSERT INTO centers VALUES (?,?,?) ON CONFLICT DO NOTHING",
            (center_id, name, address),
        )
        c.execute(
            "INSERT INTO center_locations VALUES (?,?,?,1) ON CONFLICT DO NOTHING",
            (center_id, latitude, longitude),
        )
    for identity, name, role, center in [
        ("recycler", "Alex Morgan", "recycler", None),
        ("verifier", "Jamie Chen", "verifier", "greenpoint"),
        ("partner", "Green Future Fund", "funding_partner", None),
        ("verifier-williamsburg", "Williamsburg Staff", "verifier", "williamsburg"),
        ("verifier-downtown", "Downtown Staff", "verifier", "downtown"),
    ]:
        c.execute(
            "INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING",
            (identity, f"demo:{identity}", name, role, center),
        )
    if not c.one("SELECT id FROM funding_ledger WHERE reference='demo-initial'"):
        c.execute(
            "INSERT INTO funding_ledger VALUES (?,?,?,?,?,?)",
            (uid(), "received", 50000, "demo-initial", "partner", now()),
        )
        c.execute(
            "UPDATE funding_account SET received_cents=received_cents+50000, available_cents=available_cents+50000 WHERE id='main'"
        )
