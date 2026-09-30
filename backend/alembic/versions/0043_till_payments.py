from __future__ import annotations

"""store_sale: charged at the till, paid in cash or by card, voided and never deleted

Revision ID: 0043_till_payments
Revises: 0042_inventory_item_photos
Create Date: 2026-09-27

Tienda -> Menú stops being only the carta: a tap on a dish puts it on the
bill, and the bill is charged there. The first sales that do not come from the
manager's typing, which 0035 left room for.

WHAT A TILL THAT RECORDS SALES IS. Spain's anti-fraud law calls it a "sistema
informático de facturación" (Veri*factu), and what such a system must never
do is let a record of a sale disappear or change after the fact. Max chose, on
27-sep-2026: a bill and its charge, NOTHING deleted, and Veri*factu and the
SumUp card reader left for before a reader is connected. So:

* `payment_method`: 'cash' or 'card', NULL when nobody said. Card is the
  manager confirming the reader took the money -- there is no reader behind
  it yet. NULL is every sale typed in before this migration, and any typed in
  by hand from paper that does not say how it was paid: a guess would be a
  wrong number in the day's cash count, a NULL is an honest "unknown". A bill
  charged at the till always says (`store_sale_till_paid_check`): the till is
  where the money is taken, so it knows.
* `source` admits 'till' next to 'manual'. 0035's CHECK kept it to the
  sources that existed and said the migration bringing the next one widens
  it; this is that one. Rewritten under the name Postgres gave 0035's inline
  CHECK (`store_sale_source_check`), so there is one constraint on it, not two.
* `voided_at`, `voided_by`, `voided_by_name`, `void_reason`: a sale is VOIDED,
  not deleted. The row, its lines, its total and what it took off the stock
  (0041's `store_sale_consumption`) stay exactly as they were; the statistics
  leave it out (routers/store.py), and so does the stock
  (routers/inventory.py), which puts back what it took. `voided_by` is SET
  NULL with the account, like `created_by`: a manager who leaves takes their
  login, not the trail -- `voided_by_name` is who it was, copied from the
  account when the sale is voided, as a line copies the dish's name, and it
  stays when the account goes. The reason is one short line, optional, at
  most 200 characters (the schema trims it first). A CHECK keeps the four
  honest: a reason, a voider or a name on a sale that was never voided is
  nonsense.

THE RUNTIME ROLE CAN NO LONGER DELETE OR EDIT A SALE. The API has no route
that does since this migration -- DELETE /store/sales/{id} is gone and there
never was a PATCH -- and the database now says the same to app_user, so a
future route that forgets cannot do it either. In two layers:

1. Privileges. No DELETE on the sale, its lines or what it took off the
   stock, no UPDATE on a line or on what it took, and UPDATE on a sale only
   of the three columns a void sets.

2. Triggers, for what a privilege cannot say. A column grant says WHICH
   columns, not from what to what: with it alone, app_user could un-void a
   sale (the three back to NULL), rewrite the reason, the time or the voider
   of one already voided, or -- INSERT being allowed, since that is how a sale
   is saved -- add a line to a sale saved last week, and change its total.
   So, for every role, the owner included (who could drop them, but not by
   accident):

   * `store_sale_written_once` (BEFORE INSERT OR UPDATE on store_sale). A
     sale is saved not voided. After that the only change there is, once, is
     the void: `voided_at` from NULL to a value, with a voider -- an account
     of this business -- in the same statement. The database writes the time
     (`now()`, not what was sent: a void cannot be backdated) and the name
     (the voider's account's, not what was sent). Nothing else about the
     sale ever changes, and nothing about the void once made. The one
     exception is not an edit: `created_by` and `voided_by` go to NULL when
     the account they name is deleted (their ON DELETE SET NULL), and only
     then -- the trigger lets an account column go to NULL only if that
     account no longer exists.

   * `store_sale_part_with_its_sale` (BEFORE INSERT on store_sale_line and
     store_sale_consumption). A line, or what a sale took, is written in the
     transaction that saves the sale, and never added afterwards. "The same
     transaction" is `created_xact`, a column of store_sale the INSERT
     trigger stamps with `pg_current_xact_id()` -- whatever the INSERT said,
     so it cannot be forged -- and nothing may change after. Not `xmin`, which
     looks like the same thing and is not: (a) routers/store.py inserts the
     sale inside a SAVEPOINT, so its `xmin` is the subtransaction's id, never
     equal to `pg_current_xact_id()` (the top-level one): the normal path
     would be refused; (b) any UPDATE of the row -- the void itself -- writes
     a new version with the updating transaction's `xmin`, so "void it, then
     add a line, in one transaction" would pass; (c) `xmin` is 32 bits and
     wraps. `pg_current_xact_id()` is the top-level transaction's id also
     inside a savepoint, and 64 bits (xid8): it never comes round again, so no
     later transaction can match a sale's stamp. Sales saved before this
     migration have none (NULL), and match nothing.

   A later migration that must fill in a new column of store_sale does it
   between `ALTER TABLE store_sale DISABLE TRIGGER store_sale_written_once`
   and `ENABLE`, and says why: that is the "on purpose" above.

Deleting a whole business still takes its sales with it, what they took
included: that cascade runs as the table's owner, not as app_user (and the
back office deletes on the admin session anyway), and deletes, which neither
trigger looks at. A mistake in a sale is corrected by voiding it and saving
the right one.

THE DOWNGRADE REFUSES rather than lose what this migration made possible.
Once there is a till sale, a payment method or a voided sale, going back
would lose how each sale was paid and -- worse -- put every voided sale back
into the totals and its ingredients back off the stock, silently: 0041's code
has no idea a sale can be voided. With none of them (a database that never
charged at the till), it drops the triggers, their functions and the columns,
puts the CHECK back to 'manual' alone and gives app_user back what 0035 and
0041 granted.
"""

