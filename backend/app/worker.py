import logging
import time
from .db import transaction, initialize
from .services.solana_client import chain, DemoChain
from .services.common import now, uid, event
from .services.rewards import fund_waiting, has_confirmed_ticket

log = logging.getLogger(__name__)


def tick(adapter=None):
    from .config import get_settings

    with transaction() as c:
        fund_waiting(c)
        ids = c.all(
            "SELECT reward_id FROM reward_jobs j JOIN rewards r ON r.id=j.reward_id WHERE r.state IN ('queued','sent') AND j.needs_review=0 ORDER BY r.created_at,r.id LIMIT 20"
        )
    for row in ids:
        reward_id = row["reward_id"]
        try:
            # Concurrent workers can rebroadcast the SAME persisted bytes, never create another signature.
            with transaction() as c:
                job = c.one("SELECT * FROM reward_jobs WHERE reward_id=?", (reward_id,))
                reward = c.one(
                    "SELECT r.*,u.wallet,c.center_id FROM rewards r JOIN users u ON u.id=r.user_id JOIN claims c ON c.id=r.claim_id WHERE r.id=?",
                    (reward_id,),
                )
                if reward["state"] == "confirmed" or job["needs_review"]:
                    continue
                if not has_confirmed_ticket(c, reward["claim_id"], reward["user_id"]):
                    c.execute(
                        "UPDATE reward_jobs SET needs_review=1,last_error=? WHERE reward_id=?",
                        (
                            "Reward blocked: the ticket has no valid center confirmation.",
                            reward_id,
                        ),
                    )
                    continue
                custody = c.one(
                    "SELECT delivery FROM reward_custody WHERE reward_id=?",
                    (reward_id,),
                )
                internal = custody and custody["delivery"] == "internal"
                effective = adapter or (
                    DemoChain("demo" if get_settings().app_mode == "demo" else "credit")
                    if internal
                    else chain()
                )
                if not job["signature"]:
                    prepared = effective.prepare(reward, reward["wallet"])
                    c.execute(
                        "UPDATE reward_jobs SET transaction_b64=?,signature=?,last_valid_block_height=? WHERE reward_id=?",
                        (
                            prepared["transaction_b64"],
                            prepared["signature"],
                            prepared["last_valid_block_height"],
                            reward_id,
                        ),
                    )
                    c.execute(
                        "UPDATE rewards SET signature=? WHERE id=?",
                        (prepared["signature"], reward_id),
                    )
                    job.update(prepared)
            # This runs only after the signed transaction has committed.
            state = effective.status(job)
            if state == "confirmed":
                with transaction() as c:
                    changed = c.execute(
                        "UPDATE rewards SET state='confirmed',confirmed_at=? WHERE id=? AND state!='confirmed'",
                        (now(), reward_id),
                    ).rowcount
                    if changed:
                        c.execute(
                            "UPDATE funding_account SET reserved_cents=reserved_cents-?,issued_cents=issued_cents+? WHERE id='main'",
                            (reward["cost_cents"], reward["cost_cents"]),
                        )
                        c.execute(
                            "INSERT INTO funding_ledger VALUES (?,?,?,?,?,?)",
                            (
                                uid(),
                                "issued",
                                reward["cost_cents"],
                                f"issued:{reward_id}",
                                None,
                                now(),
                            ),
                        )
                        event(
                            c,
                            reward["center_id"],
                            reward["user_id"],
                            "reward",
                            0,
                            reward["amount_base_units"],
                            "reward",
                        )
                    c.execute(
                        "UPDATE reward_jobs SET last_error=NULL WHERE reward_id=?",
                        (reward_id,),
                    )
            elif state in ("failed", "expired"):
                with transaction() as c:
                    c.execute(
                        "UPDATE reward_jobs SET needs_review=1,last_error=? WHERE reward_id=?",
                        (
                            "Transaction failed or expired; operator reconciliation required. No automatic reissuance.",
                            reward_id,
                        ),
                    )
            elif state == "missing":
                effective.broadcast(job["transaction_b64"])
                with transaction() as c:
                    c.execute(
                        "UPDATE reward_jobs SET attempts=attempts+1,last_error=NULL WHERE reward_id=?",
                        (reward_id,),
                    )
                    c.execute(
                        "UPDATE rewards SET state='sent' WHERE id=? AND state='queued'",
                        (reward_id,),
                    )
        except Exception:
            log.exception("Reward worker failed for reward %s", reward_id)
            with transaction() as c:
                c.execute(
                    "UPDATE reward_jobs SET last_error=? WHERE reward_id=?",
                    (
                        "Network or configuration issue. The same persisted transaction will be reconciled before retry.",
                        reward_id,
                    ),
                )
    from .services.assets import process_withdrawals

    process_withdrawals()
    if get_settings().app_mode != "demo" and get_settings().solana_mint:
        from .services.redemptions import reconcile_pending

        reconcile_pending(adapter or chain())


def main():
    from .config import get_settings

    get_settings().validate_runtime()
    initialize()
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            tick()
        except Exception:
            log.exception("Worker cycle failed")
        time.sleep(5)


if __name__ == "__main__":
    main()
