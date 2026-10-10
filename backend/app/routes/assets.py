from fastapi import APIRouter, Depends
from ..auth import current_user
from ..db import transaction
from ..schemas import ConversionQuoteInput, ConversionInput, WithdrawalInput
from ..services import assets

router = APIRouter(prefix="/assets")


@router.get("")
def overview(user=Depends(current_user)):
    with transaction(write=False) as c:
        return assets.overview(c, user["id"])


@router.post("/quotes")
def quote(body: ConversionQuoteInput, user=Depends(current_user)):
    with transaction() as c:
        return assets.quote(c, user, body)


@router.post("/conversions")
def convert(body: ConversionInput, user=Depends(current_user)):
    with transaction() as c:
        return assets.convert(c, user, body)


@router.post("/withdrawals", status_code=201)
def withdraw(body: WithdrawalInput, user=Depends(current_user)):
    with transaction() as c:
        return assets.withdraw(c, user, body)
