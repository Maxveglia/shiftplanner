# ShiftPlanner -- Makefile de orquestacion local (Fase 0)
#
# Convenciones:
#   - Postgres se levanta con docker-compose (servicio 'postgres', puerto 5432).
#   - El backend vive en backend/ (Python FastAPI, venv en backend/.venv).
#   - El frontend vive en frontend/ (React + Vite).
#
# Requisitos: docker (o docker compose), python3.11+, node 18+.

.DEFAULT_GOAL := help

# Permite 'docker compose' (v2) o 'docker-compose' (v1).
COMPOSE ?= docker compose

BACKEND_DIR := backend
FRONTEND_DIR := frontend
VENV := $(BACKEND_DIR)/.venv
PY := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
LOCK := $(BACKEND_DIR)/requirements.lock

.PHONY: help
help:
	@echo "ShiftPlanner -- targets disponibles:"
	@echo ""
	@echo "  Base de datos (Postgres via docker-compose):"
	@echo "    make db-up             Levanta Postgres 16 en segundo plano (puerto 5432)"
	@echo "    make db-down           Para Postgres (conserva el volumen de datos)"
	@echo "    make db-reset          Para Postgres y BORRA el volumen de datos"
	@echo ""
	@echo "  Backend (backend/):"
	@echo "    make backend-install   Crea venv e instala dependencias"
	@echo "    make backend-migrate   Aplica migraciones Alembic (usa ADMIN_DATABASE_URL)"
	@echo "    make backend-seed      Siembra datos globales de referencia (labor profiles)"
	@echo "    make backend-bootstrap-admin  Crea la cuenta de back office (una vez)"
	@echo "    make backend-run       Arranca FastAPI (uvicorn) en :8000 con reload"
	@echo "    make backend-lock      Regenera backend/requirements.lock (tras tocar pyproject.toml)"
	@echo ""
	@echo "  Frontend (frontend/):"
	@echo "    make frontend-install  Instala dependencias npm"
	@echo "    make frontend-run      Arranca Vite dev server en :5173"
	@echo ""
	@echo "    make dev               Muestra el orden recomendado de arranque"

# -----------------------------------------------------------------------------
# Base de datos
# -----------------------------------------------------------------------------
.PHONY: db-up
db-up:
	$(COMPOSE) up -d postgres

.PHONY: db-down
db-down:
	$(COMPOSE) stop postgres

.PHONY: db-reset
db-reset:
	$(COMPOSE) down -v

# -----------------------------------------------------------------------------
# Backend
# -----------------------------------------------------------------------------
.PHONY: backend-install
backend-install:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip
	$(PIP) install -e "$(BACKEND_DIR)[dev]"

.PHONY: backend-migrate
backend-migrate:
	cd $(BACKEND_DIR) && .venv/bin/alembic upgrade head

.PHONY: backend-seed
backend-seed:
	cd $(BACKEND_DIR) && .venv/bin/python -m app.seeds.labor

# Crea la cuenta del BACK OFFICE (la tuya, la del dueno de la plataforma).
# No hay signup publico para esto a proposito: esa cuenta ve a todos los
# clientes, asi que solo se crea con acceso al despliegue.
#   PLATFORM_ADMIN_EMAIL=tu@ejemplo.com PLATFORM_ADMIN_PASSWORD='...' make backend-bootstrap-admin
.PHONY: backend-bootstrap-admin
backend-bootstrap-admin:
	cd $(BACKEND_DIR) && .venv/bin/python -m app.seeds.platform_admin

# Olvidaste la contrasena del back office. Cambia PLATFORM_ADMIN_PASSWORD y
# ejecuta esto: es lo unico que reescribe la de una cuenta que ya existe.
.PHONY: backend-rotate-admin-password
backend-rotate-admin-password:
	cd $(BACKEND_DIR) && .venv/bin/python -m app.seeds.platform_admin --rotate

.PHONY: backend-run
backend-run:
	cd $(BACKEND_DIR) && .venv/bin/uvicorn app.main:app --reload --port 8000

# Regenera el lock con el que se construye la imagen. Editar un rango en
# pyproject.toml ya no cambia nada por si solo: hasta que esto no se ejecuta y
# el resultado no se commitea, la imagen sigue instalando las versiones viejas.
#
# Existe como target, y no como una linea en el README que cada uno copia, por
# la plataforma: la imagen es python:3.11-slim sobre Linux x86_64 y aqui casi
# todos estamos en un Mac. Resolver en el Mac elige ruedas de macOS (y se deja
# greenlet, que SQLAlchemy solo pide en x86_64/aarch64), y eso no falla en los
# tests: falla en el build del deploy. Los dos flags que lo evitan viven aqui.
#
#   make backend-lock                          # solo lo que obligue pyproject.toml
#   make backend-lock UPGRADE="-P anthropic"   # sube un paquete dentro de su rango
#   make backend-lock UPGRADE="--upgrade"      # re-resuelve el arbol entero
#
# Sin UPGRADE, uv usa el propio lock como preferencias y no arrastra paquetes
# ajenos al cambio. La cabecera del fichero es a mano y `uv pip compile -o` la
# borraria, asi que se corta por el centinela, se guarda y se vuelve a pegar.
UPGRADE ?=
.PHONY: backend-lock
backend-lock:
	@command -v uv >/dev/null 2>&1 || { \
	  echo "Falta uv. Instalalo con 'pipx install uv' o 'brew install uv'."; exit 1; }
	@awk '{ print } /^# >>> line and keeps this header/ { exit }' $(LOCK) > $(LOCK).head
	@awk 'p { print } /^# >>> line and keeps this header/ { p = 1 }' $(LOCK) > $(LOCK).body
	uv pip compile --python-version 3.11 \
	  --python-platform x86_64-unknown-linux-gnu \
	  --generate-hashes --no-header $(UPGRADE) \
	  $(BACKEND_DIR)/pyproject.toml -o $(LOCK).body
	@cat $(LOCK).head $(LOCK).body > $(LOCK)
	@rm -f $(LOCK).head $(LOCK).body
	@echo ""
	@echo "Lee el diff antes de commitear: git diff -- $(LOCK)"

# -----------------------------------------------------------------------------
# Frontend
# -----------------------------------------------------------------------------
.PHONY: frontend-install
frontend-install:
	cd $(FRONTEND_DIR) && npm install

.PHONY: frontend-run
frontend-run:
	cd $(FRONTEND_DIR) && npm run dev

# -----------------------------------------------------------------------------
# Orden de arranque para desarrollo
# -----------------------------------------------------------------------------
.PHONY: dev
dev:
	@echo "Orden recomendado de arranque en local:"
	@echo ""
	@echo "  1) make db-up            # levanta Postgres (espera a que quede 'healthy')"
	@echo "  2) make backend-install  # solo la primera vez"
	@echo "  3) make backend-migrate  # crea schema, extensiones, RLS"
	@echo "  4) make backend-seed     # siembra labor profiles globales (US-FED, US-CA)"
	@echo "  4b) make backend-bootstrap-admin  # tu cuenta de back office (/backoffice/login)"
	@echo "  5) make backend-run      # FastAPI en http://localhost:8000"
	@echo ""
	@echo "  En otra terminal:"
	@echo "  6) make frontend-install # solo la primera vez"
	@echo "  7) make frontend-run     # Vite en http://localhost:5173"
	@echo ""
	@echo "  Recuerda: copia .env.example -> backend/.env y frontend/.env antes del paso 3."
