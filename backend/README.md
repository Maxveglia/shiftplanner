# ShiftPlanner Backend (Fase 0)

Multi-tenant employee-scheduling SaaS. Phase 0 = foundations: multi-tenant auth,
data model with three invariants (versioned contracts, vacation balance as a
ledger, labor rules as data), and base CRUD. No solver / no grid yet.

Stack: Python 3.11+, FastAPI, SQLAlchemy 2.0 (sync), Pydantic v2, Alembic,
psycopg v3, PyJWT, passlib[bcrypt], PostgreSQL 16.

## Prerequisites

- Python 3.11+
- PostgreSQL 16 running locally with a superuser (default `postgres/postgres`)
  and a database named `shiftplanner`:

  ```bash
  createdb shiftplanner
  ```

## Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e .

cp .env.example .env   # adjust credentials if needed
```

Environment variables (see `.env.example`):

- `APP_DATABASE_URL` — runtime connection as the RESTRICTED role `app_user`
  (NOSUPERUSER, RLS enforced).
- `ADMIN_DATABASE_URL` — superuser connection, used ONLY by Alembic (DDL) and by
  the auth layer's pre-tenant lookups (login by globally-unique email, signup).
- `JWT_SECRET`, `JWT_ALGORITHM`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `CORS_ORIGINS`.

## Migrate

Alembic runs as the superuser and, in the initial migration, also creates the
`app_user` role, the `pgcrypto` and `btree_gist` extensions, all tables, the
EXCLUDE overlap guards, the partial-unique open-contract index, and enables
`ENABLE + FORCE ROW LEVEL SECURITY` with org-isolation policies.

```bash
alembic upgrade head
```

## Seed global labor reference data

```bash
python -m app.seeds.labor      # idempotent; seeds US-FED and US-CA
```

Per-org defaults (absence types + shift templates, jurisdiction US-FED) are
seeded automatically at signup.

## Run

```bash
uvicorn app.main:app --reload
```

- Health: `GET /health`
- API: prefix `/api/v1` (OpenAPI docs at `/docs`).

## Multi-tenancy (double barrier)

1. **App-level**: `get_current_user` resolves the tenant from the Bearer token
   and every domain query filters by `current_user.org_id`.
2. **Postgres RLS**: every tenant table has `ENABLE + FORCE ROW LEVEL SECURITY`
   and a policy `USING (org_id = current_setting('app.current_org_id', true)::uuid)`.
   Each request runs `set_config('app.current_org_id', <org>, true)` (the
   parameterizable, transaction-local form of `SET LOCAL`) at the start of its
   transaction (`app.deps.get_current_user` -> `app.db.set_current_org`). Because
   `app_user` is `NOSUPERUSER`, RLS applies to it unconditionally.

`labor_profile` / `compliance_rule` are global reference data: `GRANT SELECT` to
`app_user`, no RLS.

> Note: `signup` / `login` are the only pre-tenant operations (login is by a
> globally-unique email, before any org context exists), so they use the
> superuser (`ADMIN_DATABASE_URL`) session. All tenant domain traffic uses
> `app_user` with RLS.

## Tests

```bash
pytest
```

`tests/test_tenant_isolation.py` verifies org A cannot see org B's data. It needs
a migrated Postgres; when none is reachable it self-skips with instructions.

## Invariants recap

- **Versioned contracts**: creating a new contract closes the previous open one
  (`valid_to = new.valid_from - 1 day`); history is never rewritten. A partial
  unique index guarantees a single open contract per employee.
- **Vacation balance as ledger**: balance is the signed SUM of `vacation_ledger`
  movements. Approving a balance-consuming absence posts a negative
  `consumption` row.
- **Labor rules as data**: `labor_profile` + `compliance_rule` hold jurisdiction
  rules (US-FED, US-CA) as rows, not code.
