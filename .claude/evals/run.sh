#!/usr/bin/env bash
# Run the project's test suite and the `check` blocks of every eval case, and
# write .claude/evals/results/{timestamp}.json (plus latest.json) with pass/fail.
# Format of the cases: .claude/evals/README.md.
#
#   .claude/evals/run.sh                 suite + every case
#   .claude/evals/run.sh --cases-only    skip the suite (fast loop while editing a skill)
#   .claude/evals/run.sh --only NAME     only the cases of one skill or agent
#
# Exit code: 0 when the suite is green (failing cases are information, not an
# error: a known gap fails its case on purpose), 1 when the suite is red.
#
# Database: uses ADMIN_DATABASE_URL / APP_DATABASE_URL when both are set.
# Otherwise, if Postgres answers on localhost, creates a throwaway database
# with the same grants as infra/initdb and drops it at the end. Without either,
# the backend runs without one and the result says "bd": false -- about 90
# tests skip themselves then, so a green suite proves much less.
#
# Written for macOS /bin/bash 3.2 as well as Linux.

set -uo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
EVALS="$ROOT/.claude/evals"
RESULTS="$EVALS/results"
STAMP="$(date +%Y-%m-%dT%H%M%S)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sp-evals.XXXXXX")"
CHECK_TIMEOUT=300

run_suite=1
only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --cases-only) run_suite=0 ;;
    --only) only="${2:-}"; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$RESULTS"
say() { printf '%s\n' "$*" >&2; }
with_timeout() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec: $!"' "$s" "$@"; }

# --- Python and Node --------------------------------------------------------

SP_PY="$ROOT/backend/.venv/bin/python"
if [ ! -x "$SP_PY" ] || ! (cd "$ROOT/backend" && "$SP_PY" -c 'import app, pytest' 2>/dev/null); then
  say "· backend sin entorno: creando backend/.venv"
  venv="$ROOT/backend/.venv"
  if python3 -m venv "$venv" 2>/dev/null; then
    "$venv/bin/pip" install -q -e "$ROOT/backend[dev]" >&2 || say "  no pude instalar el backend"
  elif command -v uv >/dev/null; then
    # Images without python3-venv; the cloud one ships uv.
    uv venv -q "$venv" && VIRTUAL_ENV="$venv" uv pip install -q -e "$ROOT/backend[dev]" >&2 \
      || say "  no pude instalar el backend"
  else
    say "  no hay python3-venv ni uv: sigo sin backend"
  fi
fi
export SP_PY

if [ ! -d "$ROOT/frontend/node_modules" ]; then
  say "· frontend sin node_modules: npm ci"
  (cd "$ROOT/frontend" && npm ci --no-audit --no-fund >&2) || say "  npm ci falló"
fi

# --- Database ----------------------------------------------------------------

