from __future__ import annotations

"""How many times a password may be guessed, and how that is remembered.

THE PROBLEM. ``/auth/login`` and ``/backoffice/login`` verified a password and
said yes or no, as fast as the network could ask. Nothing counted. A list of
leaked passwords could be tried against a manager's email at whatever rate a
laptop manages, and the operator's login -- the one account that reads and
deletes every customer on the platform -- was the same door with a bigger room
behind it. bcrypt makes each guess cost milliseconds rather than nanoseconds,
which buys time against an offline attack on a stolen hash and buys nothing at
all against somebody typing at the front door.

THE POLICY. Five failures inside fifteen minutes and the door shuts. It reopens
after a minute; the sixth failure shuts it for two, the seventh for four, then
eight, then fifteen, which is the ceiling. Exponential because the shape of the
two things we are telling apart is different: a person who cannot remember
which of their passwords it was tries three or four times and stops, so they
meet a minute at worst, while a machine working through a list is left with one
guess per lock and the lock doubling under it. A flat lockout has to choose
between being useless against the machine and being cruel to the person; this
one does not.

Knocking WHILE the door is shut is refused and not written down. That is not
leniency -- the attempt is spent either way -- it is what keeps a flood from
turning into a flood of INSERTs, and it is why the failure count only ever
advances by a guess that was actually allowed through.

WHAT IS COUNTED, AND WHY IT IS MOSTLY THE EMAIL. ``docker-entrypoint.sh`` runs
uvicorn with ``--forwarded-allow-ips='*'``, which means uvicorn believes the
``X-Forwarded-For`` of whoever is talking to it. Behind Railway's proxy that is
the right setting and it is also the whole story: the header arrives from the
internet and anybody may write anything in it, so a client IP here is a claim,
not a fact. Counting by IP alone would therefore stop nobody -- rotate the
header, get a fresh budget -- while a shared office NAT would lock out a whole
restaurant for one forgetful waiter.

So the barrier is the EMAIL, which is the one thing an attacker going after a
particular account cannot vary: that is what "going after that account" means.

The IP decides NOTHING. It is written down next to the attempt so a person can
look, and that is the end of its authority. An earlier version of this file
counted it too, with a looser threshold, and said in this very paragraph that
it could never shut a door on its own -- it could. Thirty failures with made-up
addresses and a chosen ``X-Forwarded-For`` locked out the real owner of that
address, correct password and all: a denial of service anybody could aim at a
restaurant's router from anywhere, handed to them by the defence. And it bought
nothing, because the attacker it was meant to slow down is the one who can
rewrite the header between requests. A value the sender chooses cannot be the
reason somebody else is refused.

THE COST OF THE POLICY, said out loud: anyone who knows your email address can
lock you out of it for fifteen minutes. That is inherent in counting by the
thing the attacker cannot vary, it is what every login that counts anything
does, and it is a far smaller problem than an account guessed at leisure. It is
also why nothing here is permanent: the longest lock is fifteen minutes and the
table forgets by itself.

TWO LAYERS, AND WHICH ONE IS THE BARRIER.

1. **Postgres** is the source of truth. It has to be: this service redeploys
   several times a day and a counter in a process is reset by every one of
   them, which turns "five guesses per fifteen minutes" into "five guesses per
   deploy". It also has to be if Railway ever runs a second replica, because
   two processes each counting to five is ten.

2. **A dictionary in this process**, in front of it, remembering only verdicts
   Postgres has already given: "this key is shut until 12:40". While somebody
   is hammering -- which is exactly when the request rate is highest and the
   answer is always the same -- the refusal costs no query at all.

The cache may be wrong in exactly one direction and it is the safe one. It can
only hold a shut door shut, never open one: a key it has never heard of, or
whose deadline has passed, falls through to Postgres and is decided there. So
dropping it entirely is always correct -- a restart does it, and `drop_cache`
does it on purpose -- and it can never be the reason somebody gets in. The one
thing it costs is that a successful login on another replica does not reach
this one's memory, so a lock can outlive its rows by up to its own deadline.
That is a stale refusal of at most fifteen minutes, which is the policy anyway.
"""

import hashlib
import threading
from datetime import datetime, timedelta, timezone
from math import ceil
from typing import Dict, NamedTuple, Optional, Tuple

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.errors import detail
from app.models.login_attempt import LoginAttempt

# The two front doors. A manager and the platform operator may share an email
# address and they are not the same account, so they do not share a counter.
TENANT = "tenant"
PLATFORM = "platform"

#: How far back a failure still counts. Also how long a row lives.
WINDOW = timedelta(minutes=15)

#: Failures inside the window before the door shuts on an email.
MAX_FAILURES = 5

#: The first lock, and the ceiling it doubles towards.
LOCK_BASE = timedelta(minutes=1)
LOCK_MAX = timedelta(minutes=15)

