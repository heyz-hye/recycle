import time
from uuid import uuid4
from fastapi import HTTPException


def now():
    return int(time.time())


def uid():
    return str(uuid4())


def require(condition, message, code=400):
    if not condition:
        raise HTTPException(code, message)


def event(c, center, user, material, quantity, reward, kind):
    c.execute(
        "INSERT INTO recycling_events VALUES (?,?,?,?,?,?,?,?)",
        (uid(), now(), center, user, material, quantity, reward, kind),
    )