db=false
own_db=""
cleanup() {
  if [ -n "$own_db" ]; then
    psql -h localhost -U "$PG_SUPER" -d postgres -qc "DROP DATABASE IF EXISTS $own_db" >/dev/null 2>&1
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

PG_SUPER="${SP_PG_SUPERUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# A cloud session (the weekly routine) has PostgreSQL 16 installed but not
# running, and the environment snapshot never keeps a server running, so it is
# started here on every run. Ubuntu's postgres role has no password, and this
# script connects over TCP with one: setting it again is harmless.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ] && [ -z "${ADMIN_DATABASE_URL:-}" ]; then
  for bin in /usr/lib/postgresql/*/bin; do [ -d "$bin" ] && PATH="$PATH:$bin"; done
  if ! pg_isready -h localhost -q 2>/dev/null; then
    say "· nube: arrancando PostgreSQL"
    service postgresql start >/dev/null 2>&1 || sudo -n service postgresql start >/dev/null 2>&1
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      pg_isready -h localhost -q 2>/dev/null && break
      sleep 1
    done
  fi
  su postgres -c "psql -qc \"ALTER USER postgres PASSWORD '$PGPASSWORD'\"" >/dev/null 2>&1 \
    || sudo -n -u postgres psql -qc "ALTER USER postgres PASSWORD '$PGPASSWORD'" >/dev/null 2>&1 \
    || say "  no pude poner contraseña al rol postgres"
fi

if [ -n "${ADMIN_DATABASE_URL:-}" ] && [ -n "${APP_DATABASE_URL:-}" ]; then
  db=true
elif command -v pg_isready >/dev/null && pg_isready -h localhost -q 2>/dev/null; then
  own_db="sp_evals_$(date +%s)_$$"
  if psql -h localhost -U "$PG_SUPER" -d postgres -qc "CREATE DATABASE $own_db" >/dev/null 2>&1 \
     && sed "s/ON DATABASE shiftplanner /ON DATABASE $own_db /" "$ROOT/infra/initdb/01-app-role.sql" \
        | psql -h localhost -U "$PG_SUPER" -d "$own_db" -q -v ON_ERROR_STOP=1 >/dev/null 2>&1; then
    export ADMIN_DATABASE_URL="postgresql+psycopg://$PG_SUPER:$PGPASSWORD@localhost:5432/$own_db"
    export APP_DATABASE_URL="postgresql+psycopg://app_user:app_pass@localhost:5432/$own_db"
    if (cd "$ROOT/backend" && "$SP_PY" -m alembic upgrade head >"$TMP/alembic.log" 2>&1); then
      db=true
    else
      say "· alembic upgrade falló (ver abajo); sigo sin base de datos"
      tail -5 "$TMP/alembic.log" >&2
      unset ADMIN_DATABASE_URL APP_DATABASE_URL
    fi
  else
    say "· no pude crear la base $own_db; sigo sin base de datos"
    own_db=""
  fi
fi
say "· base de datos: $db"

# --- Suite ---------------------------------------------------------------------

backend_json='null'; tsc_json='null'; vitest_json='null'; suite_ok=true

if [ "$run_suite" = 1 ]; then
  say "· backend: pytest"
  t0=$(date +%s)
  (cd "$ROOT/backend" && "$SP_PY" -m pytest -q -p no:cacheprovider --junitxml="$TMP/backend.xml" \
      >"$TMP/backend.log" 2>&1)
  rc=$?
  backend_json="$("$SP_PY" - "$TMP/backend.xml" "$rc" "$(( $(date +%s) - t0 ))" <<'PY'
import json, sys, xml.etree.ElementTree as ET
path, rc, secs = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
try:
    root = ET.parse(path).getroot()
    suites = [root] if root.tag == "testsuite" else list(root)
    total = sum(int(s.get("tests", 0)) for s in suites)
    failed = sum(int(s.get("failures", 0)) for s in suites)
    errors = sum(int(s.get("errors", 0)) for s in suites)
    skipped = sum(int(s.get("skipped", 0)) for s in suites)
    names = [f'{c.get("classname")}::{c.get("name")}'
             for s in suites for c in s.iter("testcase")
             if c.find("failure") is not None or c.find("error") is not None]
except Exception as exc:  # no junit: pytest never started
    total = failed = skipped = 0; errors = 1; names = [f"sin junit: {exc}"]
print(json.dumps({"ok": rc == 0, "total": total, "passed": total - failed - errors - skipped,
                  "failed": failed, "errors": errors, "skipped": skipped,
                  "fallos": names[:30], "segundos": secs}))
PY
)"
  [ "$rc" = 0 ] || suite_ok=false

  say "· frontend: tsc --noEmit"
  if (cd "$ROOT/frontend" && npx tsc --noEmit >"$TMP/tsc.log" 2>&1); then
    tsc_json='{"ok": true}'
  else
    tsc_json="$(jq -n --arg e "$(tail -20 "$TMP/tsc.log")" '{ok: false, errores: $e}')"
    suite_ok=false
  fi

  say "· frontend: vitest"
  (cd "$ROOT/frontend" && npx vitest run --reporter=json --outputFile="$TMP/vitest.json" \
      >"$TMP/vitest.log" 2>&1)
  rc=$?
  if [ -s "$TMP/vitest.json" ]; then
    vitest_json="$(jq --argjson rc "$rc" '{
        ok: ($rc == 0), total: .numTotalTests, passed: .numPassedTests,
        failed: .numFailedTests, skipped: (.numPendingTests + .numTodoTests),
        fallos: [.testResults[] | .assertionResults[]? | select(.status == "failed") | .fullName][:30]
      }' "$TMP/vitest.json")"
  else
    vitest_json="$(jq -n --arg e "$(tail -20 "$TMP/vitest.log")" '{ok: false, errores: $e}')"
  fi
  [ "$rc" = 0 ] || suite_ok=false
fi

# --- Cases ---------------------------------------------------------------------

: > "$TMP/cases.jsonl"
for case_file in "$EVALS"/*/cases/*.md; do
  [ -f "$case_file" ] || continue
  owner="$(basename "$(dirname "$(dirname "$case_file")")")"
  [ -n "$only" ] && [ "$owner" != "$only" ] && continue
  id="$owner/$(basename "$case_file" .md)"
  title="$(sed -n '1s/^# *//p' "$case_file")"

  # Every ```check block, in order.
  rm -f "$TMP"/check.*
  awk -v dir="$TMP" '
    /^```check[[:space:]]*$/ { n++; inside = 1; next }
    inside && /^```[[:space:]]*$/ { inside = 0; next }
    inside { print > (dir "/check." n) }
  ' "$case_file"

  status="pendiente"; detail=""; t0=$(date +%s)
  n=1
  [ -f "$TMP/check.1" ] && status="pasa"
  while [ -f "$TMP/check.$n" ]; do
    (cd "$ROOT" && SP_EVALS=1 with_timeout "$CHECK_TIMEOUT" bash -euo pipefail "$TMP/check.$n") \
      >"$TMP/check.out" 2>&1
    rc=$?
    if [ "$rc" = 77 ]; then status="sin_bd"; detail="necesita Postgres"; break; fi
    if [ "$rc" != 0 ]; then
      status="falla"
      detail="$(tail -15 "$TMP/check.out")"
      [ "$rc" = 142 ] && detail="tiempo agotado (${CHECK_TIMEOUT} s)"
      break
    fi
    n=$((n + 1))
  done
  jq -nc --arg id "$id" --arg de "$owner" --arg titulo "$title" --arg estado "$status" \
        --arg detalle "$detail" --argjson segundos "$(( $(date +%s) - t0 ))" \
        '{id: $id, de: $de, titulo: $titulo, estado: $estado, detalle: $detalle, segundos: $segundos}' \
        >> "$TMP/cases.jsonl"
  say "  $(printf '%-9s' "$status") $id"
done

# --- Result ------------------------------------------------------------------------

out="$RESULTS/$STAMP.json"
jq -s \
  --arg fecha "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg commit "$(git -C "$ROOT" rev-parse --short HEAD)" \
  --arg rama "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" \
  --argjson bd "$db" --argjson suite_ok "$suite_ok" --argjson con_suite "$run_suite" \
  --argjson backend "$backend_json" --argjson tsc "$tsc_json" --argjson vitest "$vitest_json" \
  '{
     fecha: $fecha, commit: $commit, rama: $rama, bd: $bd,
     suite: (if $con_suite == 1
             then {ok: $suite_ok, backend: $backend, frontend_tsc: $tsc, frontend_tests: $vitest}
             else null end),
     casos: .,
     resumen: {
       suite_ok: (if $con_suite == 1 then $suite_ok else null end),
       casos: (reduce .[] as $c ({pasa: 0, falla: 0, sin_bd: 0, pendiente: 0};
                                 .[$c.estado] += 1))
     }
   }' "$TMP/cases.jsonl" > "$out"
cp "$out" "$RESULTS/latest.json"

jq -r '
  "",
  "Resultado: \(input_filename)",
  (if .suite then
     "  suite \(if .suite.ok then "OK" else "EN ROJO" end) · bd=\(.bd)"
     + " · pytest \(.suite.backend.passed // "?")/\(.suite.backend.total // "?") (\(.suite.backend.skipped // "?") saltados)"
     + " · tsc \(if .suite.frontend_tsc.ok then "ok" else "falla" end)"
     + " · vitest \(.suite.frontend_tests.passed // "?")/\(.suite.frontend_tests.total // "?")"
   else "  suite: no ejecutada (--cases-only)" end),
  "  casos: \(.resumen.casos.pasa) pasan · \(.resumen.casos.falla) fallan · \(.resumen.casos.pendiente) pendientes de subagente · \(.resumen.casos.sin_bd) sin bd"
' "$out" >&2

[ "$suite_ok" = true ]
