"""One shape for an error a person is going to read.

THE PROBLEM. ``raise HTTPException(detail="Invalid credentials")`` puts an
English sentence on a screen the manager set to Spanish, and there is nothing
the client can do about it: it receives prose and prints prose. Every other
sentence in this product is composed in the browser from codes the server
sends, for exactly this reason -- the server has no dictionary, and a dictionary
is not the kind of thing a server should grow (see any of the modules in
``frontend/src/lib/i18n``).

THE SHAPE. ``detail`` becomes an object rather than a string::

    {"code": "invalid_credentials", "message": "Invalid credentials"}

The client looks ``errors.<code>`` up in its dictionary and shows the sentence
in the reader's language; if it has never heard of the code -- an older bundle
against a newer server -- it shows ``message``, which is the English that used
to be all there was. So nothing regresses and nothing needs migrating: a route
that still raises a plain string keeps working exactly as before, and the two
can coexist for as long as they need to.

``params`` carries the numbers or names a sentence interpolates, so a message
with a figure in it does not have to be pre-composed in English::

    detail("unknown_vertical", "Unknown vertical: %s" % v, vertical=v)

``code`` and ``message`` are taken, so a parameter cannot be called either --
name it for the thing it holds (``jurisdiction=``, not ``code=``) and Python
will not let you get it wrong quietly.

WHAT THE MESSAGE IS FOR, now that it is not the thing on screen. It is the log
line, the curl output, and the answer for anything that is not this client. Keep
writing it as a sentence a developer reading a trace would want.
"""
from __future__ import annotations

from typing import Any, Dict


def detail(code: str, message: str, **params: Any) -> Dict[str, Any]:
    """The body of an HTTPException: a code to translate, and English to fall back to."""
    body: Dict[str, Any] = {"code": code, "message": message}
    if params:
        body["params"] = params
    return body


# What an AI call failed OF, read from the vendor's own words.
#
# The dashboard has always told a manager the difference between "the account
# is out of credit" and "something went wrong", because those need different
# people to do different things. It used to work it out in the browser, by
# looking for "credit balance" inside the error message -- which stopped
# working the moment that message became a sentence in Spanish, and was always
# the wrong place for it: matching on prose is a thing to do to somebody else's
# output, once, as close to where it arrives as possible.
#
# So it happens here. The needles are Anthropic's wording, not ours; if they
# reword one, this falls back to the generic code and the manager is told
# something true but vaguer, which is the right way for it to break.
_AI_CAUSES = (
    ("credit balance", "ai_no_credit"),
    ("usage limit", "ai_usage_limit"),
    ("authentication", "ai_bad_key"),
    ("api key", "ai_bad_key"),
    ("rate limit", "ai_rate_limit"),
)


def ai_failure(exc: BaseException, code: str, message: str) -> Dict[str, Any]:
    """The detail for a failed model call: the cause when it is one we know.

    `code` is what to say when it is not -- "the brief could not be read", or
    whichever call this was.
    """
    text = str(exc).lower()
    for needle, cause in _AI_CAUSES:
        if needle in text:
            return detail(cause, message)
    return detail(code, message)
