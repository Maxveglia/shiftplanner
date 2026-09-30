"""Every error the server names has a sentence waiting for it in both languages.

WHY THIS TEST IS ALLOWED TO READ THE FRONTEND. The two halves of an error live
in two repositories' worth of code: the server names the failure
(``detail("invalid_credentials", ...)``) and the browser writes the sentence
(``'errors.invalid_credentials': 'Ese correo…'``). Nothing else connects them.
A code added here with no entry there falls back to the English message, which
is exactly the bug the codes were introduced to fix -- and it fails silently, on
somebody else's screen, in the one language nobody testing it is reading.

So this test opens the dictionary and checks. It is a string match on a file
path, which is ugly, and it is the only thing that can catch this.

If it fails, the fix is not here: add the key to
``frontend/src/lib/i18n/messages/errors.ts``, in BOTH languages, in the same
order in each (the frontend's own parity test checks that part).
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
DICTIONARY = REPO / "frontend" / "src" / "lib" / "i18n" / "messages" / "errors.ts"

# Where a code can be raised from. Routers and the dependency layer raise them
# directly; services return them for a router to raise.
SOURCES = sorted((BACKEND / "app").rglob("*.py"))

# The two builders in app/errors, and where the code sits in each:
#   detail("some_code", "English")
#   ai_failure(exc, "some_code", "English")
_CALL = re.compile(
    r"\bdetail\(\s*\n?\s*\"([a-z][a-z0-9_]*)\""
    r"|\bai_failure\(\s*\n?\s*\w+,\s*\n?\s*\"([a-z][a-z0-9_]*)\""
)

# The production image ships the backend alone. Skipping there is right: this
# checks a relationship between two halves of the repository, and one half is
# not present to check.
pytestmark = pytest.mark.skipif(
    not DICTIONARY.exists(), reason="frontend not present in this checkout"
)


def codes_raised() -> set:
    # The causes `ai_failure` picks between are named in a table rather than at
    # a call site, so they are read from the module itself.
    from app.errors import _AI_CAUSES

    found = {cause for _, cause in _AI_CAUSES}

    # A generation carries its failure in a COLUMN rather than in an HTTP body:
    # `generation_job.error_code`, which the client looks up in exactly the same
    # dictionary. Planning stopped being a request that can return an error, so
    # a regex over `detail(` cannot see these -- and a code the browser cannot
    # translate is the same silent bug either way. Read from the modules that
    # name them, for the same reason `_AI_CAUSES` is.
    from app.services.generation_queue import ABANDONED
    from app.services.generation_worker import NO_KEY, OVER_BUDGET

    found |= {ABANDONED, NO_KEY, OVER_BUDGET}

    # A refused publish names ONE code and carries the findings inside its
    # params, because a rota breaks the law in batches and the manager needs the
    # list rather than the first one. The code is a constant at its call site
    # (`rota_law.as_detail`), so the regex below cannot see it. The findings'
    # own codes -- rest, daily_hours, ... -- are deliberately NOT here: they
    # travel as data and the browser already has sentences for them next to its
    # own validator, which is where they are shown.
    from app.services.rota_law import BREAKS_THE_LAW

    found |= {BREAKS_THE_LAW}
    for path in SOURCES:
        if path.name == "errors.py":
            continue  # its docstring shows the shape, it does not raise
        for groups in _CALL.findall(path.read_text(encoding="utf-8")):
            found |= {g for g in groups if g}
    return found


def keys_in_dictionary() -> set:
    text = DICTIONARY.read_text(encoding="utf-8")
    return set(re.findall(r"'errors\.([a-z][a-z0-9_]*)'", text))


def test_the_client_has_a_sentence_for_every_code_we_send():
    missing = sorted(codes_raised() - keys_in_dictionary())
    assert not missing, (
        "no sentence in frontend/src/lib/i18n/messages/errors.ts for: %s"
        % ", ".join(missing)
    )


def test_the_client_carries_no_sentence_for_a_code_that_is_gone():
    """The other direction, which is untidiness rather than a bug.

    A key for a code nobody raises any more is dead weight a translator still
    pays for, and it is the trace a renamed code leaves behind.
    """
    stale = sorted(keys_in_dictionary() - codes_raised())
    assert not stale, "no code raises these any more: %s" % ", ".join(stale)


def test_some_codes_are_actually_raised():
    """A guard on the guard: a regex that matches nothing passes both tests."""
    assert len(codes_raised()) > 20


@pytest.mark.parametrize("code", sorted(codes_raised()))
def test_each_code_is_written_the_same_way_everywhere(code):
    """snake_case, which is what the dictionary keys and the tests assume."""
    assert code == code.lower()
    assert not code.startswith("_") and not code.endswith("_")
