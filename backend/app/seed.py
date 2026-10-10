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
        "INSERT INTO centers VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        (
            "greenpoint",
            "Greenpoint Recycling Center",
            "Greenpoint, Brooklyn · Mon–Sat, 9am–5pm",
        ),
    )
    c.execute(
        "INSERT INTO reward_rules VALUES ('bottles','count',500,1) ON CONFLICT DO NOTHING"
    )
    c.execute(
        "INSERT INTO reward_rules VALUES ('cardboard','grams',2000,1000) ON CONFLICT DO NOTHING"
    )
    c.execute("INSERT INTO funding_account (id) VALUES ('main') ON CONFLICT DO NOTHING")
    if get_settings().app_mode != "demo":
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
