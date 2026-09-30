"""The instructions a browser needs in order to defend this app by itself.

THE PROBLEM. None of them were being sent. Not one. A response left this
process carrying its body, its content type and nothing else -- so every
protection a browser is willing to apply for free was simply never asked for,
and the only thing standing between a customer's rota and a stolen session was
the application code being right every time.

That last part is not a theory here. The access token lives in
``localStorage`` (``frontend/src/auth/AuthContext.tsx``), which means one
successful injection anywhere in the app reads it and keeps it. There is no
HttpOnly cookie to hide behind. So the header that matters most in this file
is the Content-Security-Policy, and the reason it is introduced carefully
rather than confidently is further down.

WHAT GOES WHERE, and why the distinction is the whole design. This process
answers two completely different kinds of request from one port
(``app/spa.py``): JSON for the API, and the built frontend -- a document, a
JavaScript bundle, a stylesheet. Most of these headers only mean something to
a DOCUMENT. A Content-Security-Policy on a JSON body governs nothing, because
nothing is ever loaded from it; an ``X-Frame-Options`` on a stylesheet
protects a framing that cannot happen. Sending them anyway is worse than not
sending them: an audit that greps for header names comes back green and the
question stops being asked.

So the split below is by CONTENT TYPE, not by path. ``text/html`` is the
honest signal for "a browser is about to build a page out of this", and it
stays right if a route is added, moved or renamed. The one response that has
no content type to be judged by is the 304, which turns out to matter a great
deal here -- see ``_is_document``.

  Every response          X-Content-Type-Options, Referrer-Policy, and
                          Strict-Transport-Security when the request arrived
                          over TLS.
  Documents only          Content-Security-Policy, X-Frame-Options,
                          Cross-Origin-Opener-Policy, Permissions-Policy.

WHAT IS DELIBERATELY NOT HERE.

  * ``X-XSS-Protection``. Obsolete. Chrome removed the auditor it controlled,
    Firefox never had one, and ``1; mode=block`` was itself the cause of
    cross-site leaks. Sending it is a line in a report and nothing in a
    browser.
  * ``includeSubDomains`` and ``preload`` on HSTS. See below -- they are
    promises about hostnames this process does not serve.
  * ``Cross-Origin-Embedder-Policy``. It buys cross-origin isolation, which
    this app has no use for (no SharedArrayBuffer, no precise timers), and it
    would refuse the Google Fonts stylesheet on the way in. A header that
    breaks the typeface to enable a feature nobody uses.
  * ``Cross-Origin-Resource-Policy``. Every API answer here already requires
    an ``Authorization`` header, which a cross-origin page cannot attach, so
    there is nothing readable for it to protect. The one exception, the
    photos of the menu's dishes and the stock's products (served to an <img>,
    which sends no token), sets it on its own answer: see
    ``app/photo_http.py``.
  * ``Cache-Control``. It belongs to ``app/spa.py``, which reasons about it at
    length, and every header below is added with ``setdefault`` so that
    nothing written closer to the response is ever overwritten from out here.
"""
from __future__ import annotations

from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import settings

# Do not guess at a content type. The one place it genuinely bit this product
# is the mistyped API path that used to answer with index.html -- see spa.py --
# and sniffing is the browser-side version of that mistake.
NOSNIFF = "nosniff"

# The URLs in this app name the thing being looked at: /employees/<uuid>,
# /backoffice/customers/<uuid>. A full Referer to an external site hands that
# over. `strict-origin-when-cross-origin` keeps the whole path for our own
# navigations, sends only the origin to another site, and sends nothing at all
# when leaving HTTPS for HTTP. It is what modern browsers already default to;
# it is here for the ones that do not, and because a default is not a promise.
REFERRER_POLICY = "strict-origin-when-cross-origin"

# One year, THIS HOST, and nothing else.
#
# The year is the easy part: the deployment terminates TLS at Railway and has
# never been reachable over plain HTTP, so there is no scenario in which this
# hostname needs to serve http:// again.
#
# `includeSubDomains` is the part that is left out on purpose. It is a promise
# made on behalf of every hostname under the domain -- including ones this
# process does not serve, has never seen, and cannot check: a marketing page, a
# status page, a staging box somebody put on http:// for an afternoon. And it
# is not a promise that can be taken back in a hurry: the only remedy is
# waiting out `max-age` in every browser that heard it. `preload` is the same
# mistake made permanent, since removal from the browsers' baked-in list takes
# release cycles, not a deploy.
#
# If the domain is ever known to be HTTPS-only all the way down, add
# `includeSubDomains` first, live with it for a few months, and only then
# consider preloading. In that order, not the other one.
HSTS = "max-age=31536000"

