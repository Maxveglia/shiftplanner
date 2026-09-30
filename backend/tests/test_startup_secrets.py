"""The app refuses to start with a published secret against a remote database.

The two defaults live in .env.example, so they are not secrets at all. On a
laptop they are a convenience; anywhere the database is reachable over the
network they are the whole barrier, which is why this is an abort and not a
warning -- the failure it exists for (a variable missing from the deploy
environment) is silent by nature.
"""

from __future__ import annotations

import pytest

from app.config import Settings

REMOTE = "postgresql://postgres:hunter2@db.internal:5432/shiftplanner"
LOCAL = "postgresql://postgres:postgres@localhost:5432/shiftplanner"

# Every variable Settings reads that could decide the outcome. Without this the
# suite passes alone and fails when run with the test database exported, which
# is exactly how it is run -- an ambient APP_DATABASE_URL counts as explicitly
# set, so nothing gets derived.
AMBIENT = (
    "DATABASE_URL",
    "APP_DATABASE_URL",
    "ADMIN_DATABASE_URL",
    "JWT_SECRET",
    "APP_DB_PASSWORD",
    "ALLOW_PUBLISHED_DEFAULTS",
)


@pytest.fixture(autouse=True)
def _ignore_the_ambient_environment(monkeypatch):
    for name in AMBIENT:
        monkeypatch.delenv(name, raising=False)


def settings(**kwargs) -> Settings:
    """Settings as a fresh install would build them: no .env, no environment."""
    return Settings(_env_file=None, **kwargs)


def test_local_database_still_starts_with_the_defaults():
    """A laptop is the case the defaults are there for."""
    s = settings(database_url=LOCAL)

    assert s.jwt_secret == "change-me-dev-secret"
    assert s.app_db_password == "app_pass"


def test_remote_database_with_both_defaults_refuses_to_start():
    with pytest.raises(ValueError) as exc:
        settings(database_url=REMOTE)

    message = str(exc.value)
    assert "APP_DB_PASSWORD" in message
    assert "JWT_SECRET" in message


def test_the_message_names_only_the_one_left_behind():
    """Half-done is the likeliest mistake, so the message must not be vague."""
    with pytest.raises(ValueError) as exc:
        settings(database_url=REMOTE, app_db_password="a-real-password")

    message = str(exc.value)
    assert "JWT_SECRET" in message
    assert "APP_DB_PASSWORD" not in message


def test_remote_database_with_real_secrets_starts_and_still_derives_the_urls():
    s = settings(
        database_url=REMOTE,
        jwt_secret="a-real-secret",
        app_db_password="a-real-password",
    )

    assert s.admin_database_url.startswith("postgresql+psycopg://postgres:hunter2@db.internal")
    assert s.app_database_url.startswith("postgresql+psycopg://app_user:a-real-password@db.internal")


def test_an_explicit_remote_app_url_is_checked_too():
    """The migration stamps APP_DB_PASSWORD on the role whatever the URL says."""
    with pytest.raises(ValueError):
        settings(app_database_url=REMOTE.replace("postgresql://", "postgresql+psycopg://"))


def test_the_escape_hatch_is_honoured():
    s = settings(database_url=REMOTE, allow_published_defaults=True)

    assert s.jwt_secret == "change-me-dev-secret"
