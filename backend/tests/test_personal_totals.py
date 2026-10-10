from app.db import transaction


def test_lifetime_totals_are_private_and_not_limited_to_recent_tickets(client):
    assert client.get("/api/wallet").status_code == 401
    client.post("/api/auth/demo", json={"account": "recycler"})
    assert client.get("/api/wallet").json()["totals"] == {
        "bottles": 0,
        "cardboard_grams": 0,
        "reward_base_units": 0,
    }
    with transaction() as c:
        for n in range(108):
            # 105 verified tickets, one pending intake, one rejected, one other user.
            status = "submitted" if n == 105 else "rejected" if n == 106 else "verified"
            user_id = "verifier" if n == 107 else "recycler"
            c.execute(
                "INSERT INTO claims VALUES (?,?,?,?,?,?,?)",
                (
                    f"total-{n}",
                    user_id,
                    "greenpoint",
                    status,
                    f"ticket-{n}",
                    2000000000,
                    n,
                ),
            )
            for material, accepted in (("bottles", 2), ("cardboard", 1250)):
                c.execute(
                    "INSERT INTO claim_items (claim_id,material,submitted_quantity,accepted_quantity) VALUES (?,?,?,?)",
                    (f"total-{n}", material, 9000, accepted),
                )
            if status == "verified":
                c.execute(
                    "INSERT INTO rewards (id,claim_id,user_id,amount_base_units,cost_cents,state,created_at) VALUES (?,?,?,?,?,?,?)",
                    (
                        f"reward-{n}",
                        f"total-{n}",
                        user_id,
                        3500,
                        35,
                        "queued" if n == 104 else "confirmed",
                        n,
                    ),
                )
        c.execute(
            "INSERT INTO redemptions (id,user_id,amount_base_units,payout_cents,state,request_key,created_at) VALUES ('spent','recycler',1000,10,'completed','spent',1)"
        )
    assert len(client.get("/api/claims").json()) == 100
    wallet = client.get("/api/wallet").json()
    assert wallet["totals"] == {
        "bottles": 210,
        "cardboard_grams": 131250,
        "reward_base_units": 364000,
    }
    assert wallet["balance_base_units"] == 363000
    client.post("/api/auth/demo", json={"account": "verifier"})
    assert client.get("/api/wallet").json()["totals"] == {
        "bottles": 2,
        "cardboard_grams": 1250,
        "reward_base_units": 3500,
    }
