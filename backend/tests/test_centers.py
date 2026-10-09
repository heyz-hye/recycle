import pytest
from pydantic import ValidationError
from app.db import initialize, transaction
from app.schemas import CenterConfiguration
from app.services.centers import configure_center
from test_flow import login, submit


def test_centers_require_login_and_return_locations(client):
    assert client.get("/api/centers").status_code == 401
    login(client)
    centers = client.get("/api/centers").json()
    assert {c["id"] for c in centers} == {"greenpoint", "williamsburg", "downtown"}
    assert all(
        c["is_demo"] == 1 and c["latitude"] is not None and c["longitude"] is not None
        for c in centers
    )


def test_legacy_centers_without_coordinates_remain_selectable(client):
    with transaction() as c:
        c.execute(
            "INSERT INTO centers VALUES ('legacy','Legacy Center','Address not yet geocoded')"
        )
    login(client)
    legacy = next(c for c in client.get("/api/centers").json() if c["id"] == "legacy")
    assert legacy["latitude"] is None and legacy["longitude"] is None
    result = client.post(
        "/api/claims",
        json={
            "center_id": "legacy",
            "items": [{"material": "bottles", "unit": "count", "quantity": 1}],
        },
    )
    assert result.status_code == 201
    assert result.json()["center_id"] == "legacy"


def test_configure_center_preserves_claims_and_updates_coordinates(client):
    claim = submit(client)
    with transaction() as c:
        configure_center(
            c,
            CenterConfiguration(
                id="greenpoint",
                name="Updated Center",
                address="Registered address",
                latitude=0,
                longitude=0,
            ),
        )
    initialize()  # Restart does not overwrite operator-maintained coordinates.
    center = next(
        c for c in client.get("/api/centers").json() if c["id"] == "greenpoint"
    )
    assert (center["latitude"], center["longitude"], center["is_demo"]) == (0, 0, 0)
    assert center["name"] == "Updated Center"
    assert client.get("/api/claims/" + claim["id"]).json()["ticket"] == claim["ticket"]


@pytest.mark.parametrize(
    "latitude,longitude",
    [(91, 0), (-91, 0), (0, 181), (0, -181), (float("nan"), 0), (0, float("inf"))],
)
def test_invalid_center_coordinates(latitude, longitude):
    with pytest.raises(ValidationError):
        CenterConfiguration(
            id="test",
            name="Test",
            address="Address",
            latitude=latitude,
            longitude=longitude,
        )


def test_selected_center_controls_ticket_and_verifier_access(client):
    login(client)
    claim = client.post(
        "/api/claims",
        json={
            "center_id": "williamsburg",
            "items": [{"material": "bottles", "unit": "count", "quantity": 2}],
        },
    ).json()
    assert claim["center_id"] == "williamsburg"
    login(client, "verifier")
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 403
    )
    login(client, "verifier-williamsburg")
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 200
    )
    approved = client.post(
        "/api/claims/" + claim["id"] + "/confirm",
        json={
            "decision": "approved",
            "received": True,
            "items": [{"material": "bottles", "quantity": 2, "unit": "count"}],
        },
    )
    assert approved.status_code == 200
    assert approved.json()["reward"]["amount_base_units"] == 1000


def test_claim_rejects_user_coordinates_or_unregistered_center(client):
    login(client)
    body = {
        "center_id": "greenpoint",
        "items": [{"material": "bottles", "unit": "count", "quantity": 1}],
    }
    assert (
        client.post(
            "/api/claims", json={**body, "latitude": 40.7, "longitude": -73.9}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/claims", json={**body, "center_id": "unknown"}).status_code
        == 404
    )


def test_additive_location_schema_preserves_existing_data(client):
    claim = submit(client)
    with transaction() as c:
        c.execute("DROP TABLE center_locations")
    initialize()
    assert client.get("/api/claims/" + claim["id"]).json()["ticket"] == claim["ticket"]
    assert len(client.get("/api/centers").json()) == 3
