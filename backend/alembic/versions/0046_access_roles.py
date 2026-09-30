from __future__ import annotations

"""user_account: the three roles, the till's tablet, and ending a session;
store_sale: who charged it, by name

Revision ID: 0046_access_roles
Revises: 0045_suppliers_and_orders
Create Date: 2026-09-28

Max, 28-sep-2026: the manager gives each person of the team a login with
fewer permissions than theirs, and the till's tablet gets one of its own --
the employee's permissions without Turnos, and a session that does not
expire. Who may do what is app/access.py's table; what the database needs
is below.

* `role` is one of three: 'manager', 'employee', 'store'. It was free text
  with nothing checking it, and every door reads it: a typo in a row would be
  a login no table knows. The API only ever writes these three (signup,
  routers/accounts.py, routers/access.py).
* A 'store' login is never a person: `employee_id` is NULL on it, always. A
  tablet linked to somebody of the roster would read their rota.
* `session_epoch`: which generation of this login's sessions is valid. A
  token carries the number it was issued under (claim "sv"); app/deps.py
  refuses one whose number is no longer the row's. Changing the tablet's
  password raises it (routers/access.py), which signs out the tablet whose
  token would otherwise last ten years. 0 for every row, so every token
  already issued -- which has no claim, and reads as 0 -- stays good.
* An index on lower(email): login now compares addresses without regard to
  case (routers/auth.py), and so does the check that an address is free.
  Not UNIQUE: rows from before addresses were normalised may differ only in
  case, and refusing the migration over them would stop the deploy.

* `store_sale.created_by_name`: who charged the sale -- or typed it in --
  by name, as their account was named when it was saved. Taking somebody off
  the team now deletes their login (routers/employees.py), and `created_by`
  goes to NULL with it (ON DELETE SET NULL): without the name, every sale
  they charged would say nobody charged it, just when it matters most. Kept
  like `voided_by_name` (0043): written once, when the sale is saved
  (routers/store.py), and never changed -- 0043's `store_sale_written_once`
  already refuses it, since the column is not among the few it lets move,
  and app_user has no UPDATE on it either. The sales saved before this
  migration get the name of their account as it is now, if it is still
  there; one whose account was already gone stays NULL (nobody knows the
  name any more). That fill-in is an UPDATE of every sale, which the trigger
  refuses to anybody, the owner included: it runs between DISABLE and ENABLE
  of that trigger, in this migration's transaction, as 0043 says a later
  migration filling in a column must.

The downgrade drops both columns (`created_by_name`, `session_epoch`), the
two CHECKs and the index. It does not touch the rows: a 'store' login left behind is one
the previous code cannot describe (its Role has no 'store'), so delete them
from the Accesos screen BEFORE downgrading. The names of who charged each
sale go with the column; the previous code reads them from the login.
"""

from alembic import op

revision = "0046_access_roles"
down_revision = "0045_suppliers_and_orders"
branch_labels = None
depends_on = None

# Written out, not imported from app/access.py: a migration is a record of
# what the schema was, and must not move when the app's list does.
ROLES = ("manager", "employee", "store")

UPGRADE_STATEMENTS = [
    "ALTER TABLE user_account DROP CONSTRAINT IF EXISTS ck_user_account_role",
    "ALTER TABLE user_account ADD CONSTRAINT ck_user_account_role "
    "CHECK (role IN (%s))" % ", ".join("'%s'" % r for r in ROLES),
    "ALTER TABLE user_account DROP CONSTRAINT IF EXISTS "
    "ck_user_account_store_is_nobody",
    "ALTER TABLE user_account ADD CONSTRAINT ck_user_account_store_is_nobody "
    "CHECK (role <> 'store' OR employee_id IS NULL)",
    "ALTER TABLE user_account "
    "ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS ix_user_account_lower_email "
    "ON user_account (lower(email))",
    "ALTER TABLE store_sale ADD COLUMN IF NOT EXISTS created_by_name text",
]

# Every sale saved before this migration, with the name of its account as it
# is now -- and only if that account is still there, and of the sale's own
# business. Past the trigger that refuses any change to a sale (0043), turned
# off for this statement alone and on again in the same transaction. Apart
# from UPGRADE_STATEMENTS so a test can run it on a sale saved without a name.
BACKFILL_STATEMENTS = [
    "ALTER TABLE store_sale DISABLE TRIGGER store_sale_written_once",
    "UPDATE store_sale AS s SET created_by_name = u.full_name "
    "FROM user_account AS u "
    "WHERE u.id = s.created_by AND u.org_id = s.org_id "
    "AND s.created_by_name IS NULL",
    "ALTER TABLE store_sale ENABLE TRIGGER store_sale_written_once",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE store_sale DROP COLUMN IF EXISTS created_by_name",
    "DROP INDEX IF EXISTS ix_user_account_lower_email",
    "ALTER TABLE user_account DROP COLUMN IF EXISTS session_epoch",
    "ALTER TABLE user_account DROP CONSTRAINT IF EXISTS "
    "ck_user_account_store_is_nobody",
    "ALTER TABLE user_account DROP CONSTRAINT IF EXISTS ck_user_account_role",
]


def upgrade() -> None:
    for stmt in UPGRADE_STATEMENTS + BACKFILL_STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    for stmt in DOWNGRADE_STATEMENTS:
        op.execute(stmt)