from alembic import op
from sqlalchemy import text

revision = "0043_till_payments"
down_revision = "0042_inventory_item_photos"
branch_labels = None
depends_on = None

# Every refusal below is a 42501, insufficient_privilege, like the privileges'
# own "permission denied": nobody has the privilege to change a sale. Not a
# 23xxx, which a route's `except IntegrityError` (the retry of a save sent
# twice) would take for a race it knows how to answer.
SALE_WRITTEN_ONCE = r"""
CREATE OR REPLACE FUNCTION store_sale_written_once() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    -- What may change at all: the void, and the two accounts going with
    -- their ON DELETE SET NULL. Everything else is the sale as it was saved,
    -- columns added later included.
    may_change CONSTANT text[] := ARRAY[
        'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'created_by'
    ];
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL
           OR NEW.voided_by_name IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
            RAISE EXCEPTION 'a sale is saved, and voided afterwards: never saved voided'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.created_xact := pg_current_xact_id();
        RETURN NEW;
    END IF;

    IF (to_jsonb(NEW) - may_change) IS DISTINCT FROM (to_jsonb(OLD) - may_change) THEN
        RAISE EXCEPTION 'sale %: a sale is never edited, only voided', OLD.id
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Only by its foreign key: to NULL, once the account is gone.
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND (NEW.created_by IS NOT NULL
            OR EXISTS (SELECT 1 FROM user_account WHERE id = OLD.created_by)) THEN
        RAISE EXCEPTION 'sale %: who saved it is never changed', OLD.id
            USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF OLD.voided_at IS NULL THEN
        IF NEW.voided_at IS NULL THEN
            -- Not voided, and not being voided. A voider or a reason without
            -- the void is the CHECK's to refuse.
            RETURN NEW;
        END IF;
        -- The void. Who is an account of this business; when and the name
        -- are the database's to write.
        IF NEW.voided_by IS NULL THEN
            RAISE EXCEPTION 'sale %: a void says who voided it', OLD.id
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        SELECT full_name INTO NEW.voided_by_name
          FROM user_account
         WHERE id = NEW.voided_by AND org_id = NEW.org_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'sale %: voided by an account that is not this business''s', OLD.id
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        NEW.voided_at := now();
        RETURN NEW;
    END IF;

    -- Already voided: when, why and by whom are the record. The voider's id
    -- goes only with their account, and the name stays.
    IF NEW.voided_at IS DISTINCT FROM OLD.voided_at
       OR NEW.void_reason IS DISTINCT FROM OLD.void_reason
       OR NEW.voided_by_name IS DISTINCT FROM OLD.voided_by_name
       OR (NEW.voided_by IS DISTINCT FROM OLD.voided_by
           AND (NEW.voided_by IS NOT NULL
                OR EXISTS (SELECT 1 FROM user_account WHERE id = OLD.voided_by))) THEN
        RAISE EXCEPTION 'sale %: a void is never undone nor rewritten', OLD.id
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$fn$
"""

PART_WITH_ITS_SALE = r"""
CREATE OR REPLACE FUNCTION store_sale_part_with_its_sale() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM 1
       FROM store_sale
      WHERE id = NEW.sale_id
        AND org_id = NEW.org_id
        AND created_xact = pg_current_xact_id()
        AND voided_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION '%: written with its sale, in the transaction that saves it, and never added afterwards',
            TG_TABLE_NAME
            USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END
$fn$
"""