#: Emails have a maximum length and IPv6 addresses have one; neither is the
#: length of whatever JSON arrives. Truncating here keeps a megabyte of
#: "email" out of an index.
_MAX_IDENTIFIER = 254
_MAX_IP = 45

#: Cached verdicts, keyed by (scope, kind, value). Bounded below.
_LOCKS: Dict[Tuple[str, str, str], datetime] = {}
_CACHE_LOCK = threading.Lock()

#: When to bother pruning. Entries expire on their own within LOCK_MAX, so this
#: only matters while someone is spraying addresses faster than they age out.
_CACHE_MAX = 10_000


def _now() -> datetime:
    """The clock, in one place so a test can move it.

    Every deadline in here is an absolute instant compared against this, so
    moving it forward is the same thing to both layers as fifteen minutes
    passing -- which is the only way to test a window without sleeping through
    one.
    """
    return datetime.now(timezone.utc)


class Attempt(NamedTuple):
    """Who is knocking: which door, under what name, from roughly where."""

    scope: str
    identifier: str
    ip: str


def attempt(request: Request, scope: str, email: str) -> Attempt:
    """Read the knock off the request.

    The email is lowercased and trimmed because "Ana@x.com" and "ana@x.com"
    are one account here (``UserAccount.email`` is unique and the app writes
    what it is given), and counting them apart would be a bypass you could type
    with the shift key.
    """
    return Attempt(
        scope=scope,
        identifier=(email or "").strip().lower()[:_MAX_IDENTIFIER],
        ip=_client_ip(request),
    )


