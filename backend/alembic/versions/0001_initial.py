from __future__ import annotations

"""initial schema: tables, extensions, exclude constraints, RLS, roles

Revision ID: 0001_initial
Revises:
Create Date: 2026-08-31

Hand-written migration. Creates the required Postgres extensions, the restricted
runtime role (app_user), all 11 tables, EXCLUDE constraints (overlap guards), the
partial-unique open-contract index, RLS (ENABLE + FORCE) with org-isolation
policies on tenant tables, and SELECT grants on the global reference tables.
"""

from alembic import op

from app.config import settings

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


# Tenant-scoped tables and the column that carries the tenant key.
# organization is keyed by its own id; every other tenant table by org_id.
TENANT_TABLES = [
    ("organization", "id"),
    ("user_account", "org_id"),
    ("employee", "org_id"),
    ("contract", "org_id"),
    ("shift_template", "org_id"),
    ("absence_type", "org_id"),
    ("absence", "org_id"),
    ("vacation_ledger", "org_id"),
    ("assignment", "org_id"),
]

GLOBAL_TABLES = ["labor_profile", "compliance_rule"]


def _quote_literal(value: str) -> str:
    """Single-quoted SQL literal. CREATE ROLE ... PASSWORD takes no bind params."""
    return "'%s'" % value.replace("'", "''")


# Created if missing, and its password set every time. Setting it
# unconditionally is what makes rotation possible: on a redeploy the role
# already exists, so a CREATE-only statement would leave an old password in
# place and quietly diverge from APP_DB_PASSWORD.
_APP_USER_DDL = """
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
            CREATE ROLE app_user LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
    END
    $$;
    ALTER ROLE app_user WITH LOGIN PASSWORD %s NOSUPERUSER NOCREATEDB NOCREATEROLE;
""" % _quote_literal(settings.app_db_password)


