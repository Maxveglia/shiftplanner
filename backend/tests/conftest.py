"""Fixtures every test file gets."""

import pytest
from sqlalchemy import event

from app import clients
from app.clients import APP_KEYS, ClientProfile
from app.models.organization import Organization
from app.services import interview as interview_svc
from app.services import jev as jev_svc


@pytest.fixture(autouse=True)
def _gemini_not_resting():
    """Gemini's rest is per process: one test's failure must not skip the next one's call."""
    interview_svc.TURN_REST.clear()
    interview_svc.RESEARCH_REST.clear()
    jev_svc.REST.clear()
    yield
    interview_svc.TURN_REST.clear()
    interview_svc.RESEARCH_REST.clear()
    jev_svc.REST.clear()


# --- Which apps a test's business has ------------------------------------------
#
# A business is served from its folder in app/clients/, and one with no folder
# -- which is what signup makes -- gets the template: Turnos, being prepared,
# and every route of Inventario answering 403 app_not_enabled. Nearly every
# test here signs up and then uses those routes, and none of them is about
# which apps a business has.
#
# So every business a test creates is filed under a client that exists only
# while the tests run and has EVERY app there is (APP_KEYS, so a new app is
# covered the day it is added). Not under `max`: his profile is his to change, and
# taking the inventory off it must not break a suite that is not about him.
#
# Filed where the row is written -- a flush-time default on Organization -- so
# the path under test is the real one: the key is a column, get_current_user
# reads it, profile_for resolves it. Signup is the only place that creates an
# organization, and it does so through the ORM; a row INSERTed in raw SQL
# would not get the default, and would have to say its client_key itself.
#
# A test about what a business with no folder gets asks for `no_client_folder`.
# A test about a business with no app at all -- the door on every route, and
# the core that is left behind it -- files it under NO_APPS_CLIENT_KEY, the
# second client that exists only while the tests run: the template has Turnos
# now, so having no folder is no longer how a business ends up with nothing.

TEST_CLIENT_KEY = "pytest-every-app"
EVERY_APP = ClientProfile(name="Pruebas", apps=list(APP_KEYS))

NO_APPS_CLIENT_KEY = "pytest-no-apps"
NO_APPS = ClientProfile(name="Pruebas sin apps", apps=[])

_filing = {"on": True}


def _file_under_the_test_client(_mapper, _connection, target) -> None:
    if _filing["on"] and target.client_key is None:
        target.client_key = TEST_CLIENT_KEY


@pytest.fixture(autouse=True, scope="session")
def _every_business_has_every_app():
    real = clients.profiles()
    with_test_clients = {
        **real,
        TEST_CLIENT_KEY: EVERY_APP,
        NO_APPS_CLIENT_KEY: NO_APPS,
    }
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(clients, "profiles", lambda: with_test_clients)
        event.listen(Organization, "before_insert", _file_under_the_test_client)
        try:
            yield
        finally:
            event.remove(Organization, "before_insert", _file_under_the_test_client)


@pytest.fixture
def no_client_folder():
    """Businesses signed up during this test get no folder, as a real signup does."""
    _filing["on"] = False
    try:
        yield
    finally:
        _filing["on"] = True
