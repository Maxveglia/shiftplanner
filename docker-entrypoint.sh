#!/bin/sh
# Bring the database to the schema this image expects, then serve.
#
# Migrations run on boot deliberately: a deployment that starts serving against
# an older schema is a deployment that hands users errors, so the container
# refuses to start rather than start wrong.
set -eu

# The container runs as an unprivileged user (see the Dockerfile), and only
# root may bind a port below 1024. uvicorn would fail on that with a
# PermissionError from deep inside asyncio, several frames away from the one
# thing that explains it, so the check is here where the boot log is read.
# Railway never needs a privileged port: the public domain forwards to whatever
# this listens on, so a PORT of 80 or 443 is a misconfiguration, not a
# constraint we have to satisfy.
case "${PORT:-}" in
  '' | *[!0-9]*)
    echo "PORT must be a number; got '${PORT:-}'." >&2
    exit 1
    ;;
esac
# Length first, so that a number too big for `test` itself cannot turn this
# check into a different error message than the one it was written to give.
if [ "${#PORT}" -gt 5 ]; then
  echo "PORT is ${PORT}, which is not a port: they stop at 65535." >&2
  exit 1
fi
if [ "${PORT}" -lt 1024 ]; then
  echo "PORT is ${PORT}, and this container does not run as root, so it" >&2
  echo "cannot bind a port below 1024. Set the service's PORT to 8000 (or" >&2
  echo "anything above 1024) -- the Railway domain forwards to it either way." >&2
  exit 1
fi
# And the top end, for the typo that adds a zero: uvicorn would answer 80000
# with an OverflowError out of asyncio, which is the opaque failure this whole
# block exists to replace.
if [ "${PORT}" -gt 65535 ]; then
  echo "PORT is ${PORT}, which is not a port: they stop at 65535." >&2
  exit 1
fi

echo "==> migrating database"
alembic upgrade head

# Labour rules (US-FED, US-CA) are global reference data the scheduler reads.
# Idempotent, so it is safe on every boot.
echo "==> seeding labour profiles"
python -m app.seeds.labor

# The first back-office operator. There is no signup page for it on purpose,
# so this is the only way one comes into existence. Skipped once the variables
# are removed, and re-running never changes an existing account's password --
# unless PLATFORM_ADMIN_ROTATE_PASSWORD is set, which is how a forgotten one is
# recovered without opening a shell. Remove that variable after the deploy that
# used it; the script says so in its own output.
if [ -n "${PLATFORM_ADMIN_EMAIL:-}" ] && [ -n "${PLATFORM_ADMIN_PASSWORD:-}" ]; then
  echo "==> ensuring platform admin"
  python -m app.seeds.platform_admin
fi

echo "==> serving on :${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --proxy-headers --forwarded-allow-ips='*'
