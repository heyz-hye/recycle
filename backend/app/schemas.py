from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
import re


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmailInput(StrictModel):
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalized_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address.")
        return value


class EmailLogin(EmailInput):
    password: str = Field(min_length=1, max_length=128)


class Registration(EmailInput):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=15, max_length=128)

    @field_validator("username")
    @classmethod
    def display_name(cls, value):
        if not value.strip():
            raise ValueError("Enter your name.")
        return value.strip()


class PasswordChange(StrictModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=15, max_length=128)


class Item(StrictModel):
    material: Literal["bottles", "cardboard"]
    quantity: int = Field(ge=1, le=1000000, strict=True)
    unit: Literal["count", "grams"]

    @model_validator(mode="after")
    def units(self):
        if self.unit != ("count" if self.material == "bottles" else "grams"):
            raise ValueError("Bottles use count; cardboard uses integer grams.")
        return self


class ClaimInput(StrictModel):
    center_id: str = Field(min_length=1, max_length=100)
    items: list[Item] = Field(min_length=1, max_length=2)

    @model_validator(mode="after")
    def unique(self):
        if len({i.material for i in self.items}) != len(self.items):
            raise ValueError("Each material must appear once.")
        return self


class Confirmation(StrictModel):
    decision: Literal["approved", "rejected"]
    received: bool = False
    items: list[Item] = Field(default_factory=list, max_length=2)
    reason: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def valid(self):
        if self.decision == "approved" and (not self.received or not self.items):
            raise ValueError(
                "Confirm physical receipt and at least one accepted quantity."
            )
        if self.decision == "rejected" and (not self.reason.strip() or self.items):
            raise ValueError("Rejections require a reason and no accepted items.")
        if len({i.material for i in self.items}) != len(self.items):
            raise ValueError("Each material must appear once.")
        return self


class TicketInput(StrictModel):
    ticket: str = Field(min_length=10, max_length=150)


class FundingInput(StrictModel):
    amount_cents: int = Field(gt=0, le=10000000, strict=True)
    request_key: str = Field(min_length=8, max_length=100)


class RedemptionInput(StrictModel):
    amount_base_units: int = Field(ge=100, le=1000000000, strict=True)
    request_key: str = Field(min_length=8, max_length=100)

    @model_validator(mode="after")
    def whole_cent(self):
        if self.amount_base_units % 100:
            raise ValueError("Redeem whole LOOP tokens (integer demo cents).")
        return self


class WalletChallenge(StrictModel):
    wallet: str = Field(min_length=32, max_length=44)


class WalletLogin(StrictModel):
    challenge_id: str
    signature: str = Field(min_length=64, max_length=128)
    username: str = Field(default="Recycler", min_length=1, max_length=40)


class DemoLogin(StrictModel):
    account: Literal[
        "recycler", "verifier", "partner", "verifier-williamsburg", "verifier-downtown"
    ]


class CenterConfiguration(StrictModel):
    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=150)
    address: str = Field(min_length=1, max_length=300)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    google_place_id: str | None = Field(default=None, min_length=1, max_length=255)


class RedemptionConfirm(StrictModel):
    signature: str = Field(min_length=64, max_length=100)
