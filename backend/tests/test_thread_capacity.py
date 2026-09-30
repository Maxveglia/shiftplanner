from __future__ import annotations

"""Room for the requests that hold a thread for minutes.

Generating a calendar is a plain ``def`` endpoint, so it occupies one of
anyio's worker threads for as long as the model is writing -- minutes. The
pool is 40 threads for the WHOLE application by default, and the failure that
causes is not a slow calendar: it is login timing out for everybody else while
a handful of managers generate. The ceiling is raised in main.py's lifespan.

The test exists because that raise is one line in a startup hook, which is
exactly the kind of thing a later refactor drops without anything going red.
"""

import anyio
import anyio.to_thread

from app.config import settings
from app.main import app, lifespan


def test_the_thread_ceiling_is_raised_at_startup():
    seen = {}

    async def run():
        seen["before"] = anyio.to_thread.current_default_thread_limiter().total_tokens
        async with lifespan(app):
            seen["during"] = (
                anyio.to_thread.current_default_thread_limiter().total_tokens
            )

    anyio.run(run)

    assert seen["during"] == settings.request_thread_limit
    assert seen["during"] > seen["before"], (
        "the ceiling is only worth a startup hook while it is above anyio's "
        "default; if the default catches up, delete the hook rather than keep "
        "a line that does nothing"
    )


def test_the_ceiling_leaves_room_for_a_year_being_generated():
    """Eight months are written at once (MAX_CONCURRENT_MONTHS), each on its
    own thread, plus the request thread holding them. The point of the ceiling
    is that several managers can do that and still leave threads for the rest
    of the application."""
    from app.services.calendar_plan import MAX_CONCURRENT_MONTHS

    assert settings.request_thread_limit >= (MAX_CONCURRENT_MONTHS + 1) * 4