DDL_STATEMENTS = [
    # --- Extensions ---------------------------------------------------------
    "CREATE EXTENSION IF NOT EXISTS pgcrypto",
    "CREATE EXTENSION IF NOT EXISTS btree_gist",
    # --- Restricted runtime role -------------------------------------------
    _APP_USER_DDL,
    "GRANT USAGE ON SCHEMA public TO app_user",
    # --- Tables -------------------------------------------------------------
    """
    CREATE TABLE organization (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL,
        jurisdiction_code text NOT NULL DEFAULT 'US-FED',
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE employee (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        external_id text NOT NULL,
        full_name text NOT NULL,
        email text,
        employment_status text NOT NULL,
        hire_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_employee_org_external UNIQUE (org_id, external_id)
    )
    """,
    "CREATE INDEX ix_employee_org_id ON employee(org_id)",
    """
    CREATE TABLE user_account (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        email text NOT NULL UNIQUE,
        hashed_password text NOT NULL,
        full_name text NOT NULL,
        role text NOT NULL,
        employee_id uuid REFERENCES employee(id) ON DELETE SET NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_user_account_org_id ON user_account(org_id)",
    """
    CREATE TABLE contract (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        employment_type text NOT NULL,
        base_annual_salary numeric(12, 2),
        hourly_rate numeric(10, 2),
        min_hours_per_week numeric(6, 2) NOT NULL,
        max_hours_per_week numeric(6, 2),
        valid_from date NOT NULL,
        valid_to date,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_contract_org_id ON contract(org_id)",
    "CREATE INDEX ix_contract_employee_id ON contract(employee_id)",
    (
        "CREATE UNIQUE INDEX uq_one_open_contract_per_employee "
        "ON contract(employee_id) WHERE valid_to IS NULL"
    ),
    """
    CREATE TABLE shift_template (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        unpaid_break_minutes integer NOT NULL,
        color text NOT NULL,
        is_night boolean NOT NULL,
        is_weekend_premium boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_shift_template_org_id ON shift_template(org_id)",
    """
    CREATE TABLE absence_type (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        name text NOT NULL,
        code text NOT NULL,
        is_paid boolean NOT NULL,
        consumes_balance boolean NOT NULL,
        requires_approval boolean NOT NULL,
        is_health_data boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_absence_type_org_id ON absence_type(org_id)",
    """
    CREATE TABLE absence (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        absence_type_id uuid NOT NULL REFERENCES absence_type(id) ON DELETE RESTRICT,
        during tstzrange NOT NULL,
        status text NOT NULL,
        note text,
        approver_id uuid REFERENCES user_account(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT absence_no_overlap_approved
            EXCLUDE USING gist (employee_id WITH =, during WITH &&)
            WHERE (status = 'approved')
    )
    """,
    "CREATE INDEX ix_absence_org_id ON absence(org_id)",
    "CREATE INDEX ix_absence_employee_id ON absence(employee_id)",
    """
    CREATE TABLE vacation_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        movement_type text NOT NULL,
        days numeric(6, 2) NOT NULL,
        effective_date date NOT NULL,
        reason text,
        source_absence_id uuid REFERENCES absence(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX ix_vacation_ledger_org_id ON vacation_ledger(org_id)",
    "CREATE INDEX ix_vacation_ledger_employee_id ON vacation_ledger(employee_id)",
    """
    CREATE TABLE assignment (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
        employee_id uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
        during tstzrange NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        source text NOT NULL DEFAULT 'manual',
        computed_cost numeric(12, 2),
        is_overtime boolean NOT NULL DEFAULT false,
        is_premium boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT assignment_no_overlap
            EXCLUDE USING gist (employee_id WITH =, during WITH &&)
            WHERE (status <> 'archived')
    )
    """,
    "CREATE INDEX ix_assignment_org_id ON assignment(org_id)",
    "CREATE INDEX ix_assignment_employee_id ON assignment(employee_id)",
    # --- Global reference tables (no org_id, no RLS) ------------------------
    """
    CREATE TABLE labor_profile (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        jurisdiction_code text NOT NULL UNIQUE,
        name text NOT NULL,
        parent_code text,
        effective_date date NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE compliance_rule (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        profile_id uuid NOT NULL REFERENCES labor_profile(id) ON DELETE CASCADE,
        rule_type text NOT NULL,
        threshold numeric(8, 2),
        unit text NOT NULL,
        reference_window text NOT NULL,
        computation_method text,
        hardness text NOT NULL,
        premium_multiplier numeric(4, 2),
        notes text
    )
    """,
    "CREATE INDEX ix_compliance_rule_profile_id ON compliance_rule(profile_id)",
]


def upgrade() -> None:
    for stmt in DDL_STATEMENTS:
        op.execute(stmt)

    # --- Grants + RLS on tenant tables -------------------------------------
    for table, key in TENANT_TABLES:
        op.execute(
            "GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO app_user" % table
        )
        op.execute("ALTER TABLE %s ENABLE ROW LEVEL SECURITY" % table)
        # FORCE so the policy also applies to the table owner path; app_user is
        # NOSUPERUSER so it is subject to RLS regardless.
        op.execute("ALTER TABLE %s FORCE ROW LEVEL SECURITY" % table)
        op.execute(
            "CREATE POLICY org_isolation ON %(t)s "
            "USING (%(k)s = current_setting('app.current_org_id', true)::uuid) "
            "WITH CHECK (%(k)s = current_setting('app.current_org_id', true)::uuid)"
            % {"t": table, "k": key}
        )

    # --- Global reference tables: read-only for app_user, no RLS -----------
    for table in GLOBAL_TABLES:
        op.execute("GRANT SELECT ON %s TO app_user" % table)


def downgrade() -> None:
    for table, _key in TENANT_TABLES:
        op.execute("DROP POLICY IF EXISTS org_isolation ON %s" % table)

    for table in [
        "compliance_rule",
        "labor_profile",
        "assignment",
        "vacation_ledger",
        "absence",
        "absence_type",
        "shift_template",
        "contract",
        "user_account",
        "employee",
        "organization",
    ]:
        op.execute("DROP TABLE IF EXISTS %s CASCADE" % table)