# Clickjacking, for the browsers that do not read `frame-ancestors`, AND for
# the months before the CSP below is enforced -- a Report-Only policy reports
# framing, it does not prevent it. That is the real reason this header is not
# redundant here: today it is the only thing that actually says no.
FRAME_OPTIONS = "DENY"

# Nothing in this app opens a window and nothing opens it as one (no OAuth
# popup, no payment window), so severing the opener relationship costs
# nothing and removes a handle a hostile page could otherwise keep.
OPENER_POLICY = "same-origin"

# Three features, not thirty: the three whose prompt a person might plausibly
# accept if injected code asked. Enumerating every feature the app happens not
# to use is how this header turns into decoration -- a long string that proves
# nothing was thought about.
#
# The CAMERA is used, and only by this origin: the inventory reads barcodes
# with the phone's camera when a delivery is taken in
# (frontend/src/components/inventory/CameraScanner.tsx). `(self)` lets our own
# document ask for it -- the browser still shows its prompt, and the person
# still decides -- and refuses it to any frame from anywhere else, which is
# what `*` would have allowed. With `()`, as it was, getUserMedia fails before
# a prompt is ever shown, on every phone.
#
# There is still no microphone and no geolocation anywhere in the frontend,
# so those two stay shut. The scanner asks for video alone.
PERMISSIONS_POLICY = "camera=(self), microphone=(), geolocation=()"

# --- The policy ------------------------------------------------------------
#
# Split in two, because the two halves carry completely different risk.
#
# BASELINE is the half that cannot break a page that already works. There is
# no <base> element in this build, no <object> or <embed>, no iframe, and no
# form that posts anywhere but here -- so these four directives forbid only
# things that do not happen, and they close real holes: base-tag injection
# (which repoints every relative URL in the document, including the bundle),
# plugin content, framing, and a form whose action has been rewritten to
# somebody else's collector. This half is ENFORCED from the first deploy.
BASELINE_CSP = "; ".join(
    (
        "base-uri 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    )
)

# RESOURCES is the half that decides what may load and where it may talk, and
# it is the half that can take a customer's Monday away if one line of it is
# wrong. Every entry below was read out of the actual build, not guessed:
#
#   script-src 'self' 'wasm-unsafe-eval'
#       `vite build` emits one module script with a hashed name and no inline
#       script at all -- checked in dist/index.html. Nothing in the source
#       calls eval() or new Function(), and neither does any dependency's
#       production bundle. No 'unsafe-inline', no 'unsafe-eval'.
#
#       'wasm-unsafe-eval' is the one addition, and it is narrower than its
#       name. It lets a page COMPILE WebAssembly -- which a CSP otherwise
#       treats as eval -- and nothing else: eval() and new Function() stay
#       refused, and the wasm still has to be fetched from somewhere the rest
#       of this policy allows. It is needed by the barcode reader on phones
#       whose browser has no BarcodeDetector of its own (every iPhone): the
#       fallback decoder is ZXing compiled to WebAssembly.
#
#   style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
#       Two concessions, both forced by code that exists. `'unsafe-inline'`
#       covers the 34 `style={{ ... }}` attributes React writes onto elements
#       -- widths in percent, animation delays, the colour of a bar in the
#       payroll view -- which are style ATTRIBUTES and are refused without it.
#       It is the weakest line here and it is worth being plain about: it
#       cannot be tightened with a nonce, only by moving those values into
#       classes. The Google Fonts host is there because src/index.css opens
#       with an @import of it.
#
#   font-src 'self' https://fonts.gstatic.com
#       Where that imported stylesheet then fetches Figtree from.
#
#   img-src 'self' data:
#       Only the favicon today. `data:` is allowed because the bundler inlines
#       small assets as data URIs on its own, and an image that silently fails
#       to render is the kind of breakage nobody reports.
#
#   connect-src 'self'
#       The production image builds the frontend with an empty
#       VITE_API_BASE_URL (see Dockerfile), so every request the app makes is
#       a relative path back here. Nothing else is called from the browser:
#       the model providers and the mailer are reached from this process.
#       That includes the barcode reader's .wasm, which is fetched (so it is
#       connect-src) and has to be served from here too: the library's own
#       default is to download it from a public CDN, which this refuses.
RESOURCE_CSP = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
    )
)

FULL_CSP = BASELINE_CSP + "; " + RESOURCE_CSP


