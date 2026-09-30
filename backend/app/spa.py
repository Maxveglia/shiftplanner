from __future__ import annotations

"""Serving the built frontend from the API process.

One service, one origin. That is not just fewer moving parts to deploy: it
means the browser never makes a cross-origin request, so there is no CORS
policy standing between a working app and a broken one, and the frontend does
not have to be rebuilt when the API's hostname changes.

The routing rule is deliberately narrow. Anything the API owns is answered by
the API -- including a 404, so a mistyped endpoint returns JSON and not a page
of HTML that a fetch() would try to parse. Everything else is either a real
file from the build or, failing that, index.html, because the router that
knows what ``/employees/123`` means lives in the browser.
"""

import os
from pathlib import Path

from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse, Response
from starlette.staticfiles import StaticFiles

# Paths the API owns. A request under one of these is never answered with the
# app shell, whatever the outcome.
API_PREFIXES = ("/api", "/health", "/docs", "/redoc", "/openapi.json")


# How long a browser may keep what it was given, by kind.
#
# The app shell must be asked about EVERY time. It was served with no
# Cache-Control at all, and without one a browser is free to guess how long a
# page stays fresh -- Safari guessed long enough that a manager reloading after
# a deploy kept running yesterday's code, and was told a fix was live that
# their screen could not show. `no-cache` does not mean "never stored": it
# means "check first", and an unchanged page still comes back as a 304.
#
# Everything under assets/ carries a content hash in its name, so a new build
# is a new URL and the old file is never wrong. Those can be kept for a year.
SHELL_CACHE = "no-cache"
HASHED_CACHE = "public, max-age=31536000, immutable"


def _cache_control(path: str) -> str:
    return HASHED_CACHE if path.startswith("assets/") else SHELL_CACHE


class SinglePageApp(StaticFiles):
    """Static files, falling back to index.html for client-side routes."""

    async def get_response(self, path: str, scope) -> Response:
        response = await self._get_response(path, scope)
        if response.status_code < 400 and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = _cache_control(path)
        return response

    async def _get_response(self, path: str, scope) -> Response:
        # StaticFiles signals a missing file by RAISING 404, not by returning
        # one, so the fallback has to be reached through except -- checking
        # response.status_code alone silently never fires.
        try:
            response = await super().get_response(path, scope)
            if response.status_code != 404:
                return response
        except StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise

        # An unmatched API path is a genuine 404 and must stay machine-readable.
        # Handing back index.html here is how a typo'd endpoint turns into
        # "Unexpected token '<'" in the browser console instead of a clear 404.
        if scope.get("path", "").startswith(API_PREFIXES):
            return JSONResponse({"detail": "Not found"}, status_code=404)

        # The shell, under whatever route was asked for -- so it is cached as
        # the shell, never as the asset the path might look like.
        response = await super().get_response("index.html", scope)
        response.headers["Cache-Control"] = SHELL_CACHE
        return response


def mount_frontend(app: FastAPI, directory: str | None = None) -> bool:
    """Serve the built frontend at ``/``. Returns False when there is none.

    Mount this LAST: it claims ``/``, and Starlette matches routes in the order
    they were added, so every API route has to be registered before it.
    """
    root = Path(directory or os.environ.get("FRONTEND_DIST", "/app/static"))
    if not (root / "index.html").is_file():
        # Running API-only (local development, tests). Not an error.
        return False

    app.mount("/", SinglePageApp(directory=str(root), html=True), name="frontend")
    return True


__all__ = ["API_PREFIXES", "SinglePageApp", "mount_frontend"]
