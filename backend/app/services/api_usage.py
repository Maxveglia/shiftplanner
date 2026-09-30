"""Metering the paid model: what each organization's prompts cost us.

HOW IT IS WIRED. The three services that call Claude (``intake``,
``refine_intake``, ``calendar_plan``) know nothing about organizations or
databases, and they should not: they take text and a key and run in worker
threads. So the meter is a ledger the ROUTER opens around the call::

    with api_usage.collect() as ledger:
        brief = interpret_brief(...)
    api_usage.record(org_id, ledger)

and each service does one thing -- ``api_usage.note(purpose, response)``
right after the API answers. ``note`` appends to whatever ledger is open and
is a no-op when none is (tests, scripts, the contract test), so a service
never has to care whether it is being metered.

The ledger is a ``ContextVar``. Threads started by a ``ThreadPoolExecutor``
do NOT inherit context variables, so the services submit their work through
``contextvars.copy_context().run`` -- a call made from a bare ``pool.submit``
would be spent and never counted. If a purpose is missing from the table,
that is the first place to look.

WHAT THE LEDGER MISSES WITHOUT HELP. ``note`` runs after the SDK call
returns, and the SDK retries INSIDE that call. An attempt that generated
tokens and then timed out is billed and never noted. ``meter_attempts`` is a
client middleware that closes that hole -- see its docstring for why it is a
middleware and not a retry loop of our own.

WHY ITS OWN SESSION. ``record`` writes through a session of its own, not the
request's. A brief that fails on the third of three calls still cost two, and
the router answers that failure by raising -- which rolls the request session
back and would erase the meter with it. Money spent is spent whether or not
the manager got their calendar. For the same reason ``record`` never raises:
a metering failure is logged and the manager's request is unaffected.

TOKENS IN, MONEY OUT. Rows hold tokens; ``cost_usd`` turns them into dollars
with the price table below. Prices are per million tokens and per model,
straight from the provider's price list, and editing them here re-prices
history -- which is the right behaviour for "what would last month cost at
today's rates" and the wrong one for an invoice, which this is not.
"""
from __future__ import annotations

import contextvars
import logging
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Iterable, Iterator, List, Optional

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Spend:
    """One paid call, as the provider reported it.

    ``duration_ms`` is the one field the provider does NOT report: it is wall
    clock measured by the caller around the SDK call. ``None`` means nobody
    timed it, which is not the same as zero.
    """

    purpose: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    duration_ms: Optional[int] = None


@dataclass
class Ledger:
    request_id: uuid.UUID
    entries: List[Spend]


_ledger: contextvars.ContextVar[Optional[Ledger]] = contextvars.ContextVar(
    "api_usage_ledger", default=None
)


@contextmanager
def collect() -> Iterator[Ledger]:
    """Open a ledger for the calls made inside this block."""
    ledger = Ledger(request_id=uuid.uuid4(), entries=[])
    token = _ledger.set(ledger)
    try:
        yield ledger
    finally:
        _ledger.reset(token)


def note(purpose: str, model: str, usage, duration_ms: Optional[int] = None) -> None:
    """Add one call to the open ledger, if there is one.

    ``usage`` is the SDK's ``response.usage``; attributes are read with
    ``getattr`` because cache fields are absent on some responses and this
    must never be the line that breaks a working call. ``None`` is accepted
    and counts as zero tokens -- an attempt whose reply never arrived was
    still paid for, and ``meter_attempts`` below is the caller that needs to
    say so.

    ``duration_ms`` is LAST and optional on purpose: three services call this
    and they are edited by different people on different branches. A caller
    that does not time its call keeps working and writes NULL, which the
    column is nullable for.
    """
    ledger = _ledger.get()
    if ledger is None:
        return
    ledger.entries.append(
        Spend(
            purpose=purpose,
            model=model,
            input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
            output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            cache_creation_input_tokens=int(
                getattr(usage, "cache_creation_input_tokens", 0) or 0
            ),
            cache_read_input_tokens=int(
                getattr(usage, "cache_read_input_tokens", 0) or 0
            ),
            duration_ms=None if duration_ms is None else int(duration_ms),
        )
    )


# --- The attempts the retry loop throws away --------------------------------

# A purpose ending in this is NOT a successful call. See `meter_attempts`.
LOST_SUFFIX = ".lost"


