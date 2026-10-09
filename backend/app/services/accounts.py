"""Individual accounts; privileged roles and workplace assignments are operator-only."""

import hashlib
import secrets
from threading import BoundedSemaphore
from ..db import transaction
from ..schemas import Registration
from .common import now, uid, require

_hash_slots = BoundedSemaphore(2)


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(16)
    with _hash_slots:
        value = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt),
            n=131072,
            r=8,
            p=1,
            maxmem=256 * 1024 * 1024,
            dklen=32,
        ).hex()
    return f"scrypt$131072$8$1${salt}${value}"


def verify_password(password, encoded):
    # Do equivalent password work for unknown emails, without storing plaintext.
    encoded = encoded or "scrypt$131072$8$1$" + "00" * 16 + "$" + "00" * 32
    try:
        algorithm, n, r, p, salt, _ = encoded.split("$")
        if (algorithm, n, r, p) != ("scrypt", "131072", "8", "1"):
            return False
        return secrets.compare_digest(hash_password(password, salt), encoded)
    except (ValueError, TypeError):
        return False


def account(c, user_id):
    return c.one(
        "SELECT u.*, a.email, c.name AS job_location, c.address AS job_address, "
        "s.job_title, f.organization FROM users u "
        "LEFT JOIN account_credentials a ON a.user_id=u.id "
        "LEFT JOIN centers c ON c.id=u.center_id "
        "LEFT JOIN staff_profiles s ON s.user_id=u.id "
        "LEFT JOIN funding_member_profiles f ON f.user_id=u.id WHERE u.id=?",
        (user_id,),
    )


def create_account(
    c,
    data: Registration,
    password_hash,
    role="recycler",
    center_id=None,
    job_title="Center staff",
    organization="",
):
    require(role in ("recycler", "verifier", "funding_partner"), "Unknown role.")
    require(
        not c.one(
            "SELECT user_id FROM account_credentials WHERE email=?", (data.email,)
        ),
        "An account with this email already exists. Sign in or contact your operator.",
        409,
    )
    if role == "verifier":
        require(
            center_id and c.one("SELECT id FROM centers WHERE id=?", (center_id,)),
            "Staff require a registered job location.",
        )
        require(
            bool(job_title.strip()) and len(job_title) <= 100,
            "Enter a job title (up to 100 characters).",
        )
    else:
        require(center_id is None, "Only staff can have a job location.")
    if role == "funding_partner":
        require(
            bool(organization.strip()) and len(organization) <= 150,
            "Enter a funding organization (up to 150 characters).",
        )
    user_id = uid()
    # Preserve legacy NOT NULL wallet schema. This is an unlinked marker, never a chain address.
    c.execute(
        "INSERT INTO users VALUES (?,?,?,?,?)",
        (user_id, "account:" + user_id, data.username, role, center_id),
    )
    c.execute(
        "INSERT INTO account_credentials VALUES (?,?,?,?,?)",
        (user_id, data.email, password_hash, now(), now()),
    )
    if role == "verifier":
        c.execute(
            "INSERT INTO staff_profiles VALUES (?,?)", (user_id, job_title.strip())
        )
    elif role == "funding_partner":
        c.execute(
            "INSERT INTO funding_member_profiles VALUES (?,?)",
            (user_id, organization.strip()),
        )
    return account(c, user_id)


def throttle(email, remote_address):
    # Commit attempts separately so failed authentication cannot roll them back.
    with transaction() as c:
        c.execute("DELETE FROM auth_attempts WHERE expires_at<=?", (now(),))
        for key, limit in (("email:" + email, 10), ("ip:" + remote_address, 60)):
            hashed = hashlib.sha256(key.encode()).hexdigest()
            row = c.one(
                "SELECT attempts FROM auth_attempts WHERE key_hash=?", (hashed,)
            )
            require(
                not row or row["attempts"] < limit,
                "Too many sign-in attempts. Try again in 15 minutes.",
                429,
            )
        for key in ("email:" + email, "ip:" + remote_address):
            hashed = hashlib.sha256(key.encode()).hexdigest()
            c.execute(
                "INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key_hash) "
                "DO UPDATE SET attempts=auth_attempts.attempts+1",
                (hashed, now() + 900),
            )


def clear_email_attempts(c, email):
    c.execute(
        "DELETE FROM auth_attempts WHERE key_hash=?",
        (hashlib.sha256(("email:" + email).encode()).hexdigest(),),
    )
