"""Explicit operator provisioning for manual role testing, never automatic seeding."""

import json
import os
import secrets
from pathlib import Path

from ..config import get_settings
from ..db import transaction
from ..schemas import Registration
from .accounts import create_account, hash_password
from .common import require


def create_test_accounts(output: Path):
    require(
        get_settings().app_mode == "demo",
        "Test accounts require simulated APP_MODE=demo.",
    )
    definitions = [
        ("recycler", "Recycler Test", "recycler", None),
        ("worker.greenhill", "Greenhill Worker Test", "verifier", "test-greenhill"),
        ("worker.riverside", "Riverside Worker Test", "verifier", "test-riverside"),
        ("fund.manager", "Government Fund Manager Test", "funding_partner", None),
    ]
    accounts = [
        {
            "email": f"{email}@loopmint.example",
            "name": name,
            "role": role,
            "center_id": center,
            "password": secrets.token_urlsafe(24),
        }
        for email, name, role, center in definitions
    ]
    hashes = [hash_password(a["password"]) for a in accounts]
    output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation prevents clobbering files or following an existing symlink.
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w") as file, transaction() as c:
            for a in accounts:
                require(
                    not c.one(
                        "SELECT user_id FROM account_credentials WHERE email=?",
                        (a["email"],),
                    ),
                    "Test accounts already exist. Use their existing credential file or reset-password; no accounts were changed.",
                    409,
                )
            for center_id, name, lat, lng in [
                (
                    "test-greenhill",
                    "TEST ONLY — Greenhill Recycling Center",
                    40.7305,
                    -73.9544,
                ),
                (
                    "test-riverside",
                    "TEST ONLY — Riverside Recycling Center",
                    40.7145,
                    -73.9614,
                ),
            ]:
                require(
                    not c.one("SELECT id FROM centers WHERE id=?", (center_id,)),
                    "A test center ID is already in use; no accounts were changed.",
                    409,
                )
                c.execute(
                    "INSERT INTO centers VALUES (?,?,?)",
                    (
                        center_id,
                        name,
                        "Fictional test site — sample Brooklyn coordinates; do not visit",
                    ),
                )
                c.execute(
                    "INSERT INTO center_locations VALUES (?,?,?,1)",
                    (center_id, lat, lng),
                )
            for a, hashed in zip(accounts, hashes):
                manager = a["role"] == "funding_partner"
                create_account(
                    c,
                    Registration(
                        email=a["email"], username=a["name"], password=a["password"]
                    ),
                    hashed,
                    a["role"],
                    a["center_id"],
                    "Government fund manager" if manager else "Recycling intake worker",
                    "TEST ONLY — Government Recycling Agency" if manager else "",
                    "Environmental Services (test)" if manager else None,
                )
            json.dump(
                {
                    "sign_in_url": "http://localhost:3000",
                    "notice": "Private test credentials. Fictional sites and agency; funds and tokens are simulated. Keep this file out of Git.",
                    "accounts": accounts,
                },
                file,
                indent=2,
            )
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
    except BaseException:
        output.unlink(missing_ok=True)
        raise
