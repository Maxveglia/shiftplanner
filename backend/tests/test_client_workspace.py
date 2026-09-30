"""Each business is served from its client folder, and has only its apps.

Three things are pinned here:

* THE FOLDERS. Every folder in app/clients/ holds a profile that parses, the
  template is Turnos and Inventario and says it is being prepared, and a
  key with no folder falls back to the template instead of failing a request.
* THE DOORS. A business without an app gets 403 ``app_not_enabled`` on every
  route of it -- and still has the core: signing in, /auth/me, /workspace, and
  deleting its own account. A new signup has Turnos and Inventario, and
  hears that its space is being prepared; Max hears nothing of the sort.
  Neither has Tienda, and so neither has the menu: that is Casa Demo's.
* THE GUARD. Every route under /api/v1 is either core or behind the door of
  the app its router belongs to. A router added without being classified in
  app/main.py fails here, before a business without that app can reach it.

The businesses these tests sign up are filed under the all-apps client that
tests/conftest.py provides; the ones that must look like a real, brand-new
signup ask for ``no_client_folder``, and the ones about a business with no app
at all are moved to the no-apps client that conftest provides next to it.
"""
from __future__ import annotations

import logging
import re
import uuid

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app import clients
from app.access import permissions_for
from app.clients import APP_KEYS, InvalidClientFolder
from app.deps import require_app
from tests.conftest import NO_APPS_CLIENT_KEY
from tests.test_draft_on_the_server import (  # noqa: F401 - fixtures by name
    _add,
    _auth,
    client,
    skip_no_db,
)

API = "/api/v1"

# What every business has, apps or none. Written out here as well as in the
# table in app/main.py on purpose: making a router core -- reachable by a
# business that has none of its app -- is a decision, and it should take
# changing two files to make it. `menu_photos` is the menu's photos, read by
# an <img> that sends no token and so cannot be asked which apps it has
# (27-sep-2026, see routers/menu_photos.py); `inventory_photos` is the stock's
# products' photos, the same way (27-sep-2026, routers/inventory_photos.py).
# `access` is who can sign in and as what (28-sep-2026, routers/access.py):
# every business has people to let in, whatever apps it has.
CORE_ROUTERS = {
    "auth",
    "org",
    "workspace",
    "access",
    "backoffice",
    "menu_photos",
    "inventory_photos",
}

# One GET per app router that a freshly signed-up manager can call bare and get
# 200 from, by the app it belongs to. The routers whose every route needs an
# employee id (accounts, contracts, vacation) are asked about one in
# `test_with_every_app_the_doors_open`.
REPRESENTATIVE_GETS = {
    "shifts": (
        "/me/business",
        "/employees",
        "/shift-templates",
        "/absence-types",
        "/absences",
        "/labor-profiles",
        "/schedule/generate/jobs/latest",
        "/workday/balances",
        "/interview/status",
        "/profile",
        "/assistant/status",
        "/day-notes/feed",
    ),
    "inventory": ("/inventory/items", "/inventory/suppliers"),
    # The menu is the shop's since 27-sep-2026, the team's read of it included.
    "store": (
        "/menu",
        "/store/sales",
        "/store/stats?from=2026-09-01&to=2026-09-30",
        "/store/recipes",
    ),
}
EVERY_GET = tuple(path for key in APP_KEYS for path in REPRESENTATIVE_GETS[key])

# What a business with no folder is served -- every new signup -- as
# /workspace says it.
TEMPLATE_WORKSPACE = {"apps": ["shifts", "inventory"], "preparing": True}
TEMPLATE_GETS = tuple(
    path for key in TEMPLATE_WORKSPACE["apps"] for path in REPRESENTATIVE_GETS[key]
)


def _made_of(workspace: dict) -> dict:
    """What /workspace says the business is made of: its apps and whether it
    is being prepared. It also says who is asking (`role`, `permissions`,
    since 28-sep-2026): checked where the test is about who asks, and in
    tests/test_access_roles.py."""
    return {"apps": workspace["apps"], "preparing": workspace["preparing"]}


def _asked_by(workspace: dict, role: str) -> bool:
    return (workspace["role"], workspace["permissions"]) == (role, permissions_for(role))


