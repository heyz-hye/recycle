import pytest
from fastapi import HTTPException
from app.config import get_settings
from app.db import transaction
from app.schemas import CenterConfiguration
from app.services.centers import configure_center
from test_flow import login


def test_maps_config_requires_login_and_only_returns_browser_configuration(
    client, monkeypatch
):
    assert client.get("/api/maps/config").status_code == 401
    monkeypatch.setenv("GOOGLE_MAPS_BROWSER_KEY", "browser-test-key")
    monkeypatch.setenv("GOOGLE_MAPS_MAP_ID", "test-map")
    get_settings.cache_clear()
    login(client)
    assert client.get("/api/maps/config").json() == {
        "api_key": "browser-test-key",
        "map_id": "test-map",
    }


def test_center_google_mapping_is_unique_and_preserved_when_omitted(client):
    data = dict(
        id="greenpoint",
        name="Registered Center",
        address="Verified address",
        latitude=40.73,
        longitude=-73.95,
    )
    with transaction() as c:
        configure_center(c, CenterConfiguration(**data, google_place_id="ChIJverified"))
        configure_center(c, CenterConfiguration(**data))
    login(client)
    center = next(
        c for c in client.get("/api/centers").json() if c["id"] == "greenpoint"
    )
    assert center["google_place_id"] == "ChIJverified" and center["is_demo"] == 0
    with pytest.raises(HTTPException, match="already assigned"):
        with transaction() as c:
            configure_center(
                c,
                CenterConfiguration(
                    **{**data, "id": "second"}, google_place_id="ChIJverified"
                ),
            )
    with transaction(write=False) as c:
        assert not c.one("SELECT id FROM centers WHERE id='second'")


def test_google_place_cannot_be_used_as_unregistered_ticket_center(client):
    login(client)
    result = client.post(
        "/api/claims",
        json={
            "center_id": "ChIJpublicplace",
            "items": [{"material": "bottles", "unit": "count", "quantity": 1}],
        },
    )
    assert result.status_code == 404
