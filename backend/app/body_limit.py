"""A ceiling on how much body a request may carry.

THE PROBLEM. There was no ceiling anywhere. uvicorn does not impose one,
Starlette does not impose one, and FastAPI reads whatever arrives into memory
before a single validator runs -- so every `max_length` in ``app/schemas`` is
checked on a string the process has already allocated. A gigabyte of JSON is
refused by the schema layer AFTER it has been held in RAM, which is the wrong
order for the only failure that matters here.

So this sits in front of all of it and refuses by the numbers on the envelope.

TWO PATHS, because there are two ways to send a body and only one of them
announces its size:

  * ``Content-Length`` is the ordinary case and it is free -- a header is read
    and the request is refused before a byte of body is touched.
  * ``Transfer-Encoding: chunked`` announces nothing, so the bytes are counted
    as they are read and the request is cut off the moment the count passes
    the limit. Trusting the header alone would leave a hole the shape of one
    curl flag.

WHY IT ANSWERS IN THE ERROR SHAPE. 413 is a wall a person can hit by accident
-- a month of a large roster, a pasted document -- so it has to say something
readable in their language, which in this product means a code the browser
looks up (see ``app/errors.py``). ``request_too_large`` has a sentence in both
dictionaries.

WHERE IT SITS IN THE STACK. Inside CORSMiddleware, so the 413 goes out through
it and carries the CORS headers a browser needs in order to READ the code
rather than report a network error. Starlette makes the last-added middleware
the outermost, so this one is added first in ``main.py``.
"""
from __future__ import annotations

import json

from starlette.datastructures import Headers
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import detail

# One megabyte, and generous for it: the largest thing a manager can type is a
# brief (8,000 characters) beside a month of draft as context (40,000), which
# is some 50 KB with the JSON around it. Twenty times that.
MAX_BODY_BYTES = 1024 * 1024

# Except where a month of shifts is the body. One shift is about 290 bytes of
# JSON (two timestamps, two UUIDs, a cost), and ``PublishIn.shifts`` is capped
# at 5,000 of them -- 50 people x 31 days x 3 shifts -- which is 1.4 MB. A 1 MB
# envelope would stop at roughly 3,600 shifts, so the ceiling above would be
# the one that decides, quietly, and the list cap next door would be a number
# that can never be reached. Worse, it would land on a real business: a
# 50-person site running split shifts publishes some 3,100 shifts in a month.
#
# So these two get an envelope with room over their own list cap, and the list
# cap stays the thing that says no.
MAX_SHIFT_BODY_BYTES = 4 * 1024 * 1024
SHIFT_PATHS = ("/api/v1/schedule/publish", "/api/v1/schedule/draft")


class _BodyTooLarge(Exception):
    """Raised out of ``receive`` to unwind an application mid-read.

    Private, and it never leaves this module: the middleware catches its own
    exception and answers. Nothing downstream registers a handler for it, which
    is the point -- Starlette re-raises what it has no handler for, so it comes
    back here rather than becoming somebody else's 500.
    """


def _refusal(limit: int) -> bytes:
    return json.dumps(
        {
            "detail": detail(
                "request_too_large",
                "Request body exceeds the %d byte limit" % limit,
                limit=limit,
            )
        }
    ).encode("utf-8")


class BodySizeLimitMiddleware:
    """Pure ASGI, not ``BaseHTTPMiddleware``, and deliberately.

    ``BaseHTTPMiddleware`` hands the endpoint a ``Request`` whose stream it has
    already taken over; counting bytes there means buffering them first, which
    is exactly the thing being prevented. At this level the ``receive``
    callable can be wrapped and the count kept as the server hands chunks over.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    def _limit_for(self, path: str) -> int:
        return MAX_SHIFT_BODY_BYTES if path in SHIFT_PATHS else self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = self._limit_for(scope.get("path", ""))

        # The cheap half: believe the envelope when it declares a size. A
        # client that lies low is caught by the counter below anyway, so there
        # is nothing to lose by reading the header first.
        declared = Headers(scope=scope).get("content-length")
        if declared is not None:
            try:
                if int(declared) > limit:
                    await self._refuse(send, limit)
                    return
            except ValueError:
                # A malformed Content-Length is not ours to interpret. Let the
                # server decide what it is, and keep counting meanwhile.
                pass

        seen = 0
        started = False

        async def counted_receive() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _BodyTooLarge()
            return message

        async def watched_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, counted_receive, watched_send)
        except _BodyTooLarge:
            if started:
                # The application was already answering when the body ran over
                # -- a streaming response reading its input as it writes. Two
                # response starts on one connection is worse than no refusal,
                # so let it go and have the server end the connection.
                raise
            await self._refuse(send, limit)

    async def _refuse(self, send: Send, limit: int) -> None:
        body = _refusal(limit)
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("latin-1")),
                    # Nothing about this answer depends on who asked, but a
                    # cache holding it for a URL that normally works would be a
                    # small disaster of its own.
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


__all__ = ["BodySizeLimitMiddleware", "MAX_BODY_BYTES", "MAX_SHIFT_BODY_BYTES"]
