from __future__ import annotations

"""assistant_memory_store, assistant_session: the business assistant's two pointers

Revision ID: 0028_business_assistant
Revises: 0027_business_memory_file
Create Date: 2026-09-22

WHAT THIS IS. The business assistant (`services/assistant.py`) runs on Claude
Managed Agents: the conversation and the memory live at Anthropic, and what
lives HERE is which of them belong to whom. Two tables, both pointers, neither
holding a word of what was said.

`assistant_memory_store` -- one row per organisation, holding the id of THE
memory store that organisation's assistant reads and writes. Created lazily, on
the first conversation, so an organisation that never opens the chat never has
one. The primary key is the org, which is what makes a second store for the
same business impossible rather than unlikely: two first conversations racing
each other both create a store at Anthropic, one of them wins the insert, and
the loser deletes its own (see `ensure_store`).

WHY A TABLE AND NOT A COLUMN ON `business_profile`. It would fit -- one per
org -- but `business_profile` is what the product BELIEVES about a business
and is read on every calendar; this is an external resource id with its own
lifecycle (created on first use, deleted when the manager says "forget
everything" or ends the account). Keeping it apart means neither can be
written by accident while the other is being edited.

`assistant_session` -- one row per conversation, binding the Anthropic session
id to the organisation AND the user that opened it. That binding is the whole
security model of the chat: a conversation id in a URL is looked up with the
caller's org and user in the WHERE, and behind `org_isolation` as well, so a
manager can no more reach another business's conversation than read its
employees. `busy_until` is the lock that keeps two answers from being drawn out
of one session at once (a double click would otherwise have two requests
reading the same event stream); it is a timestamp rather than a flag so a
container that dies mid-answer cannot leave a conversation locked forever.

The token columns are a record of what each conversation cost, for the back
office; the ledger proper is `api_usage`, which gets one row per model request
under the purpose `assistant.turn`.

WHAT IS DELIBERATELY NOT HERE. The transcript, and anything the assistant
remembers. Both live at Anthropic, both are keyed by the ids above, and both
only ever contain pseudonyms: names are replaced by stable aliases before a
word leaves this building (`services/assistant_privacy.py`).
"""

from alembic import op

revision = "0028_business_assistant"
down_revision = "0027_business_memory_file"
branch_labels = None
depends_on = None

TABLES = ("assistant_memory_store", "assistant_session")

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS assistant_memory_store (
        org_id uuid PRIMARY KEY REFERENCES organization(id) ON DELETE CASCADE,
        -- memstore_... as Anthropic issued it. Opaque; the length is a
        -- ceiling for a bug, not a format check.
        store_id text NOT NULL CHECK (length(store_id) BETWEEN 1 AND 200),
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS assistant_session (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
        -- sesn_... as Anthropic issued it. Unique because one Anthropic
        -- session belonging to two rows would be two owners for one
        -- conversation.
        anthropic_session_id text NOT NULL UNIQUE
            CHECK (length(anthropic_session_id) BETWEEN 1 AND 200),
        model text,
        busy_until timestamptz,
        turns integer NOT NULL DEFAULT 0,
        input_tokens bigint NOT NULL DEFAULT 0,
        output_tokens bigint NOT NULL DEFAULT 0,
        cache_read_input_tokens bigint NOT NULL DEFAULT 0,
        cache_creation_input_tokens bigint NOT NULL DEFAULT 0,
        -- Set when the conversation can take no more questions: the manager
        -- started a new one (the old one is deleted at Anthropic), it hit its
        -- budget, or the platform ended it.
        closed_at timestamptz,
        closed_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS ix_assistant_session_org_user "
    "ON assistant_session (org_id, user_id)",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)
    for table in TABLES:
        op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
        op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
        # Dropped first so a re-run replaces the policy instead of failing on
        # a duplicate name.
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute(
            "CREATE POLICY org_isolation ON %(t)s "
            "USING (org_id = current_setting('app.current_org_id', true)::uuid) "
            "WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid)"
            % {"t": table}
        )
        op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % table)


def downgrade() -> None:
    for table in reversed(TABLES):
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)
        op.execute("DROP TABLE IF EXISTS %s CASCADE" % table)