# --- The folders --------------------------------------------------------------


def _write(folder, body: str) -> None:
    folder.mkdir()
    (folder / "client.json").write_text(body, encoding="utf-8")


class TestFolders:
    def test_every_client_folder_has_a_valid_profile(self):
        found = clients.read_folders()
        on_disk = {
            p.name
            for p in clients.CLIENTS_DIR.iterdir()
            if p.is_dir() and not p.name.startswith(("_", "."))
        }
        assert set(found) == on_disk
        for key in found:
            assert clients.CLIENT_KEY_PATTERN.fullmatch(key), key

    def test_the_template_is_both_apps_being_prepared(self):
        """What a business nobody has set up gets: the rota and the inventory
        it can use from the first minute, and word that the rest of its space
        -- what is built for it, in its own folder -- is on its way."""
        for profile in (
            clients.read_profile(clients.TEMPLATE_DIR),
            clients.template(),
            clients.profile_for(None),
        ):
            assert profile.apps == ["shifts", "inventory"]
            assert profile.preparing is True

    def test_max_keeps_the_two_apps_he_had(self):
        """The promise of the migration that filed his businesses under `max`:
        the day it shipped, he saw exactly what he saw the day before.

        His profile is his to change. If an app comes off it on purpose, this is
        the test to update -- nothing else in the suite depends on his folder.
        And his space is not being prepared: that message is not for him.
        """
        profile = clients.read_folders()["max"]
        assert profile.apps == ["shifts", "inventory"]
        assert profile.preparing is False

    def test_casa_demo_has_the_shop_and_is_still_being_prepared(self):
        """The restaurant Max asked Tienda for on 27-sep-2026: its folder, its
        three apps in the order it sees them, and word that the rest is on its
        way. The one profile with `store` in it, for now."""
        profile = clients.read_folders()["casa-demo"]
        assert profile.name == "Casa Demo"
        assert profile.apps == ["shifts", "inventory", "store"]
        assert profile.preparing is True

    def test_a_key_with_no_folder_gets_the_template_and_a_warning(self, caplog):
        key = "gone-%s" % uuid.uuid4().hex[:8]
        with caplog.at_level(logging.WARNING, logger="app.clients"):
            profile = clients.profile_for(key)
        assert profile == clients.template()
        assert key in caplog.text

    def test_preparing_is_off_unless_the_profile_says_so(self, tmp_path):
        """A field of the profile, not a consequence of having no folder: a
        client with a folder of its own can be preparing, and one that does not
        mention it is not."""
        _write(tmp_path / "quiet", '{"name": "Q", "apps": ["shifts"]}')
        _write(tmp_path / "busy", '{"name": "B", "apps": ["shifts"], "preparing": true}')
        _write(tmp_path / "ready", '{"name": "R", "apps": [], "preparing": false}')
        found = clients.read_folders(tmp_path)
        assert {key: p.preparing for key, p in found.items()} == {
            "quiet": False,
            "busy": True,
            "ready": False,
        }

    @pytest.mark.parametrize(
        "body",
        [
            '{"name": "X", "apps": ["shifts"], "colour": "red"}',
            '{"name": "X", "apps": ["payroll"]}',
            '{"name": "X", "apps": ["shifts", "inventory", "shifts"]}',
            '{"name": "", "apps": []}',
            '{"apps": []}',
            '{"name": "X", "apps": [}',
            '{"name": "X", "apps": [], "preparing": "true"}',
            '{"name": "X", "apps": [], "preparing": 1}',
            '{"name": "X", "apps": [], "preparing": null}',
            '{"name": "X", "apps": [], "Preparing": true}',
        ],
        ids=[
            "unknown-field",
            "unknown-app",
            "app-twice",
            "no-name",
            "name-missing",
            "not-json",
            "preparing-a-string",
            "preparing-a-number",
            "preparing-null",
            "preparing-misspelt",
        ],
    )
    def test_a_bad_profile_is_refused_not_degraded(self, tmp_path, body):
        _write(tmp_path / "somebody", body)
        with pytest.raises(InvalidClientFolder, match="somebody"):
            clients.read_folders(tmp_path)

    def test_a_folder_without_a_profile_is_refused(self, tmp_path):
        (tmp_path / "somebody").mkdir()
        with pytest.raises(InvalidClientFolder, match="client.json"):
            clients.read_folders(tmp_path)

    @pytest.mark.parametrize("name", ["Somebody", "some_body", "-somebody"])
    def test_a_folder_the_database_could_never_point_at_is_refused(self, tmp_path, name):
        _write(tmp_path / name, '{"name": "X", "apps": []}')
        with pytest.raises(InvalidClientFolder):
            clients.read_folders(tmp_path)

    def test_underscored_and_hidden_folders_are_not_clients(self, tmp_path):
        _write(tmp_path / "_template", '{"name": "T", "apps": []}')
        (tmp_path / "__pycache__").mkdir()
        (tmp_path / ".cache").mkdir()
        _write(tmp_path / "somebody", '{"name": "S", "apps": ["inventory"]}')
        assert set(clients.read_folders(tmp_path)) == {"somebody"}

    def test_a_door_for_an_app_that_does_not_exist_stops_the_boot(self):
        with pytest.raises(ValueError):
            require_app("payroll")


