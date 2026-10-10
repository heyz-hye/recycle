import os
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.config import get_settings
from app.services.solana_client import chain
from app.main import app


@pytest.fixture
def client(tmp_path, monkeypatch):
    url = os.getenv("TEST_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    schema = None
    base_url = url
    if url.startswith("postgres"):
        import psycopg
        from psycopg import sql

        schema = "test_" + uuid4().hex
        with psycopg.connect(base_url) as conn:
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        parsed = urlsplit(url)
        query = dict(parse_qsl(parsed.query))
        query["options"] = f"-csearch_path={schema}"
        url = urlunsplit(parsed._replace(query=urlencode(query)))
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("APP_MODE", "demo")
    monkeypatch.setenv("DEMO_AUTO_WORKER", "false")
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "true")
    monkeypatch.setenv("TIMESCALE_ENABLED", "false")
    monkeypatch.setenv("SOLANA_MINT", "")
    monkeypatch.setenv("SOLANA_ISSUER_KEYPAIR", "")
    get_settings.cache_clear()
    chain.cache_clear()
    try:
        with TestClient(app) as session:
            yield session
    finally:
        get_settings.cache_clear()
        chain.cache_clear()
        if schema:
            with psycopg.connect(base_url) as conn:
                conn.execute(
                    sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema))
                )