UPGRADE_STATEMENTS = [
    """
    ALTER TABLE store_sale
        ADD COLUMN IF NOT EXISTS payment_method text
            CONSTRAINT store_sale_payment_method_check
            CHECK (payment_method IN ('cash', 'card'))
    """,
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_source_check",
    """
    ALTER TABLE store_sale ADD CONSTRAINT store_sale_source_check
        CHECK (source IN ('manual', 'till'))
    """,
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_till_paid_check",
    """
    ALTER TABLE store_sale ADD CONSTRAINT store_sale_till_paid_check
        CHECK (source <> 'till' OR payment_method IS NOT NULL)
    """,
    "ALTER TABLE store_sale ADD COLUMN IF NOT EXISTS voided_at timestamptz",
    """
    ALTER TABLE store_sale
        ADD COLUMN IF NOT EXISTS voided_by uuid
            CONSTRAINT store_sale_voided_by_fkey
            REFERENCES user_account(id) ON DELETE SET NULL
    """,
    "ALTER TABLE store_sale ADD COLUMN IF NOT EXISTS voided_by_name text",
    """
    ALTER TABLE store_sale
        ADD COLUMN IF NOT EXISTS void_reason text
            CONSTRAINT store_sale_void_reason_check
            CHECK (length(void_reason) <= 200)
    """,
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_void_check",
    """
    ALTER TABLE store_sale ADD CONSTRAINT store_sale_void_check
        CHECK (
            voided_at IS NOT NULL
            OR (voided_by IS NULL AND voided_by_name IS NULL AND void_reason IS NULL)
        )
    """,
    # No default and no backfill: the trigger is its only writer, and a sale
    # saved before this migration was saved in no transaction still open.
    "ALTER TABLE store_sale ADD COLUMN IF NOT EXISTS created_xact xid8",
    SALE_WRITTEN_ONCE,
    "DROP TRIGGER IF EXISTS store_sale_written_once ON store_sale",
    """
    CREATE TRIGGER store_sale_written_once
        BEFORE INSERT OR UPDATE ON store_sale
        FOR EACH ROW EXECUTE FUNCTION store_sale_written_once()
    """,
    PART_WITH_ITS_SALE,
    "DROP TRIGGER IF EXISTS store_sale_part_with_its_sale ON store_sale_line",
    """
    CREATE TRIGGER store_sale_part_with_its_sale
        BEFORE INSERT ON store_sale_line
        FOR EACH ROW EXECUTE FUNCTION store_sale_part_with_its_sale()
    """,
    "DROP TRIGGER IF EXISTS store_sale_part_with_its_sale ON store_sale_consumption",
    """
    CREATE TRIGGER store_sale_part_with_its_sale
        BEFORE INSERT ON store_sale_consumption
        FOR EACH ROW EXECUTE FUNCTION store_sale_part_with_its_sale()
    """,
    # What the runtime role may still do: read the three tables, insert a
    # sale, its lines and what it took, and void a sale. The table-level
    # REVOKE goes first: revoking a privilege on a table revokes it on every
    # column too, so the other way round it would take the column grant back
    # with it. Not `voided_by_name` nor `created_xact`: the triggers write
    # those.
    "REVOKE UPDATE, DELETE ON store_sale FROM app_user",
    "GRANT UPDATE (voided_at, voided_by, void_reason) ON store_sale TO app_user",
    "REVOKE UPDATE, DELETE ON store_sale_line FROM app_user",
    "REVOKE UPDATE, DELETE ON store_sale_consumption FROM app_user",
]

DOWNGRADE_STATEMENTS = [
    "REVOKE UPDATE (voided_at, voided_by, void_reason) ON store_sale FROM app_user",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON store_sale TO app_user",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON store_sale_line TO app_user",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON store_sale_consumption TO app_user",
    "DROP TRIGGER IF EXISTS store_sale_part_with_its_sale ON store_sale_consumption",
    "DROP TRIGGER IF EXISTS store_sale_part_with_its_sale ON store_sale_line",
    "DROP FUNCTION IF EXISTS store_sale_part_with_its_sale()",
    "DROP TRIGGER IF EXISTS store_sale_written_once ON store_sale",
    "DROP FUNCTION IF EXISTS store_sale_written_once()",
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS created_xact",
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_void_check",
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS void_reason",
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS voided_by_name",
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS voided_by",
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS voided_at",
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_till_paid_check",
    "ALTER TABLE store_sale DROP CONSTRAINT IF EXISTS store_sale_source_check",
    """
    ALTER TABLE store_sale ADD CONSTRAINT store_sale_source_check
        CHECK (source IN ('manual'))
    """,
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS payment_method",
]


def what_would_be_lost(bind) -> dict:
    """The rows a downgrade would misrepresent, counted; all zeros means it
    is safe. Separate from `downgrade` so a test can run it. Read on the
    migration's own (admin) connection, which row-level security does not
    filter: every business counts."""
    return dict(
        bind.execute(
            text(
                "SELECT count(*) FILTER (WHERE source = 'till') AS till, "
                "count(*) FILTER (WHERE payment_method IS NOT NULL) AS paid, "
                "count(*) FILTER (WHERE voided_at IS NOT NULL) AS voided "
                "FROM store_sale"
            )
        )
        .mappings()
        .one()
    )


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    lost = what_would_be_lost(op.get_bind())
    if any(lost.values()):
        raise RuntimeError(
            "0043 cannot be downgraded: %(till)d sale(s) from the till, "
            "%(paid)d with a payment method and %(voided)d voided. Going back "
            "would lose how they were paid and count the voided ones again. "
            "Nothing was changed." % lost
        )
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