def meter_attempts(purpose: str, model: str):
    """SDK middleware that counts the attempts nobody else can see.

    THE HOLE THIS FILLS. ``note`` runs after ``client.messages.parse`` returns,
    and the SDK's retries happen INSIDE that call. With ``MAX_RETRIES = 4`` and
    a 90s timeout, an intake call could spend four attempts, generate tokens on
    every one of them, time out on three, and write a single row. The provider
    bills each attempt; the back office saw one. Every cost figure it has shown
    since 0014 is a floor, not a total, and nothing on the screen said so.

    WHY MIDDLEWARE AND NOT A HAND-ROLLED RETRY LOOP. The obvious alternative --
    ``max_retries=0`` plus our own loop around the call, where each attempt is
    a place we can annotate -- was rejected. It would move backoff, jitter,
    ``retry-after`` and the "which errors are worth retrying" table out of the
    SDK and into three services that would then drift apart, to measure
    something the SDK already exposes: ``anthropic`` 1.3.0 runs its client
    middleware chain once per HTTP attempt, inside the retry loop
    (``_base_client.py``, the ``for retries_taken in range(max_retries + 1)``
    loop calls ``chain(request)``). So the hook exists; we were simply not
    using it. Retry behaviour is left exactly as it was, which is the point.

    WHAT IT CAN AND CANNOT RECOVER. A 2xx is never retried, so a successful
    attempt is left alone and the service's own ``note`` records it as before
    -- this never double-counts. Everything else is an attempt that was paid
    for and whose token counts are UNKNOWABLE here: a timeout means the body
    never arrived, and a 429/5xx body carries an error, not a usage block. So
    the row is written with zero tokens and the duration we did measure, under
    ``purpose + ".lost"``. That is deliberately an honest zero: it cannot price
    the waste, but it turns "the back office is quietly wrong" into a row you
    can count, next to the seconds it burned.
    """

    def _middleware(request, call_next):
        started = time.monotonic()
        try:
            response = call_next(request)
        except Exception:
            # No HTTP response at all: a timeout or a dropped connection. This
            # is the expensive case -- the model may have written a whole
            # answer we were billed for and never read.
            note(purpose + LOST_SUFFIX, model, None, _elapsed_ms(started))
            raise
        http = getattr(response, "http_response", None)
        if http is not None and not http.is_success:
            note(purpose + LOST_SUFFIX, model, None, _elapsed_ms(started))
        return response

    return _middleware


def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def record(org_id: uuid.UUID, ledger: Ledger) -> int:
    """Persist the ledger for this organization. Returns rows written.

    Uses its own tenant session (see the module docstring for why) and never
    raises: the request that spent the money must not fail because the
    meter could not be written.
    """
    if not ledger.entries:
        return 0
    from app.db import AppSessionLocal, set_current_org
    from app.models.api_usage import ApiUsage

    db = AppSessionLocal()
    try:
        set_current_org(db, org_id)
        for e in ledger.entries:
            db.add(
                ApiUsage(
                    org_id=org_id,
                    request_id=ledger.request_id,
                    purpose=e.purpose,
                    model=e.model,
                    input_tokens=e.input_tokens,
                    output_tokens=e.output_tokens,
                    cache_creation_input_tokens=e.cache_creation_input_tokens,
                    cache_read_input_tokens=e.cache_read_input_tokens,
                    duration_ms=e.duration_ms,
                )
            )
        db.commit()
        return len(ledger.entries)
    except Exception:  # noqa: BLE001 - metering must never break the request
        db.rollback()
        log.exception("api_usage: could not record %d calls for org %s",
                      len(ledger.entries), org_id)
        return 0
    finally:
        db.close()


# --- Pricing ----------------------------------------------------------------

# USD per million tokens: (input, output). Cache writes are billed at 1.25x
# input and cache reads at 0.1x input, the provider's standard multipliers.
# A model missing from this table is priced as zero and logged once, which is
# visible in the back office as a customer who costs nothing -- better than a
# guess that looks like a measurement.
PRICES_PER_MTOK = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
    # Output is free: the answer is a probability, not text. The same model
    # under the names OpenRouter gives it, for when `jev_base_url` points
    # there -- priced as zero, it would look like a free customer.
    "jev-latest": (0.042, 0.0),
    "~typesafe/jev-latest": (0.042, 0.0),
    "typesafe/jev-1.13": (0.042, 0.0),
}
CACHE_WRITE_FACTOR = 1.25
CACHE_READ_FACTOR = 0.10

_unpriced: set = set()


def cost_usd(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_creation_input_tokens: int = 0,
    cache_read_input_tokens: int = 0,
) -> float:
    prices = PRICES_PER_MTOK.get(model)
    if prices is None:
        if model not in _unpriced:
            _unpriced.add(model)
            log.warning("api_usage: no price for model %s; costing it as 0", model)
        return 0.0
    inp, out = prices
    return (
        input_tokens * inp
        + output_tokens * out
        + cache_creation_input_tokens * inp * CACHE_WRITE_FACTOR
        + cache_read_input_tokens * inp * CACHE_READ_FACTOR
    ) / 1_000_000


def total_usd(rows: Iterable) -> float:
    """Sum the cost of ``ApiUsage`` rows (or anything with the same fields)."""
    return sum(
        cost_usd(
            r.model,
            r.input_tokens,
            r.output_tokens,
            r.cache_creation_input_tokens,
            r.cache_read_input_tokens,
        )
        for r in rows
    )


def spent_usd_this_month(db, org_id: uuid.UUID) -> float:
    """What this organisation has spent on the model in the last 30 days.

    Read BEFORE the money is spent rather than after, which is the difference
    between a budget and a receipt. Until now the only guard on spend in the
    whole product was "no more than twelve months per request": nothing stopped
    a manager holding down Reorganise, and every press is one call per month of
    the horizon. The provider's own monthly ceiling is the backstop, and when
    that one was reached on 7-sep-2026 it took production down with it -- the
    same key serves the app and CI, so running out looked like a red build and
    a dead intake at once.

    Thirty days rather than a calendar month: a limit that resets on the first
    is a limit somebody discovers on the 28th.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.models.api_usage import ApiUsage

    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = db.execute(
        select(ApiUsage).where(
            ApiUsage.org_id == org_id, ApiUsage.created_at >= since
        )
    ).scalars()
    return total_usd(rows)
