from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class ApiUsage(Base):
    """One call to a paid model, and what it cost in tokens.

    The product's variable cost is these calls and nothing else: hosting is a
    flat bill, Gemini's interview is free, and everything a manager does
    between prompts is local. So "what does this customer cost us" is a sum
    over these rows -- and until they existed, the only signal of spend was
    the monthly cap at the provider tripping, which said nothing about who.

    One row per HTTP call to the model, not per request: a brief is three
    concurrent calls, an adjustment is three, a plan is one per month. Keeping
    them apart is what lets the price of a feature be read off the table
    instead of guessed. ``request_id`` ties the calls of one request together
    so "how much does an adjustment cost" is still one query.

    Tokens, never money. Prices change and are per model; the conversion lives
    in ``services/api_usage.py`` where it can be edited in one place, and a
    row written under last month's price is not wrong today.

    The four token columns are the four the provider bills separately. Cache
    columns are zero today because nothing here marks a prompt cacheable;
    they are stored so the day that changes, the saving is measurable without
    a migration.

    ``duration_ms`` is how long the call took, wall clock, measured around the
    SDK call in the service. It is nullable because rows written before
    0017 have no answer and a zero would read as an instant reply. It is here
    because until it was, nothing in the product measured how LONG a prompt
    takes -- only what it cost -- so "the generator feels slow this week" was
    a feeling with no row behind it, and the 14-sep-2026 timeout incident in
    ``calendar_plan.py`` was diagnosed from logs that happened to still exist.

    What is deliberately NOT here: the prompt, the reply, the brief. This is a
    meter, not a log. A row says a manager at this organization spent this
    much on a plan; it never says what the plan was.
    """

    __tablename__ = "api_usage"

    id: Mapped[uuid.UUID] = uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organization.id", ondelete="CASCADE"),
        nullable=False,
    )
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    purpose: Mapped[str] = mapped_column(String, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cache_creation_input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    cache_read_input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    duration_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = created_at_col()