# --- The doors ----------------------------------------------------------------


def _signup(client) -> dict:
    resp = client.post(
        API + "/auth/signup",
        json={
            "org_name": "Workspace Co %s" % uuid.uuid4().hex[:6],
            "email": "owner+%s@example.com" % uuid.uuid4().hex[:8],
            "password": "s3cret-pass",
            "full_name": "Owner",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _file_under(org_id: str, client_key) -> None:
    """Move a business to another folder, the way the back office will."""
    from app.db import admin_engine

    with admin_engine.begin() as conn:
        conn.execute(
            text("UPDATE organization SET client_key = :key WHERE id = :org"),
            {"key": client_key, "org": org_id},
        )


def _login(client, email: str) -> dict:
    resp = client.post(
        API + "/auth/login", json={"email": email, "password": "s3cret-pass"}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _staff(client, manager_token: str) -> str:
    """An employee with a login; returns its email."""
    employee = _add(client, manager_token, "Ana")
    email = "staff+%s@example.com" % uuid.uuid4().hex[:8]
    account = client.post(
        API + "/employees/%s/account" % employee["id"],
        headers=_auth(manager_token),
        json={"email": email, "password": "s3cret-pass"},
    )
    assert account.status_code == 201, account.text
    return account.json()["email"]


def _refused(resp) -> bool:
    return resp.status_code == 403 and resp.json()["detail"]["code"] == "app_not_enabled"


def _sweep(client, headers, apps) -> tuple:
    """Every gated route of `apps`, whatever its method and parameters.

    The door is a router-level dependency, so it runs before the route looks
    at its path, query or body -- which is why a made-up id and no body at all
    are enough, and why the answer must be the door's and never a 404 or a 422
    from behind it. Returns the paths it tried and the requests that got past.
    """
    tried, through = set(), []
    for method, path, app_key in _gated_routes():
        if app_key not in apps:
            continue
        tried.add(path)
        url = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), path)
        resp = client.request(method, url, headers=headers)
        if not _refused(resp):
            through.append("%s %s -> %s %s" % (method, path, resp.status_code, resp.text[:120]))
    return tried, through


@skip_no_db
class TestANewSignup:
    """A business as signup makes it: no folder, so the template -- Turnos
    and Inventario, and word that its space is being prepared."""

    @pytest.fixture
    def fresh(self, client, no_client_folder):
        return _signup(client)

    def test_signup_login_me_and_workspace_all_say_so(self, client, fresh):
        assert fresh["user"]["apps"] == ["shifts", "inventory"]
        assert fresh["user"]["preparing"] is True
        headers = _auth(fresh["access_token"])
        me = client.get(API + "/auth/me", headers=headers)
        assert me.status_code == 200
        assert (me.json()["apps"], me.json()["preparing"]) == (["shifts", "inventory"], True)
        workspace = client.get(API + "/workspace", headers=headers)
        assert workspace.status_code == 200
        assert _made_of(workspace.json()) == TEMPLATE_WORKSPACE
        assert _asked_by(workspace.json(), "manager")
        assert fresh["user"]["permissions"] == permissions_for("manager")
        again = _login(client, fresh["user"]["email"])["user"]
        assert (again["apps"], again["preparing"]) == (["shifts", "inventory"], True)

    def test_both_apps_answer(self, client, fresh):
        """Being prepared is a message, not a lock: the rota and the inventory
        work meanwhile. The shop -- sales, statistics and the menu -- is not
        one of them."""
        headers = _auth(fresh["access_token"])
        for path in TEMPLATE_GETS:
            resp = client.get(API + path, headers=headers)
            assert resp.status_code == 200, (path, resp.text)
        for path in REPRESENTATIVE_GETS["store"]:
            assert _refused(client.get(API + path, headers=headers)), path

    def test_an_employee_reads_the_same_workspace(self, client, fresh):
        """The team signs in to the same business, so to the same answer."""
        session = _login(client, _staff(client, fresh["access_token"]))
        assert (session["user"]["apps"], session["user"]["preparing"]) == (
            ["shifts", "inventory"],
            True,
        )
        headers = _auth(session["access_token"])
        workspace = client.get(API + "/workspace", headers=headers).json()
        assert _made_of(workspace) == TEMPLATE_WORKSPACE
        assert _asked_by(workspace, "employee")
        # No Tienda, so no menu to read: the door is the business's, not the
        # manager's.
        assert _refused(client.get(API + "/menu", headers=headers))


@skip_no_db
class TestWithoutApps:
    """A business with no app switched on: every door shut, the core open.

    No real folder is like that -- the template has Turnos -- so it is filed
    under the no-apps client tests/conftest.py provides for the purpose.
    """

    @pytest.fixture
    def bare(self, client):
        session = _signup(client)
        _file_under(session["user"]["org_id"], NO_APPS_CLIENT_KEY)
        return session

    def test_the_core_still_answers(self, client, bare):
        headers = _auth(bare["access_token"])
        me = client.get(API + "/auth/me", headers=headers)
        assert me.status_code == 200
        assert (me.json()["apps"], me.json()["preparing"]) == ([], False)
        workspace = client.get(API + "/workspace", headers=headers)
        assert workspace.status_code == 200
        assert _made_of(workspace.json()) == {"apps": [], "preparing": False}
        assert _login(client, bare["user"]["email"])["user"]["apps"] == []

    def test_every_route_of_every_app_is_refused(self, client, bare):
        """The sweep: every gated route, whatever its method and parameters."""
        _tried, through = _sweep(client, _auth(bare["access_token"]), set(APP_KEYS))
        assert not through, "\n".join(through)

    def test_the_account_can_still_be_deleted(self, client, bare):
        headers = _auth(bare["access_token"])
        name = bare["user"]["org_name"]
        res = client.request("DELETE", API + "/org", json={"confirm": name}, headers=headers)
        assert res.status_code == 204, res.text
        assert client.get(API + "/auth/me", headers=headers).status_code == 401

    def test_an_employee_is_refused_too(self, client):
        """The door is about what the business has, not about who is asking."""
        owner = _signup(client)
        email = _staff(client, owner["access_token"])
        _file_under(owner["user"]["org_id"], NO_APPS_CLIENT_KEY)

        session = _login(client, email)
        assert session["user"]["apps"] == []
        headers = _auth(session["access_token"])
        assert _made_of(client.get(API + "/workspace", headers=headers).json()) == {
            "apps": [],
            "preparing": False,
        }
        assert _refused(client.get(API + "/me/business", headers=headers))


@skip_no_db
class TestWithEveryApp:
    def test_signup_login_and_me_list_every_app(self, client):
        session = _signup(client)
        assert session["user"]["apps"] == list(APP_KEYS)
        assert session["user"]["preparing"] is False
        assert _login(client, session["user"]["email"])["user"]["apps"] == list(APP_KEYS)
        me = client.get(API + "/auth/me", headers=_auth(session["access_token"]))
        assert me.json()["apps"] == list(APP_KEYS)
        workspace = client.get(API + "/workspace", headers=_auth(session["access_token"]))
        assert _made_of(workspace.json()) == {"apps": list(APP_KEYS), "preparing": False}

    def test_with_every_app_the_doors_open(self, client):
        session = _signup(client)
        headers = _auth(session["access_token"])
        for path in EVERY_GET:
            resp = client.get(API + path, headers=headers)
            assert resp.status_code == 200, (path, resp.text)

        employee = _add(client, session["access_token"], "Ana")
        for path in ("/account", "/contracts", "/vacation-balance"):
            resp = client.get(API + "/employees/%s%s" % (employee["id"], path), headers=headers)
            assert not _refused(resp), (path, resp.text)
            assert resp.status_code in (200, 404), (path, resp.text)

    def test_and_the_same_business_without_them_is_refused(self, client):
        """The same requests, the same business, one column changed."""
        session = _signup(client)
        headers = _auth(session["access_token"])
        _file_under(session["user"]["org_id"], NO_APPS_CLIENT_KEY)
        for path in EVERY_GET:
            assert _refused(client.get(API + path, headers=headers)), path

    def test_an_employee_reads_the_same_workspace(self, client):
        owner = _signup(client)
        session = _login(client, _staff(client, owner["access_token"]))
        assert session["user"]["apps"] == list(APP_KEYS)
        workspace = client.get(API + "/workspace", headers=_auth(session["access_token"]))
        assert _made_of(workspace.json()) == {"apps": list(APP_KEYS), "preparing": False}


@skip_no_db
class TestFiling:
    def test_a_business_filed_under_max_gets_what_his_profile_says(self, client):
        """From the column to a real folder on disk -- whatever that folder says."""
        session = _signup(client)
        _file_under(session["user"]["org_id"], "max")
        headers = _auth(session["access_token"])
        profile = clients.read_folders()["max"]
        me = client.get(API + "/auth/me", headers=headers).json()
        assert (me["apps"], me["preparing"]) == (profile.apps, profile.preparing)
        workspace = client.get(API + "/workspace", headers=headers).json()
        assert _made_of(workspace) == {"apps": profile.apps, "preparing": profile.preparing}

    def test_the_menu_is_the_shops_not_the_stocks(self, client):
        """With no folder -- the template: Turnos and Inventario -- the menu is
        shut and the stock is open; filed under Casa Demo, the shop opens with
        it. Same business, one column changed. (Not Max's folder: what his has
        is his to change, and this is not a test about him.)"""
        session = _signup(client)
        headers = _auth(session["access_token"])
        _file_under(session["user"]["org_id"], None)
        assert _refused(client.get(API + "/menu", headers=headers))
        assert _refused(client.get(API + "/store/sales", headers=headers))
        assert client.get(API + "/inventory/items", headers=headers).status_code == 200

        _file_under(session["user"]["org_id"], "casa-demo")
        assert _made_of(client.get(API + "/workspace", headers=headers).json()) == {
            "apps": ["shifts", "inventory", "store"],
            "preparing": True,
        }
        for path in REPRESENTATIVE_GETS["store"] + ("/inventory/items",):
            resp = client.get(API + path, headers=headers)
            assert resp.status_code == 200, (path, resp.text)

    def test_a_key_with_no_folder_is_the_template_not_an_error(self, client):
        session = _signup(client)
        _file_under(session["user"]["org_id"], "gone-%s" % uuid.uuid4().hex[:8])
        headers = _auth(session["access_token"])
        workspace = client.get(API + "/workspace", headers=headers)
        assert workspace.status_code == 200
        assert _made_of(workspace.json()) == TEMPLATE_WORKSPACE
        assert client.get(API + "/inventory/items", headers=headers).status_code == 200

    def test_a_business_with_its_own_folder_can_still_be_preparing(self, client, monkeypatch):
        """`preparing` is read from the profile the business is filed under,
        not inferred from its having none: this one has a folder, both apps,
        and is still being set up."""
        key = "pytest-own-%s" % uuid.uuid4().hex[:8]
        busy = clients.ClientProfile(name="En obras", apps=list(APP_KEYS), preparing=True)
        filed = clients.profiles()
        monkeypatch.setattr(clients, "profiles", lambda: {**filed, key: busy})

        session = _signup(client)
        _file_under(session["user"]["org_id"], key)
        headers = _auth(session["access_token"])
        assert _made_of(client.get(API + "/workspace", headers=headers).json()) == {
            "apps": list(APP_KEYS),
            "preparing": True,
        }
        assert _login(client, session["user"]["email"])["user"]["preparing"] is True
        assert client.get(API + "/inventory/items", headers=headers).status_code == 200

    @pytest.mark.parametrize("key", ["Max", "../x", "", "_template", "a" * 41, "max/"])
    def test_the_database_refuses_a_key_that_is_not_a_folder_name(self, client, key):
        session = _signup(client)
        with pytest.raises(IntegrityError, match="ck_organization_client_key"):
            _file_under(session["user"]["org_id"], key)

    @pytest.mark.parametrize("key", ["max", "bar-2", "a" * 40])
    def test_and_takes_one_that_is(self, client, key):
        session = _signup(client)
        _file_under(session["user"]["org_id"], key)

    def test_the_runtime_role_can_read_the_column(self, client):
        """`app_user` reads it on every request, through RLS like the rest of the row."""
        from app.db import app_engine

        session = _signup(client)
        org_id = session["user"]["org_id"]
        with app_engine.begin() as conn:
            conn.execute(
                text("SELECT set_config('app.current_org_id', :org, true)"),
                {"org": org_id},
            )
            key = conn.execute(
                text("SELECT client_key FROM organization WHERE id = :org"),
                {"org": org_id},
            ).scalar_one()
        assert key is not None


# --- The guard ----------------------------------------------------------------


def _api_routes():
    """Every API route as the application serves it, doors included.

    FastAPI 0.14x keeps an included router as one lazy entry in `app.routes`
    and builds each route's effective dependencies -- the router-level door
    among them -- on demand; `iter_route_contexts` walks those. Older versions
    flattened them into `app.routes` directly, which is the fallback.
    """
    from app.main import app

    try:
        from fastapi.routing import iter_route_contexts
    except ImportError:  # pragma: no cover - older FastAPI
        routes = app.routes
    else:
        routes = iter_route_contexts(app.routes)
    for route in routes:
        if not isinstance(getattr(route, "original_route", route), APIRoute):
            continue
        if route.path.startswith(API + "/"):
            yield route


def _doors(dependant) -> list:
    """The app keys of every `require_app` anywhere in a route's dependencies."""
    found = []
    for dep in dependant.dependencies:
        key = getattr(dep.call, "app_key", None)
        if key is not None:
            found.append(key)
        found.extend(_doors(dep))
    return found


def _gated_routes():
    for route in _api_routes():
        for key in _doors(route.dependant):
            for method in sorted(route.methods):
                yield method, route.path, key


class TestGuard:
    def test_every_route_is_core_or_behind_the_door_of_its_app(self):
        from app.main import CORE, ROUTERS

        table = {module.__name__: key for module, key in ROUTERS}
        problems = []
        for route in _api_routes():
            module = route.endpoint.__module__
            where = "%s %s (%s)" % (",".join(sorted(route.methods)), route.path, module)
            if module not in table:
                problems.append(
                    "%s: its router is not in the table in app/main.py -- say "
                    "which app it belongs to, or that it is core" % where
                )
                continue
            doors = _doors(route.dependant)
            expected = table[module]
            if expected is CORE:
                if doors:
                    problems.append("%s: core, but behind %s" % (where, doors))
            elif doors != [expected]:
                problems.append(
                    "%s: belongs to %r but is behind %s" % (where, expected, doors)
                )
        assert not problems, "\n".join(problems)

    def test_the_core_is_what_this_file_says_it_is(self):
        from app.main import CORE, ROUTERS

        core = {m.__name__.rsplit(".", 1)[-1] for m, key in ROUTERS if key is CORE}
        assert core == CORE_ROUTERS

    def test_the_guard_sees_the_doors(self):
        """A guard on the guard: a walk that finds no routes passes everything."""
        keys = [key for _m, _p, key in _gated_routes()]
        assert len(keys) > 50
        assert set(keys) == set(APP_KEYS)
