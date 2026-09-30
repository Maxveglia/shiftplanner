# ShiftPlanner -- one image, one service, one origin.
#
# The frontend is built here and served by the API process, so the browser
# never makes a cross-origin request: no CORS to configure, and no rebuild
# needed when the deployment's hostname changes. VITE_API_BASE_URL is set
# empty on purpose -- the clients concatenate it with "/api/v1", so an empty
# value yields a same-origin relative path.

# --- Stage 1: build the frontend ---------------------------------------------
# This stage stays root. Nothing it produces is shipped except /build/dist,
# which stage 2 copies; the builder's own user never exists at runtime, so
# dropping privileges here would buy nothing and would cost a `chown` of
# node_modules (tens of thousands of files) on every build.
FROM node:20-slim AS frontend

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ENV VITE_API_BASE_URL=""
RUN npm run build


# --- Stage 2: the API, serving that build ------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    FRONTEND_DIST=/app/static

WORKDIR /app

# The account the API actually runs as.
#
# Until this existed the container ran as root, which means any code execution
# inside it -- a dependency with a bad day, a path that reaches the filesystem,
# anything -- started with root's permissions: free to rewrite the application
# under /app, to install into site-packages, and to make whatever it changed
# survive a look around the container. None of that is needed to answer HTTP
# requests, so none of it is granted.
#
# Created BEFORE the COPY layers on purpose: this layer only changes when these
# lines change, so it caches forever and never sits between a code edit and the
# layers that follow it.
#
# The shell is a real /bin/sh rather than nologin because this service is
# diagnosed with `railway ssh`, which opens the container user's shell. Refusing
# it would take away how an incident gets looked at, and it buys nothing here:
# there is no sshd and no su inside this image, so the shell is not a way in.
#
# A high fixed uid (not the next free one) so the number is stable across
# rebuilds and cannot collide with a host user id if the image is ever run
# somewhere that maps them.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --create-home --home-dir /home/app \
            --shell /bin/sh app

# Installed from the dependency list alone first, so a code change does not
# invalidate the layer that takes the longest to build.
#
# The list is requirements.lock and not pyproject.toml, because a range is not
# a version: `pip install "."` asked PyPI what was newest at build time, so the
# image that shipped on Tuesday could not be rebuilt on Wednesday, and a
# release published by anyone in the transitive tree reached production on the
# next merge with no commit behind it. --require-hashes makes pip refuse any
# file whose bytes are not the ones somebody reviewed; it also refuses an
# unpinned requirement outright, so the lock cannot quietly go partial.
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

# --no-deps because the lock is now the only place versions come from: without
# it pip re-reads the ranges in pyproject.toml and is free to satisfy them with
# something newer than what was just installed.
COPY backend/pyproject.toml backend/README.md ./
RUN mkdir -p app && touch app/__init__.py && pip install --no-cache-dir --no-deps "." && rm -rf app

COPY backend/ ./
COPY --from=frontend /build/dist ./static

COPY docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

# Railway injects PORT. The default keeps `docker run -p 8000:8000` working.
#
# It has to stay above 1024: only root may bind a privileged port, so setting
# this to 80 or 443 would now fail at boot. Railway does not need it to -- the
# public domain forwards to whatever port the service listens on. The entrypoint
# checks it and says so rather than letting uvicorn raise a bare PermissionError.
ENV PORT=8000
EXPOSE 8000

# Everything above ran as root because building needs to: apt, pip into
# /usr/local, and the copies that land under /app. Everything below is the
# running service, and it needs none of that.
#
# Note what is deliberately NOT here: no `chown -R` of /app. The application
# does not write a single file at runtime -- no uploads, no logs to disk, no
# cache, no temp files; everything it keeps goes to Postgres, and
# PYTHONDONTWRITEBYTECODE is already set so not even __pycache__ is written --
# so the code only needs to be READABLE, which it is (mode 644, owner root).
# Leaving it owned by root is the stronger position: this process cannot modify
# the code it is running. It also keeps the image the size it was, since a
# recursive chown rewrites every file into a new layer.
USER app

ENTRYPOINT ["/usr/local/bin/entrypoint"]
