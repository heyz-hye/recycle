from .common import uid, now, require


def reserve(c, reward):
    result = c.execute(
        "UPDATE funding_account SET available_cents=available_cents-?, reserved_cents=reserved_cents+? WHERE id='main' AND available_cents>=?",
        (reward["cost_cents"], reward["cost_cents"], reward["cost_cents"]),
    )
    if result.rowcount != 1:
        return False
    c.execute("UPDATE rewards SET state='queued' WHERE id=?", (reward["id"],))
    c.execute("INSERT INTO reward_jobs (reward_id) VALUES (?)", (reward["id"],))
    c.execute(
        "INSERT INTO funding_ledger VALUES (?,?,?,?,?,?)",
        (
            uid(),
            "reserved",
            reward["cost_cents"],
            f"reserve:{reward['id']}",
            None,
            now(),
        ),
    )
    return True


def fund_waiting(c):
    for reward in c.all(
        "SELECT * FROM rewards WHERE state='awaiting_funding' ORDER BY created_at,id"
    ):
        reserve(c, reward)


def create_reward(c, claim, amount):
    # Base unit = 0.01 LOOP. 1 LOOP = 1 demo cent. Reserve rounded UP.
    reward = dict(
        id=uid(),
        claim_id=claim["id"],
        user_id=claim["user_id"],
        amount_base_units=amount,
        cost_cents=(amount + 99) // 100,
    )
    c.execute(
        "INSERT INTO rewards (id,claim_id,user_id,amount_base_units,cost_cents,state,created_at) VALUES (?,?,?,?,?,'awaiting_funding',?)",
        (
            reward["id"],
            claim["id"],
            claim["user_id"],
            amount,
            reward["cost_cents"],
            now(),
        ),
    )
    reserve(c, reward)


def deposit(c, actor, body):
    reference = f"deposit:{actor['id']}:{body.request_key}"
    existing = c.one(
        "SELECT amount_cents FROM funding_ledger WHERE reference=?", (reference,)
    )
    if existing:
        require(
            existing["amount_cents"] == body.amount_cents,
            "This request key was already used for a different amount.",
            409,
        )
        return
    c.execute(
        "INSERT INTO funding_ledger VALUES (?,?,?,?,?,?)",
        (uid(), "received", body.amount_cents, reference, actor["id"], now()),
    )
    c.execute(
        "UPDATE funding_account SET received_cents=received_cents+?,available_cents=available_cents+? WHERE id='main'",
        (body.amount_cents, body.amount_cents),
    )
    fund_waiting(c)
