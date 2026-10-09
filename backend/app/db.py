from contextlib import contextmanager
from pathlib import Path
import sqlite3
from .config import get_settings


class Connection:
    def __init__(self, raw, postgres):
        self.raw, self.postgres = raw, postgres

    def execute(self, sql, params=()):
        return self.raw.execute(
            sql.replace("?", "%s") if self.postgres else sql, params
        )

    def one(self, sql, params=()):
        row = self.execute(sql, params).fetchone()
        return dict(row) if row is not None else None

    def all(self, sql, params=()):
        return [dict(row) for row in self.execute(sql, params).fetchall()]


@contextmanager
def transaction(write=True):
    url = get_settings().database_url
    postgres = url.startswith("postgres")
    if postgres:
        import psycopg
        from psycopg.rows import dict_row

        raw = psycopg.connect(url, row_factory=dict_row)
    else:
        path = url.removeprefix("sqlite:///")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        raw = sqlite3.connect(path, timeout=30)
        raw.row_factory = sqlite3.Row
        raw.execute("PRAGMA foreign_keys=ON")
        raw.execute("PRAGMA journal_mode=WAL")
        raw.execute("BEGIN IMMEDIATE" if write else "BEGIN")
    try:
        conn = Connection(raw, postgres)
        if postgres and write:
            # One transaction-scoped lock orders financial writes across API and worker.
            # This intentionally favors correctness over throughput for the one-center MVP.
            conn.execute("SELECT pg_advisory_xact_lock(7410252026)")
        yield conn
        raw.commit()
    except BaseException:
        raw.rollback()
        raise
    finally:
        raw.close()


def initialize():
    from .seed import seed

    with transaction() as c:
        for statement in (
            (Path(__file__).parents[1] / "sql/schema.sql").read_text().split(";")
        ):
            if statement.strip():
                c.execute(statement)
        seed(c)
