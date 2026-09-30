from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import bcrypt
import jwt

from app.config import settings
from app.schemas.enums import Role

# bcrypt hashes at most 72 bytes and ignores the rest. That is a property of
# the algorithm, not a limit we impose, so we apply it explicitly and identically
# on both sides -- hashing and verifying -- rather than letting the library
# raise on a long passphrase and lock somebody out of their own schedule.
BCRYPT_MAX_BYTES = 72


def _prepare(password: str) -> bytes:
    return password.encode("utf-8")[:BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """bcrypt hash, stored as the usual ``$2b$...`` string."""
    return bcrypt.hashpw(_prepare(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prepare(password), hashed.encode("utf-8"))
    except ValueError:
        # Malformed or truncated hash in the row: not a match, not a crash.
        return False


# A hash of a password nobody has, for the logins to check against when there
# is no account to check against.
#
# WHY. Refusing an unknown address the moment the SELECT comes back empty is
# faster than refusing a real one, because the real one pays for bcrypt. Same
# status, same code, same words -- and a stopwatch sorts a leaked address list
# into customers and strangers anyway. The rate limiter closed the other half
# of this (its 429 is counted before the lookup, so it cannot report either);
# this closes the clock.
#
# THE COST HAS TO MATCH, and it does by construction: this is `hash_password`,
# the same function every stored hash in this deployment came from, so the
# decoy carries whatever cost factor `bcrypt.gensalt()` defaults to -- today
# 12, the same 12 in every row. If that default ever moves, old rows keep their
# old cost and would then answer faster than this decoy, which is the same leak
# with its sign flipped; the answer then is to re-hash on successful login so
# the store converges on one cost, not to pin the decoy to the old one.
#
# COMPUTED ONCE, at import. Doing it per request would double the work on the
# path that is already the cheap one -- and a decoy built lazily on first use
# would make exactly one unknown address twice as slow as the rest, which is
# a quieter version of the same oracle.
#
# The password hashed here is random and is not kept. Nothing can present it,
# so no caller can turn a decoy check into an answer of yes.
_DECOY_HASH = hash_password(secrets.token_urlsafe(32))


def verify_against_decoy(password: str) -> None:
    """Spend one password verification against nothing, and discard it.

    Returns None rather than the comparison's result, deliberately: there is no
    value here that a caller could mistake for permission, and ``if
    verify_against_decoy(...)`` is false however this is misread.
    """
    verify_password(password, _DECOY_HASH)


# Token audiences. A token is valid for exactly one of the two planes: a
# tenant token can never be replayed against the back office, and a platform
# token can never be replayed against a tenant's data. Both guards are
# enforced in app.deps; the claim below is what they read.
SCOPE_TENANT = "tenant"
SCOPE_PLATFORM = "platform"


def create_access_token(
    *,
    subject: str,
    org_id: str,
    role: str,
    session_epoch: int = 0,
    expires_minutes: Optional[int] = None,
) -> str:
    """A tenant session.

    ``sv`` is the account's ``session_epoch`` when the token was issued;
    app/deps.py refuses a token whose number is no longer the account's, so
    raising it ends every session issued before (a token from before the
    claim existed reads as 0). The till's tablet gets the long lifetime
    (``store_token_expire_days``); everybody else the usual one.
    """
    if expires_minutes is None:
        # The till's tablet (app/access.py): its session does not run out.
        if role == Role.store.value:
            expires_minutes = settings.store_token_expire_days * 24 * 60
        else:
            expires_minutes = settings.access_token_expire_minutes
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "org_id": org_id,
        "role": role,
        "scope": SCOPE_TENANT,
        "sv": int(session_epoch),
        "iat": now,
        "exp": now + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_platform_token(
    *,
    subject: str,
    expires_minutes: Optional[int] = None,
) -> str:
    """Token for a platform admin. Carries no org_id -- there is no tenant to
    carry, and its absence is a second reason the tenant path rejects it."""
    if expires_minutes is None:
        expires_minutes = settings.access_token_expire_minutes
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": subject,
        "scope": SCOPE_PLATFORM,
        "iat": now,
        "exp": now + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decode and validate a JWT. Raises jwt.PyJWTError on failure."""
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
    )