def _is_document(content_type: str | None, asked_for_html: bool) -> bool:
    """Is a browser about to build a page out of this response?

    Normally the content type answers it. The exception is the 304, and it is
    not a detail -- it is the one that was found by running this rather than
    reading it.

    Starlette's not-modified response carries only the validators, so it has
    no content type at all. And a 304 does not replace the headers a browser
    stored for that URL: it UPDATES them, leaving anything it does not mention
    exactly as it was. A shell served `no-cache` is asked about on every load
    and answered with 304 nearly every time (see app/spa.py) -- so a 304 with
    no policy on it means the browser keeps the policy it was given the first
    time, possibly months ago, possibly the one that is currently breaking the
    page. Flipping CSP_ENFORCED back off would not reach it. A container
    restart does not necessarily help either: the files come out of the image
    with the mtime they were built with, so the ETag is the same one and the
    answer is the same 304.

    So a 304 falls back to what the REQUEST asked for. A browser navigating to
    a page sends `Accept: text/html,...`; the conditional request for a
    stylesheet or a bundle does not, and neither does an XHR. It is a weaker
    signal than a content type and it is used only where there is no content
    type to have.
    """
    if content_type is not None:
        return content_type.split(";", 1)[0].strip() == "text/html"
    return asked_for_html


class SecurityHeadersMiddleware:
    """Pure ASGI, like the body limit next door, and for a smaller reason.

    ``BaseHTTPMiddleware`` would work, but it wraps every response in a
    streaming one on the way back -- and the responses that matter most here
    come out of ``StaticFiles``, which has spent effort on ranges, ETags and
    sendfile. At this level the only thing touched is the header list on the
    ``http.response.start`` message, before it is handed on. Nothing is
    buffered, nothing is re-encoded, and a 304 stays a 304.

    WHERE IT SITS IN THE STACK. OUTERMOST, so it is added LAST in ``main.py``
    -- Starlette makes the last-added middleware the outer one. Outside CORS
    and outside the body limit, which is the only position from which the
    headers also reach the answers those two write themselves: a CORS
    preflight, and the 413 that ``app/body_limit.py`` sends without ever
    calling the application. Anything further in would leave a hole shaped
    exactly like the responses this process generates without running a route.
    """

    def __init__(self, app: ASGIApp, enforce_csp: bool | None = None) -> None:
        self.app = app
        # Read once, at startup, rather than per response: the flag is an
        # environment variable and turning it over needs a restart anyway.
        # The argument exists so a test can have both worlds without one.
        self.enforce_csp = settings.csp_enforced if enforce_csp is None else enforce_csp

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # scope["scheme"], and NOT the X-Forwarded-Proto header, even though
        # that is what carries the truth behind Railway's router. uvicorn is
        # started with --proxy-headers (see docker-entrypoint.sh), so it has
        # already read that header and rewritten the scheme here. Reading the
        # raw header instead would mean trusting whatever a client typed, and
        # HSTS is exactly the header you do not want a stranger able to turn
        # on for a hostname.
        secure = scope.get("scheme") == "https"
        # Read here and not in the send wrapper: by then the request headers
        # are still in scope, but this is computed once rather than per
        # response message. See _is_document for what it is for -- it only
        # ever decides a response that has no content type of its own.
        asked_for_html = "text/html" in Headers(scope=scope).get("accept", "")

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                apply_security_headers(
                    MutableHeaders(scope=message),
                    secure=secure,
                    asked_for_html=asked_for_html,
                    enforce_csp=self.enforce_csp,
                )
            await send(message)

        await self.app(scope, receive, send_with_headers)


