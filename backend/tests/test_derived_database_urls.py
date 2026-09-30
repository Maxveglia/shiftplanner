from __future__ import annotations

"""What survives the split of one managed URL into two.

Railway hands us a single superuser URL and config.py cuts it in two: the
admin URL that migrates, and the app_user URL that serves requests. The cut
used to keep the scheme, the credentials, the host and the path -- and throw
away the query, where `?sslmode=require` lives.

That is a silent failure, which is why it needs a test rather than a reading.
Without sslmode, libpq uses `prefer`: it still connects, still talks to the
right database, and every test and every page keeps working -- over a
negotiated session with an unverified certificate, or over plain text if the
server happens not to offer TLS. Nothing goes red. So the assertion is on the
string, before anything opens a socket.
"""

import pytest

from app.config import Settings


def _derive(monkeypatch: pytest.MonkeyPatch, database_url: str) -> Settings:
    """Build Settings from DATABASE_URL alone, with the environment out of it.

    Derivation only runs for a field the caller did not set, and
    pydantic-settings counts an env var as the caller. The suite exports
    APP_DATABASE_URL and ADMIN_DATABASE_URL, and a stray .env would do the
    same, so both have to go or this test silently asserts nothing.
    """
    for name in ("APP_DATABASE_URL", "ADMIN_DATABASE_URL", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    # These URLs name a host that is not this machine, which is the one case
    # where `Settings` refuses to build on the published defaults of
    # `jwt_secret` and `app_db_password`. That refusal is the point of the
    # check and not something to weaken -- but this file is about how ONE url
    # is split into two, and the password it carries has to stay exactly what
    # the assertions below expect. So the check is waived here rather than
    # having every case invent secrets it does not care about.
    return Settings(
        database_url=database_url, allow_published_defaults=True, _env_file=None
    )


def test_sslmode_reaches_both_derived_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _derive(
        monkeypatch,
        "postgresql://postgres:secret@db.railway.internal:5432/railway?sslmode=require",
    )

    assert settings.admin_database_url == (
        "postgresql+psycopg://postgres:secret@db.railway.internal:5432/railway"
        "?sslmode=require"
    )
    assert settings.app_database_url == (
        "postgresql+psycopg://app_user:app_pass@db.railway.internal:5432/railway"
        "?sslmode=require"
    )


def test_every_connection_parameter_is_carried_over(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Not just sslmode -- the query is copied whole.

    sslrootcert and friends travel in the same string, and a fix that reached
    only for the one parameter we happened to be looking at would drop the
    certificate that makes `verify-full` mean anything.
    """
    settings = _derive(
        monkeypatch,
        "postgresql://postgres:secret@example.com:5432/railway"
        "?sslmode=verify-full&sslrootcert=/etc/ssl/ca.pem&connect_timeout=10",
    )

    for url in (settings.admin_database_url, settings.app_database_url):
        assert url.endswith(
            "?sslmode=verify-full&sslrootcert=/etc/ssl/ca.pem&connect_timeout=10"
        )


def test_credentials_are_not_re_encoded(monkeypatch: pytest.MonkeyPatch) -> None:
    """The reason the admin URL reuses netloc verbatim, kept honest.

    A managed password arrives already percent-encoded. Re-encoding it turns
    an '@' -- '%40' in the URL -- into '%2540', and the app then authenticates
    with a password nobody set.
    """
    settings = _derive(
        monkeypatch,
        "postgresql://postgres:p%40ss@example.com:5432/railway?sslmode=require",
    )

    assert "p%40ss" in settings.admin_database_url
    assert "%2540" not in settings.admin_database_url


def test_a_url_without_a_query_gains_no_question_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A local URL carries no parameters, and must not grow a dangling '?'."""
    settings = _derive(
        monkeypatch, "postgresql://postgres:postgres@localhost:5432/shiftplanner"
    )

    assert settings.admin_database_url == (
        "postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner"
    )
    assert settings.app_database_url == (
        "postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner"
    )
