from __future__ import annotations

"""The clock the business runs on.

Every figure an employee reads -- the day a shift falls on, the hour it starts,
the month a rota belongs to -- is a WALL CLOCK reading, and a wall clock only
means something in a place. The database stores instants, which is right, and
the browser renders them in whatever zone the phone happens to be in, which is
right for the person holding it. It is wrong for everything the SERVER writes:
an email, a PDF, a push notification. Those are composed once, in one place,
for everybody, and nobody's browser is there to interpret them -- so they need
a zone of their own, and this is it.

ONE MARKET, ONE ZONE, said out loud rather than assumed. This product sells to
bars, restaurants and shops in Barcelona (see `0018_barcelona_only`), so the
zone is Madrid's and it is a constant rather than a column on `organization`.
That is a deliberate shortcut, not a belief about the world: the day a customer
keeps time anywhere else, this becomes a column and every caller below keeps
working unchanged, because they already ask this module instead of assuming.

WHY NOT UTC, which is what the container runs in. A shift that starts at 21:00
in Barcelona on a June evening is 19:00Z. A rota composed in UTC would tell the
team the wrong hour all summer and, for a night shift in winter, the wrong DAY:
23:30 on the 5th is 22:30Z on the 5th, but 00:30 on the 6th is 23:30Z on the
5th, and a reader in UTC would file them on the same day.

WHY NOT the publishing browser's zone, which is what the rest of the product
uses today. Because it is not a property of the business, it is a property of
whoever happened to press the button -- and this product is already operated
from another continent.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

#: The zone every server-composed reading of a shift is expressed in.
BUSINESS_ZONE = ZoneInfo("Europe/Madrid")


def to_business_time(instant: datetime) -> datetime:
    """An instant, as the wall clock of the business reads it."""
    return instant.astimezone(BUSINESS_ZONE)


def business_day(instant: datetime) -> date:
    """The calendar day an instant falls on, for the business.

    The day a shift STARTS on, which is the day the person working it calls it:
    a shift from 22:00 to 06:00 is Friday's shift and not Saturday's, and
    saying otherwise would file every closing shift under the wrong heading.
    """
    return to_business_time(instant).date()
