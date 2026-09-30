from __future__ import annotations

from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import clients
from app.body_limit import BodySizeLimitMiddleware
from app.config import settings
from app.deps import require_app
from app.security_headers import SecurityHeadersMiddleware, unhandled_error_response
from app.services import generation_worker
from app.spa import mount_frontend
from app.routers import (
    absence_types,
    absences,
    access,
    accounts,
    assistant,
    auth,
    backoffice,
    business_profile,
    contracts,
    day_notes,
    employees,
    inventory,
    inventory_photos,
    inventory_suppliers,
    labor_profiles,
    me,
    menu,
    menu_photos,
    org,
    interview,
    pay_policy,
    recipes,
    schedule,
    shift_templates,
    store,
    vacation,
    workday,
    workspace,
)

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Room for the requests that hold a thread for minutes.

    Every /schedule endpoint is a plain ``def``, so FastAPI runs it in anyio's
    thread pool -- and generating a calendar sits in that thread for the whole
    time the model is writing, which is minutes, not milliseconds. The pool
    defaults to 40 threads for the entire application, so enough managers
    generating at once exhausts it and what stops answering is not generation:
    it is login, the employee list, everything. The threads are parked on a
    socket rather than burning CPU, so raising the ceiling costs memory for
    stacks and nothing else.

    This is a ceiling, not a target: nothing allocates threads it does not use.
    """
    anyio.to_thread.current_default_thread_limiter().total_tokens = (
        settings.request_thread_limit
    )

    # The planners. Background threads in this container rather than a second
    # service: the image that serves the API is the image that plans, so a
    # worker can never be at a different commit than the schema it writes.
    #
    # They are started here and stopped on the way out, and a job in flight at
    # shutdown is deliberately NOT waited for -- the row goes stale and another
    # worker resumes it, which is better than holding a redeploy for the
    # minutes a month takes. See services/generation_worker.py.
    stop_workers, worker_threads = generation_worker.start()
    try:
        yield
    finally:
        stop_workers.set()
        for thread in worker_threads:
            # Short join on purpose: this is "say goodbye", not "wait for the
            # model". Daemon threads, so the process exits regardless.
            thread.join(timeout=1.0)


app = FastAPI(title="ShiftPlanner API", version="0.1.0", lifespan=lifespan)

# ORDER MATTERS, and it is the reverse of how it reads. Starlette makes the
# LAST middleware added the outermost one, so adding the body limit first puts
# it INSIDE CORS -- which is where it belongs: its 413 then goes out through
# CORSMiddleware and carries the headers without which a browser reports "a
# network error" instead of the code we took the trouble to send.
app.add_middleware(BodySizeLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# And this one OUTERMOST, which is why it is added last. It is the only
# position from which the headers also reach the two responses this stack
# writes without ever reaching a route: the CORS preflight, and the 413 the
# body limit sends on its own. A security header missing from exactly the
# responses the machinery generates is the kind of gap nobody finds by reading
# a route. See app/security_headers.py.
app.add_middleware(SecurityHeadersMiddleware)

# OUTERMOST IS STILL NOT EVERYTHING, and the comment above used to claim it
# was. Starlette wraps the whole user middleware list in its own
# ServerErrorMiddleware, so an exception nobody handled is turned into a 500
# OUTSIDE every middleware here -- that response went out with no headers on
# it whatsoever. No ordering fixes it, because the order is what is being
# wrapped. The handler registered for Exception is the one
# ServerErrorMiddleware uses, so that is where those headers have to be put
# on, and this one changes nothing else about the answer: same body, same
# content type, same traceback in the log.
app.add_exception_handler(Exception, unhandled_error_response)

API_PREFIX = "/api/v1"

# Every client's profile, read now: one that does not parse stops the boot here,
# with its path in the traceback, instead of reaching a customer as a product
# with no apps in it. See app/clients/__init__.py.
clients.load_all()

# WHICH APP EACH ROUTER BELONGS TO -- the one place that says so.
#
# A business only has the apps its client folder switches on (app/clients/),
# and a router that belongs to an app is included behind that app's door
# (`require_app`): a business without it gets 403 `app_not_enabled` on every
# route of the router, including the ones added to it later.
#
# CORE is what every business has, apps or none: signing in, the account
# itself (`org` holds DELETE /org, which a business must be able to do however
# it is set up), asking what the workspace has, and the back office, which is
# not a business at all -- its own login, its own token scope. And the photos
# of the menu's dishes and of the stock's products, which are read by an <img>
# with no token at all: the door is a question about the signed-in user, and
# there is none (see routers/menu_photos.py and routers/inventory_photos.py
# for what keeps them private instead).
#
# In registration order, which is the order Starlette matches in; the four
# routers under /employees have to stay in the order they had.
#
# A router included anywhere else, outside this table, is behind no door and
# fails tests/test_client_workspace.py, which checks every route under
# /api/v1 against it.
CORE = None
ROUTERS = (
    (auth, CORE),
    (me, "shifts"),
    (org, CORE),
    (pay_policy, "shifts"),
    (workspace, CORE),
    # Accesos: who can sign in to the business, and as what -- the manager's
    # window onto the team's logins and the till's tablets
    # (routers/access.py). Not one app's: every business has people to let in.
    (access, CORE),
    (employees, "shifts"),
    (accounts, "shifts"),
    (contracts, "shifts"),
    (shift_templates, "shifts"),
    (absence_types, "shifts"),
    (absences, "shifts"),
    (vacation, "shifts"),
    (labor_profiles, "shifts"),
    (schedule, "shifts"),
    (workday, "shifts"),
    (interview, "shifts"),
    (business_profile, "shifts"),
    (assistant, "shifts"),
    (inventory, "inventory"),
    # Inventario > Proveedores: who the products are bought from, and the
    # phone their orders go to (routers/inventory_suppliers.py).
    (inventory_suppliers, "inventory"),
    (day_notes, "shifts"),
    # The menu is the shop's, not the stock's: it moved from Inventario to
    # Tienda (27-sep-2026) with its tables untouched. The team's read of it,
    # GET /menu, moved with it -- an employee of a business without Tienda
    # has no menu to read.
    (menu, "store"),
    # GET /menu/photos/{id}: no token, so no door. Matched after the menu's
    # own routes, none of which is a GET under /photos.
    (menu_photos, CORE),
    # GET /inventory/photos/{id}: the stock's products' photos, the same way
    # (routers/inventory_photos.py). No token, so no door. Matched after the
    # inventory's own routes, none of which is under /photos.
    (inventory_photos, CORE),
    (store, "store"),
    # Tienda > Recetas: what each product is made of. The shop's, behind its
    # door; it also needs Inventario (the ingredients are its products), and
    # says so from inside each route -- one door per router, see
    # routers/recipes.py.
    (recipes, "store"),
    (backoffice, CORE),
)

for _module, _app_key in ROUTERS:
    if _app_key is CORE:
        app.include_router(_module.router, prefix=API_PREFIX)
    else:
        app.include_router(
            _module.router,
            prefix=API_PREFIX,
            dependencies=[Depends(require_app(_app_key))],
        )
del _module, _app_key


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# LAST. This claims "/", and Starlette matches routes in registration order,
# so everything above must already be mounted. Returns False when no build is
# present, which is the normal case in local development where Vite serves the
# frontend on its own port.
SERVING_FRONTEND = mount_frontend(app)
