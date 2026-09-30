from __future__ import annotations

"""Sending an email, and the seam that keeps the provider replaceable.

WHY urllib AND NOT httpx. `httpx` is in `[dev]` of `pyproject.toml` and is NOT
in the image production runs. Importing it under `app/` passes CI in green and
takes the whole service down on boot -- that is not a hypothetical, it happened
on 8 Sep 2026 and needed a hotfix. `services/interview.py` calls Gemini over
`urllib.request` for exactly this reason, and this follows it. Before importing
anything new here, check it is in `dependencies` and not in `dev`.

WHY A SEAM AT ALL, for one provider. The choice between providers was made on
a free tier -- a number that is not ours and can be withdrawn. A `Mailer`
protocol with a null implementation costs a dozen lines now and makes the
switch a new class rather than a search through the code for whoever knows how
to send.

OFF UNLESS CONFIGURED, and loudly. With no API key this returns a mailer that
accepts every message and delivers none, and every caller can see that it did:
`send` reports what happened rather than raising, so publishing a rota with no
mail configured behaves exactly as it did before and the manager is told the
team was not reached. A notification system that silently does nothing is worse
than none, because the manager stops telling people by hand.
"""

import json
import logging
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import List, Optional, Protocol

from app.config import settings

log = logging.getLogger(__name__)

RESEND_ENDPOINT = "https://api.resend.com/emails"

#: How long one send may take. Generous: this runs after the response has gone
#: out, so nobody is watching a spinner, and a slow provider is not a reason to
#: drop somebody's rota.
TIMEOUT_SECONDS = 20

#: Retries, and what is worth retrying. Rate limiting and a provider's own bad
#: day are transient; a rejected address or an unverified domain will be
#: rejected exactly the same way in two seconds, and retrying it burns the
#: daily allowance of a free tier.
RETRYABLE_STATUS = frozenset({408, 429, 500, 502, 503, 504})
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 2.0


@dataclass(frozen=True)
class Message:
    """One email to one person."""

    to: str
    subject: str
    text: str


@dataclass(frozen=True)
class SendResult:
    """What happened, per message. Never an exception.

    A rota that published is published; a provider that refused an address must
    not turn that into a 500 and a manager who thinks nothing happened.
    """

    delivered: int
    failed: int
    #: Addresses that were refused, for the log. Never shown to another user.
    failures: List[str]

    @property
    def attempted(self) -> int:
        return self.delivered + self.failed


class Mailer(Protocol):
    def send(self, messages: List[Message]) -> SendResult: ...

    @property
    def configured(self) -> bool: ...


class NullMailer:
    """Accepts everything, delivers nothing, and says so.

    What runs in development, in the tests, and in any deployment where the
    key has not been set. It counts the messages as failures rather than
    successes on purpose: "we reached nobody" is the true statement, and the
    screen that reports it is the one that tells the manager to pick up a
    phone.
    """

    @property
    def configured(self) -> bool:
        return False

    def send(self, messages: List[Message]) -> SendResult:
        if messages:
            log.info(
                "mailer: not configured, %d message(s) not sent "
                "(set RESEND_API_KEY and MAIL_FROM)",
                len(messages),
            )
        return SendResult(delivered=0, failed=len(messages), failures=[])


class ResendMailer:
    """Resend, over the standard library. One request per message."""

    def __init__(self, api_key: str, sender: str) -> None:
        self._api_key = api_key
        self._sender = sender

    @property
    def configured(self) -> bool:
        return True

    def send(self, messages: List[Message]) -> SendResult:
        delivered = 0
        failures: List[str] = []
        for message in messages:
            if self._send_one(message):
                delivered += 1
            else:
                failures.append(message.to)
        return SendResult(
            delivered=delivered, failed=len(failures), failures=failures
        )

    def _send_one(self, message: Message) -> bool:
        body = json.dumps(
            {
                "from": self._sender,
                "to": [message.to],
                "subject": message.subject,
                "text": message.text,
            }
        ).encode("utf-8")

        for attempt in range(1, MAX_ATTEMPTS + 1):
            request = urllib.request.Request(
                RESEND_ENDPOINT,
                data=body,
                method="POST",
                headers={
                    "Authorization": "Bearer %s" % self._api_key,
                    "Content-Type": "application/json",
                },
            )
            try:
                with urllib.request.urlopen(
                    request, timeout=TIMEOUT_SECONDS
                ) as response:
                    if 200 <= response.status < 300:
                        return True
                    status: Optional[int] = response.status
            except urllib.error.HTTPError as exc:
                status = exc.code
                # The body carries the reason -- an unverified domain, a
                # malformed address. Logged without the recipient, which is
                # somebody's personal address and does not belong in a log we
                # read casually.
                log.warning(
                    "mailer: provider refused a message (%s): %s",
                    status,
                    exc.read()[:300].decode("utf-8", "replace"),
                )
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                status = None
                log.warning("mailer: could not reach the provider: %s", exc)

            retryable = status is None or status in RETRYABLE_STATUS
            if not retryable or attempt == MAX_ATTEMPTS:
                return False
            time.sleep(BACKOFF_SECONDS * attempt)

        return False


def mailer() -> Mailer:
    """The mailer this deployment has. Never None, never raises."""
    if settings.resend_api_key and settings.mail_from:
        return ResendMailer(settings.resend_api_key, settings.mail_from)
    return NullMailer()
