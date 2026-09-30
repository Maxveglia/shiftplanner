"""A behaviour the product has promised and does not deliver yet.

Written as the test it will one day be, and marked as an expected failure in
CI: the suite stays green while the gap is open. ``strict=True`` is the point.
The day the app starts doing it the test passes, a strict xfail that passes is
a FAILURE, and whoever closed the gap has to take the mark off. A gap cannot
close in silence.

With ``SP_EVALS=1`` the mark is inert and this is an ordinary test, so the eval
that owns the case (``.claude/evals/*/cases``) sees the honest answer: red
while the gap exists.

    @known_gap("POST /shift-templates accepts 09:00-09:00")
    def test_a_template_that_starts_when_it_ends_is_refused(): ...
"""

from __future__ import annotations

import os

import pytest


def known_gap(reason: str):
    return pytest.mark.xfail(
        condition=not os.getenv("SP_EVALS"), reason=reason, strict=True
    )