def _client_ip(request: Request) -> str:
    """The client address, read the same way uvicorn reads it in production.

    In production ``--forwarded-allow-ips='*'`` means uvicorn has already
    replaced ``request.client`` with the first hop of ``X-Forwarded-For``, so
    reading the header here changes nothing there -- and it makes the value
    visible to a test, which otherwise only ever sees "testclient".

    Either way this is a claim the sender made about itself. See the module
    docstring for what it is therefore allowed to decide.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first[:_MAX_IP]
    client = request.client
    return (client.host if client else "unknown")[:_MAX_IP]


# --- The policy -------------------------------------------------------------


def _locked_until(
    failures: int, last: Optional[datetime], threshold: int
) -> Optional[datetime]:
    """When the door reopens, or None if it was never shut.

    Measured from the most recent failure rather than from the first, so the
    wait starts when the guessing stopped. Counted from the first, a burst of
    five would already be half-expired by the time it was noticed, and the
    doubling would be measured against an instant that keeps sliding out of the
    window -- the wait would shrink as the attack went on.
    """
    if last is None or failures < threshold:
        return None
    if last.tzinfo is None:  # a fixture, or a driver that forgot; never psycopg
        last = last.replace(tzinfo=timezone.utc)
    # Capped before the shift, not after: 2 ** (a few thousand failures) is an
    # integer nobody wants to build on the way to taking the minimum of it.
    over = min(failures - threshold, 20)
    seconds = min(LOCK_BASE.total_seconds() * (2**over), LOCK_MAX.total_seconds())
    return last + timedelta(seconds=seconds)


def _too_many(until: datetime, now: datetime) -> HTTPException:
    """The refusal. It says nothing about the account, because it knows nothing.

    This is raised before anybody has been looked up, so a real email and an
    invented one produce the same status, the same code and the same wait.
    ``Retry-After`` is the standard way to say when, and ``minutes`` is the
    same figure rounded for the sentence the browser writes.
    """
    seconds = max(1, int(ceil((until - now).total_seconds())))
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail(
            "too_many_attempts",
            "Too many failed sign-in attempts; try again in %d seconds" % seconds,
            minutes=max(1, int(ceil(seconds / 60))),
        ),
        headers={"Retry-After": str(seconds)},
    )


# --- The cache --------------------------------------------------------------


def _cached(key: Tuple[str, str, str], now: datetime) -> Optional[datetime]:
    with _CACHE_LOCK:
        until = _LOCKS.get(key)
        if until is None:
            return None
        if until <= now:
            # Expired, so it is no longer an answer. Postgres decides again.
            _LOCKS.pop(key, None)
            return None
        return until


def _remember(key: Tuple[str, str, str], until: Optional[datetime]) -> None:
    with _CACHE_LOCK:
        if until is None:
            _LOCKS.pop(key, None)
            return
        _LOCKS[key] = until
        if len(_LOCKS) > _CACHE_MAX:
            # Spraying invented addresses would otherwise grow this without
            # end. Expired entries first; if that is not enough, take the whole
            # thing -- forgetting a lock costs one query and can never let
            # anybody in, which is the property that makes this safe to do
            # bluntly.
            stale = [k for k, v in _LOCKS.items() if v <= _now()]
            for k in stale:
                _LOCKS.pop(k, None)
            if len(_LOCKS) > _CACHE_MAX:
                _LOCKS.clear()


def drop_cache() -> None:
    """Forget every cached verdict, as a restart does.

    Public because it is safe by construction -- see the module docstring --
    and because the tests use it to prove the point: with the cache empty, the
    door is still shut, which means Postgres is the one holding it.
    """
    with _CACHE_LOCK:
        _LOCKS.clear()


# --- The two things a login does -------------------------------------------


#: (attempts on this email inside the window, the most recent one)
_Counts = Tuple[int, Optional[datetime]]


def _counts(db: Session, att: Attempt, now: datetime) -> _Counts:
    """How many times this email has knocked inside the window, and when last."""
    row = db.execute(
        select(func.count(), func.max(LoginAttempt.created_at))
        .select_from(LoginAttempt)
        .where(
            LoginAttempt.scope == att.scope,
            LoginAttempt.identifier == att.identifier,
            LoginAttempt.created_at >= now - WINDOW,
        )
    ).one()
    return int(row[0]), row[1]


def _lock_key(att: Attempt) -> int:
    """A stable 64-bit key for Postgres' advisory lock, from scope and email.

    blake2b rather than ``hash()``: the point is that every process and every
    replica derive the SAME number for the same email, and Python's hash is
    salted per interpreter.
    """
    digest = hashlib.blake2b(
        ("%s:%s" % (att.scope, att.identifier)).encode("utf-8"), digest_size=8
    ).digest()
    return int.from_bytes(digest, "big", signed=True)


def reserve(db: Session, att: Attempt) -> None:
    """Count this attempt BEFORE the password is looked at, under a lock.

    THE ORDER IS THE WHOLE FIX. This used to read the counter, hand back to the
    route to check a password, and only write the failure afterwards. Between
    the reading and the writing there was nothing holding the place, so
    requests sent AT THE SAME TIME all read the same zero and all went through:
    measured with twenty-four concurrent knocks against one email, fifteen
    passwords were evaluated where the policy says five. An attacker does not
    send one guess at a time, and the multiplier is the server's own
    concurrency.

    So the attempt is recorded here, for every knock rather than every failure,
    and what the route does afterwards cannot change the count. A password that
    works wipes the slate a moment later in ``clear``, which is what keeps this
    from being a counter of ordinary logins.

    The advisory lock is what makes the pair atomic: it is held by this
    transaction until it commits, so two knocks at one email are serialised and
    the second one sees the first. It is keyed by scope and email, so it never
    makes two different people wait for each other.

    A door already shut is refused WITHOUT writing anything. That is deliberate
    and it is the difference between a lock that ends and one that somebody
    else can extend forever: the wait is measured from the last attempt that
    counted, so if hammering kept counting, anyone who knows your address could
    hold you out of your own account for as long as they cared to keep typing.

    Called FIRST in both login routes, ahead of the account lookup: a 429 from
    here cannot have been influenced by whether the email exists, so it cannot
    report it.
    """
    now = _now()
    key = (att.scope, "email", att.identifier)

    cached = _cached(key, now)
    if cached is not None:
        raise _too_many(cached, now)

    db.execute(select(func.pg_advisory_xact_lock(_lock_key(att))))

    # Pruning on write, so the table is a sliding window and not a log. It
    # costs one indexed delete of rows nobody can count any more, and it means
    # a quiet month leaves nothing behind.
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < now - WINDOW))

    before, last = _counts(db, att, now)
    until = _locked_until(before, last, MAX_FAILURES)
    if until is not None and until > now:
        # Commit the prune and let go of the lock; nothing else is pending.
        db.commit()
        _remember(key, until)
        raise _too_many(until, now)

    # Stamped from `_now()` rather than the column default, so that one clock
    # both writes these rows and reads them back.
    db.add(
        LoginAttempt(
            scope=att.scope, identifier=att.identifier, ip=att.ip, created_at=now
        )
    )

    # THE COMMIT IS NOT OPTIONAL. ``get_admin_db`` rolls its session back when a
    # request leaves by way of an exception, and the next thing this login does
    # may well be to raise one -- so an attempt left pending is an attempt that
    # never happened, and the counter would sit at zero forever. Committing is
    # safe because the failure path of both logins has nothing else in flight.
    # It also releases the advisory lock.
    db.commit()

    # Cache what the NEXT knock will meet, so the likely one -- if this is a
    # machine -- is refused without a query.
    _remember(key, _locked_until(before + 1, now, MAX_FAILURES))


def clear(db: Session, att: Attempt) -> None:
    """A password that worked wipes the slate for that email.

    Not for the IP: whoever just signed in correctly has said nothing about the
    two hundred other addresses tried from the same place, and letting one good
    login reset the spray counter would be a bypass with a free password in it.

    The delete rides on the request's own transaction -- this one is on the
    success path, where ``get_admin_db`` commits on the way out.
    """
    db.execute(
        delete(LoginAttempt).where(
            LoginAttempt.scope == att.scope,
            LoginAttempt.identifier == att.identifier,
        )
    )
    _remember((att.scope, "email", att.identifier), None)
