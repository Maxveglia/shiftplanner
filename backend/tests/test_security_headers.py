"""What every response tells the browser to do, and what it deliberately does not.

The application sent no security headers at all. No HSTS, no CSP, no
`nosniff`, nothing about framing, nothing about the Referer. The reason that
matters more here than in most apps is in `frontend/src/auth/AuthContext.tsx`:
the access token is kept in localStorage, so there is no HttpOnly cookie
holding the line and one injection is one stolen session.

This file exists so that the two halves of that answer stay honest:

  * the headers are actually ON the responses -- and on the right ones, which
    is the part a middleware gets wrong silently. A Content-Security-Policy
    over a JSON body governs nothing; if it were sent anyway, an audit would
    come back green and the question would stop being asked.
  * the policy still describes the frontend that is actually built. The last
    test opens the frontend's own stylesheet and checks that every external
    origin it reaches for is named in the CSP. Nothing else connects those two
    files, and the failure mode is a blank screen on somebody else's Monday.

No database anywhere in here: the middleware is wrapped around an application
of one route and a directory of three files, which is also the only way to ask
what a 304 carries.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.security_headers import (
    BASELINE_CSP,
    FULL_CSP,
    HSTS,
    RESOURCE_CSP,
    SecurityHeadersMiddleware,
    unhandled_error_response,
)
from app.spa import HASHED_CACHE, SHELL_CACHE, mount_frontend

pytestmark = pytest.mark.filterwarnings("ignore")

REPO = Path(__file__).resolve().parents[2]


def _app(tmp_path: Path, enforce_csp: bool = False, secure: bool = False) -> TestClient:
    """One API route and a build to serve, which is the whole shape of this app.

    The API route is registered before the mount because the mount claims "/"
    and Starlette matches in registration order -- the same rule main.py obeys.
    """
    (tmp_path / "index.html").write_text("<html>shell</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-D1x7XY4d.js").write_text("console.log(1)")

    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping() -> dict:
        return {"status": "ok"}

    assert mount_frontend(app, str(tmp_path))
    app.add_middleware(SecurityHeadersMiddleware, enforce_csp=enforce_csp)
    return TestClient(app, base_url="https://testserver" if secure else "http://testserver")


# --------------------------------------------------------------------------
# The document: the only response where most of this means anything.
# --------------------------------------------------------------------------


def test_the_shell_is_told_it_may_not_be_framed(tmp_path):
    """Clickjacking, and by the header that actually refuses today.

    `frame-ancestors` lives in the CSP, and while the CSP's loading half is
    Report-Only a browser reports the framing and then frames it anyway. So
    X-Frame-Options is not the redundant old header here: it is the one doing
    the work.
    """
    r = _app(tmp_path).get("/")
    assert r.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in r.headers["content-security-policy"]


def test_the_shell_carries_the_rest_of_the_document_headers(tmp_path):
    r = _app(tmp_path).get("/")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert r.headers["cross-origin-opener-policy"] == "same-origin"


def test_the_camera_is_ours_alone_and_nothing_else_is_open(tmp_path):
    """The inventory scans barcodes with the phone's camera, so it is allowed --
    to this origin only. `(self)` and not `*`: a frame from anywhere else still
    cannot ask. Microphone and geolocation are used nowhere and stay shut.
    """
    policy = _app(tmp_path).get("/").headers["permissions-policy"]
    features = dict(
        part.strip().split("=", 1) for part in policy.split(",") if part.strip()
    )
    assert features["camera"] == "(self)"
    assert "camera=*" not in policy
    assert features["microphone"] == "()"
    assert features["geolocation"] == "()"


def test_a_client_route_is_the_shell_and_is_protected_like_one(tmp_path):
    """/employees/123 is answered with index.html, so it IS the document."""
    r = _app(tmp_path).get("/employees/123")
    assert "shell" in r.text
    assert r.headers["x-frame-options"] == "DENY"
    assert "default-src" in r.headers["content-security-policy-report-only"]


# --------------------------------------------------------------------------
# Everything else: the headers that travel, and the ones that would be decoration.
# --------------------------------------------------------------------------


def test_the_api_gets_the_headers_that_mean_something_to_json(tmp_path):
    r = _app(tmp_path).get("/api/v1/ping")
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_the_api_is_not_given_a_policy_it_cannot_use(tmp_path):
    """A CSP on a JSON body governs nothing -- nothing is ever loaded from one.

    Sending it anyway would be the worst kind of pass: a grep for the header
    name comes back green and the document, which is where the policy would
    have mattered, is never looked at again.
    """
    r = _app(tmp_path).get("/api/v1/ping")
    assert "content-security-policy" not in r.headers
    assert "content-security-policy-report-only" not in r.headers
    assert "x-frame-options" not in r.headers


def test_an_asset_is_protected_without_being_given_a_policy(tmp_path):
    r = _app(tmp_path).get("/assets/index-D1x7XY4d.js")
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in r.headers


def test_nothing_here_touches_what_a_browser_may_keep(tmp_path):
    """The cache rules are spa.py's and were their own bug once.

    Both directions: the year on a hashed asset, and the ask-every-time on the
    shell. A middleware that sets headers on the way out is exactly the kind
    of thing that ends up owning a header it never meant to.
    """
    client = _app(tmp_path)
    assert client.get("/assets/index-D1x7XY4d.js").headers["cache-control"] == HASHED_CACHE
    assert client.get("/").headers["cache-control"] == SHELL_CACHE


def test_the_policy_rides_on_the_304_as_well(tmp_path):
    """Found by running it, and it is the reason the flag can be trusted.

    The shell is served `no-cache`, so a browser asks about it on every load
    and is answered 304 nearly every time. A 304 does not replace the headers
    already stored for that URL -- it updates them, and leaves untouched
    anything it does not mention. So a 304 with no policy on it means the
    browser keeps whatever policy it was handed the first time: turning
    CSP_ENFORCED back off after a bad Monday would not reach it, and neither
    would a restart, because the files keep the mtime they were built with and
    so keep their ETag.

    A 304 has no content type to go on, so the decision falls back to what the
    request asked for -- which is how a browser navigating to a page differs
    from one revalidating a bundle.
    """
    client = _app(tmp_path)
    etag = client.get("/").headers["etag"]

    r = client.get("/", headers={"If-None-Match": etag, "Accept": "text/html"})
    assert r.status_code == 304
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-security-policy"] == BASELINE_CSP
    assert r.headers["content-security-policy-report-only"] == FULL_CSP
    assert r.headers["x-frame-options"] == "DENY"


def test_a_revalidated_asset_is_still_not_a_document(tmp_path):
    """The other half of the fallback: `Accept` is what separates the two.

    A bundle or a stylesheet being revalidated is a 304 with no content type
    either, and it must not pick up a policy it has no use for -- otherwise
    the rule above quietly becomes "every 304 is a page".
    """
    client = _app(tmp_path)
    asset = "/assets/index-D1x7XY4d.js"
    etag = client.get(asset).headers["etag"]

    r = client.get(asset, headers={"If-None-Match": etag, "Accept": "*/*"})
    assert r.status_code == 304
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "content-security-policy" not in r.headers


def test_the_xss_filter_header_is_not_sent(tmp_path):
    """On purpose, and this test is how that decision survives the next audit.

    X-XSS-Protection controls a filter Chrome removed and Firefox never had,
    and `1; mode=block` was itself the cause of cross-site leaks. It is a line
    in a report and nothing in a browser.
    """
    assert "x-xss-protection" not in _app(tmp_path).get("/").headers


# --------------------------------------------------------------------------
# HSTS: what is promised, to whom, and over what.
# --------------------------------------------------------------------------


def test_https_gets_hsts_for_a_year(tmp_path):
    r = _app(tmp_path, secure=True).get("/")
    assert r.headers["strict-transport-security"] == HSTS
    assert "max-age=31536000" in HSTS


def test_hsts_promises_nothing_about_other_hostnames(tmp_path):
    """No includeSubDomains and no preload, deliberately.

    Both are promises on behalf of hostnames this process does not serve, and
    neither can be taken back in a hurry: the only remedy is waiting out
    max-age in every browser that heard it.
    """
    sts = _app(tmp_path, secure=True).get("/").headers["strict-transport-security"]
    assert "includesubdomains" not in sts.lower()
    assert "preload" not in sts.lower()


def test_plain_http_is_never_pinned(tmp_path):
    """Which is about a laptop, not about production.

    HSTS is scoped to a HOST and not to a port, so pinning `localhost` from a
    development run would quietly force https on every other project on that
    machine, curable only from chrome://net-internals.
    """
    assert "strict-transport-security" not in _app(tmp_path).get("/").headers


# --------------------------------------------------------------------------
# The policy: what is enforced now, what is only rehearsed, and what it allows.
# --------------------------------------------------------------------------


def test_by_default_only_the_half_that_cannot_break_a_page_is_enforced(tmp_path):
    r = _app(tmp_path).get("/")
    assert r.headers["content-security-policy"] == BASELINE_CSP
    assert r.headers["content-security-policy-report-only"] == FULL_CSP


def test_the_enforced_half_says_nothing_about_loading(tmp_path):
    """Which is what makes it safe to ship enforcing on day one.

    base-uri, object-src, frame-ancestors and form-action forbid four things
    this app does not do. They must not acquire a directive that decides where
    a script may come from -- that half is what the flag is for.
    """
    enforced = _app(tmp_path).get("/").headers["content-security-policy"]
    for loading in ("default-src", "script-src", "style-src", "connect-src"):
        assert loading not in enforced


def test_the_flag_promotes_the_identical_policy(tmp_path):
    """Same string, byte for byte, so the rehearsal was of the real thing."""
    r = _app(tmp_path, enforce_csp=True).get("/")
    assert r.headers["content-security-policy"] == FULL_CSP
    assert "content-security-policy-report-only" not in r.headers
    assert BASELINE_CSP in FULL_CSP


def test_scripts_may_not_be_inline_or_evaluated(tmp_path):
    """The one directive the stolen-token risk actually turns on.

    `vite build` emits a single hashed module script and no inline script, and
    nothing in the source or its dependencies calls eval(). If a change ever
    needs 'unsafe-inline' here, it needs a different change.

    The one source beyond 'self' is 'wasm-unsafe-eval', for the barcode
    reader's WebAssembly on iPhones: it allows compiling wasm and nothing
    else -- eval() and new Function() stay refused -- so it is named exactly
    here, and 'unsafe-eval' (which it is not) is checked as a whole token.
    """
    [directive] = [d for d in RESOURCE_CSP.split("; ") if d.startswith("script-src ")]
    assert directive.split()[1:] == ["'self'", "'wasm-unsafe-eval'"]
    assert "'unsafe-eval'" not in directive.split()
    assert "'unsafe-inline'" not in directive.split()


def test_styles_may_be_inline_because_the_frontend_writes_them(tmp_path):
    """A concession, not an oversight, and worth keeping visible.

    React writes `style={{ ... }}` onto elements in some three dozen places --
    a bar's width in percent, an animation delay -- and those are style
    ATTRIBUTES, refused without 'unsafe-inline'. A nonce cannot help; only
    moving those values into classes can.
    """
    written_inline = len(
        re.findall(r"style=\{\{", "\n".join(
            p.read_text() for p in (REPO / "frontend" / "src").rglob("*.tsx")
        ))
    )
    assert written_inline > 0, "if the frontend stopped doing this, tighten style-src"
    assert "style-src 'self' 'unsafe-inline'" in RESOURCE_CSP


def test_the_policy_still_names_every_origin_the_frontend_reaches_for(tmp_path):
    """The test that catches the Monday.

    A CSP is a list of origins written down in one repository half about code
    in another. Add a webfont, an analytics snippet or an icon CDN to the
    frontend and nothing connects the two -- until the screen is blank for
    whoever deployed it.

    Stylesheets and the shell only: those are where an external origin is
    introduced declaratively, without anybody writing a fetch. It reads
    `src/**/*.css` and `index.html` rather than the built output because the
    build is not in the repository.
    """
    sources = [REPO / "frontend" / "index.html"]
    sources += sorted((REPO / "frontend" / "src").rglob("*.css"))
    text = "\n".join(p.read_text() for p in sources if p.is_file())

    origins = {m.group(0) for m in re.finditer(r"https://[a-z0-9.-]+", text)}
    assert origins, "expected at least the webfont import to be found"

    for origin in sorted(origins):
        assert origin in FULL_CSP, (
            "%s is loaded by the frontend and is not in the policy -- allow it "
            "here or self-host it" % origin
        )


# --------------------------------------------------------------------------
# Where it sits in the stack, which is the part that is invisible until it is wrong.
# --------------------------------------------------------------------------


def test_the_refusal_the_body_limit_writes_is_protected_too(tmp_path):
    """The 413 never reaches a route, so only an OUTER middleware can reach it.

    app/body_limit.py answers on its own, from inside the stack, without
    calling the application at all. If the security headers were added before
    it in main.py they would be inside it, and the responses this process
    generates by itself -- a refusal, a CORS preflight -- would be the exact
    set that went out bare.
    """
    from app.body_limit import MAX_BODY_BYTES, BodySizeLimitMiddleware

    app = FastAPI()

    @app.post("/api/v1/echo")
    async def echo() -> dict:
        return {"ok": True}

    app.add_middleware(BodySizeLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    r = TestClient(app).post("/api/v1/echo", content=b"x" * (MAX_BODY_BYTES + 1))
    assert r.status_code == 413
    assert r.headers["x-content-type-options"] == "nosniff"
    # And the refusal's own no-store survived: setdefault never overwrites.
    assert r.headers["cache-control"] == "no-store"


def test_the_real_application_puts_it_outermost():
    """Read off main.py rather than trusted to a comment.

    Starlette makes the LAST middleware added the outer one -- `add_middleware`
    inserts at the FRONT of `user_middleware`, and the stack is then built from
    that list outside in. So this list reads outermost first, which is the
    reverse of the order the calls appear in main.py, and is exactly the thing
    that is easy to get backwards while reading a diff.
    """
    from app.body_limit import BodySizeLimitMiddleware
    from app.main import app as real_app

    order = [m.cls.__name__ for m in real_app.user_middleware]
    assert order == [
        SecurityHeadersMiddleware.__name__,  # outermost: sees every response
        "CORSMiddleware",
        BodySizeLimitMiddleware.__name__,  # innermost: its 413 goes out through both
    ]


# --------------------------------------------------------------------------
# The 500 nobody handled: the one response the middleware cannot reach.
# --------------------------------------------------------------------------


def _blows_up(with_handler: bool) -> TestClient:
    """An application whose only route raises, wired the way main.py wires it."""
    app = FastAPI()

    @app.get("/api/v1/boom")
    def boom() -> dict:
        raise RuntimeError("nope")

    app.add_middleware(SecurityHeadersMiddleware)
    if with_handler:
        app.add_exception_handler(Exception, unhandled_error_response)
    # raise_server_exceptions=False so the client returns the 500 the way a
    # browser would receive it, instead of re-raising it into the test.
    return TestClient(app, raise_server_exceptions=False)


def test_outermost_is_not_far_enough_out_for_a_500(tmp_path):
    """The gap, pinned. This is what the middleware ALONE does with a 500.

    Starlette's stack is ServerErrorMiddleware -> every user middleware ->
    ExceptionMiddleware -> the routes, so an exception nobody handled unwinds
    past all of this file's work before anything turns it into a response.
    Outermost is still inside that.

    The test is here rather than a comment because the tempting conclusion --
    "the security middleware is outermost, so it covers everything" -- is
    false in exactly one place, and nothing about reading main.py says so.
    """
    r = _blows_up(with_handler=False).get("/api/v1/boom")
    assert r.status_code == 500
    assert "x-content-type-options" not in r.headers
    assert "referrer-policy" not in r.headers


def test_the_handler_closes_it_without_changing_the_answer(tmp_path):
    """And the "without changing" half is the part worth a test.

    The body and its content type are byte for byte what Starlette was already
    sending. Turning a 500 into the JSON error shape of app/errors.py would be
    tidier and would also need a new code in both frontend dictionaries and
    change what a manager sees when something breaks -- none of which belongs
    in a change about headers.
    """
    r = _blows_up(with_handler=True).get("/api/v1/boom")
    assert r.status_code == 500
    assert r.text == "Internal Server Error"
    assert r.headers["content-type"] == "text/plain; charset=utf-8"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"


def test_a_500_is_not_a_document_either(tmp_path):
    """text/plain, so no policy on it. A 500 renders no scripts and loads nothing."""
    headers = _blows_up(with_handler=True).get("/api/v1/boom").headers
    assert "content-security-policy" not in headers
    assert "x-frame-options" not in headers


def test_a_500_over_tls_still_carries_hsts(tmp_path):
    app = FastAPI()

    @app.get("/api/v1/boom")
    def boom() -> dict:
        raise RuntimeError("nope")

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_exception_handler(Exception, unhandled_error_response)
    client = TestClient(app, raise_server_exceptions=False, base_url="https://testserver")
    assert client.get("/api/v1/boom").headers["strict-transport-security"] == HSTS


def test_the_handler_does_not_swallow_the_exception(tmp_path):
    """Which is what keeps the traceback in the log.

    ServerErrorMiddleware re-raises after its handler has answered, precisely
    so the server still logs and a test client can still let it through. A
    handler that quietly ended the exception would turn every 500 into a
    silent one, and that would be a far worse trade than the header it buys.
    """
    app = FastAPI()

    @app.get("/api/v1/boom")
    def boom() -> dict:
        raise RuntimeError("nope")

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_exception_handler(Exception, unhandled_error_response)

    with pytest.raises(RuntimeError, match="nope"):
        TestClient(app).get("/api/v1/boom")


def test_the_real_application_registers_it():
    from app.main import app as real_app

    assert real_app.exception_handlers.get(Exception) is unhandled_error_response