def apply_security_headers(
    headers: MutableHeaders,
    *,
    secure: bool,
    asked_for_html: bool,
    enforce_csp: bool,
) -> None:
    """The decisions themselves, kept out of the middleware that usually calls them.

    Usually, not always: there is exactly one response in this application
    that the middleware above cannot reach, and it needs the same answers.
    See ``unhandled_error_response``.
    """
    # setdefault throughout: a response that set one of these on purpose
    # knows something this middleware does not.
    headers.setdefault("X-Content-Type-Options", NOSNIFF)
    headers.setdefault("Referrer-Policy", REFERRER_POLICY)

    if secure:
        # Over plain http the header is required to be ignored anyway
        # (RFC 6797 §7.2), so this condition changes nothing in a browser.
        # It changes something on a laptop: HSTS is scoped to a HOST and
        # not to a port, so pinning `localhost` would quietly force https
        # on every other project the developer runs there, and the only
        # cure is a trip into chrome://net-internals. Not worth it to save
        # a comparison.
        headers.setdefault("Strict-Transport-Security", HSTS)

    if not _is_document(headers.get("content-type"), asked_for_html):
        return

    headers.setdefault("X-Frame-Options", FRAME_OPTIONS)
    headers.setdefault("Cross-Origin-Opener-Policy", OPENER_POLICY)
    headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)

    if enforce_csp:
        headers.setdefault("Content-Security-Policy", FULL_CSP)
        return

    # THE DEFAULT, and the reason for the flag.
    #
    # What is enforced is the half that has been shown not to break
    # anything. The half that governs loading goes out as Report-Only:
    # same string, byte for byte, so the rehearsal is of the real thing --
    # a browser checks it and complains in the console instead of
    # refusing. Be plain about the limit of that: there is no reporting
    # endpoint, so nobody is collecting the complaints. It is something a
    # person can look at with devtools open, on an app they are using, not
    # telemetry.
    #
    # WHAT WAS ALREADY CHECKED, so that the next person does not repeat
    # it: with CSP_ENFORCED=true the login screen, the dashboard,
    # employees, absences, settings and colours were all loaded in
    # Chromium against a real database, and the browser reported no
    # violation and blocked no request. Figtree rendered, which is the
    # whole webfont chain. The same run confirms the policy was live: an
    # injected inline script, an injected <base>, a cross-origin fetch and
    # a cross-origin frame were each refused by name.
    #
    # TWO THINGS TO DECIDE BEFORE SETTING IT ON A CUSTOMER'S DEPLOYMENT:
    #   1. /docs and /redoc. FastAPI's Swagger UI is an HTML document
    #      served by this same process, and it loads its bundle from a CDN
    #      and styles it inline. Under the full policy it renders a blank
    #      page -- measured, not assumed. The right answer is almost
    #      certainly that interactive API docs should not be public on a
    #      customer deployment at all, rather than widening this policy
    #      until it fits them.
    #   2. What is left of the app. Six screens is not all of them, and a
    #      screen only violates a policy when somebody opens it. Either
    #      walk the rest with the console open, or give this a report
    #      endpoint so the complaints arrive somewhere.
    headers.setdefault("Content-Security-Policy", BASELINE_CSP)
    headers.setdefault("Content-Security-Policy-Report-Only", FULL_CSP)


async def unhandled_error_response(request: Request, exc: Exception) -> Response:
    """The one response the middleware above cannot reach.

    THE HOLE. Starlette builds its stack as ``ServerErrorMiddleware`` ->
    every user middleware -> ``ExceptionMiddleware`` -> the routes. An
    exception nobody handled unwinds past ALL of the user middleware before
    anything turns it into a response -- so the 500 that comes back is written
    outside this file's reach, and it used to go out with no headers on it at
    all. Not `nosniff`, not the Referrer-Policy, nothing. Measured, not
    deduced: an empty header list and `text/plain` "Internal Server Error".

    There is no position in the middleware list that fixes that, because the
    problem is not the order -- it is that this one response is generated by
    the machinery that wraps the order. So the only place left is where the
    response is made, which is here: Starlette uses the handler registered for
    ``Exception`` as ServerErrorMiddleware's own, and whatever it returns is
    what goes out.

    WHAT IS DELIBERATELY UNCHANGED. The body, byte for byte, and its content
    type. Turning this into the JSON error shape of ``app/errors.py`` would be
    the tidier answer and it is NOT what this is for: it would need a new code
    in both halves of the frontend dictionary (see tests/test_error_codes.py),
    it would change what a manager sees when something breaks, and none of
    that belongs in a change about headers. The only difference between the
    old 500 and this one is the headers.

    THE LOG IS ALSO UNCHANGED, which is the part worth checking rather than
    assuming: ServerErrorMiddleware re-raises the exception after the handler
    has answered, precisely so the server still logs the traceback and a test
    client can still let it through. Registering a handler does not swallow
    anything.
    """
    # PlainTextResponse and not JSONResponse: see above. `text/plain` also
    # means this is not a document, so it gets the two travelling headers and
    # no policy -- the same answer the middleware would have given it.
    response = PlainTextResponse("Internal Server Error", status_code=500)
    apply_security_headers(
        response.headers,
        secure=request.url.scheme == "https",
        asked_for_html="text/html" in request.headers.get("accept", ""),
        enforce_csp=settings.csp_enforced,
    )
    return response


__all__ = [
    "BASELINE_CSP",
    "FULL_CSP",
    "HSTS",
    "RESOURCE_CSP",
    "SecurityHeadersMiddleware",
    "apply_security_headers",
    "unhandled_error_response",
]
