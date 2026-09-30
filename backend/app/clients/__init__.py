"""One folder per business: what each customer's ShiftPlanner is made of.

THE IDEA. Every customer gets software shaped to them -- their menu, their
statistics, their inventory, their calendar -- and they share only the look.
One product, one deployment, one database; what differs lives in a folder,
``app/clients/<client_key>/``, and ``organization.client_key`` (0034) says
which folder a business is filed under.

THE FICHA. Each folder holds a ``client.json``: for now, the business's name,
the apps it has switched on, and whether its space is still being prepared.
It is read once per process and checked strictly -- an unknown field, an
unknown app, an app listed twice, a ``preparing`` that is not a JSON boolean, a
folder whose name the database would refuse -- and a bad one stops the boot
(see ``load_all``, called from ``app.main``). A broken file degrading quietly
into "this business has no apps" is the failure this module is built to make
impossible: the customer would see an empty product and nobody would know why.

PREPARING. A flag in the profile, not a consequence of having no folder: while
it is on, the launcher greets the business with "your space is being prepared"
-- above its apps, which work as usual. A business can have a folder of its
own and still be preparing while we build what is its; the day it is ready,
the flag comes off in that business's profile and nowhere else.

THE TEMPLATE. ``_template/`` is what a business with no folder gets: Turnos
and Inventario, and ``preparing`` on. That is where every new signup starts --
with a rota and a stock count it can use from the first minute, told that what
is built for it is on its way -- and it is
also the answer, with a warning in the log and never a 500, for a
``client_key`` whose folder is not in this build. The underscore is what marks
it as not-a-client: the database refuses a key that starts with one, so no
business can ever be filed under it by name.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Literal, Mapping, Optional, Tuple, get_args

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    ValidationError,
    field_validator,
)

logger = logging.getLogger(__name__)

# The apps there are. The same keys as `AppKey` in frontend/src/lib/apps.ts,
# which is what the browser mounts screens by; a key only one side knows is an
# app nobody can open. Turnos, Inventario and Tienda (sales, their statistics
# and the menu).
AppKey = Literal["shifts", "inventory", "store"]
APP_KEYS: Tuple[str, ...] = get_args(AppKey)

CLIENTS_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = CLIENTS_DIR / "_template"
PROFILE_FILE = "client.json"

# What organization.client_key may hold -- the CHECK in 0034, repeated here so
# a folder the database could never point at fails the boot instead of sitting
# in the build unreachable. Lower case, digits and hyphens: it is a directory
# name on every filesystem the repo is checked out on, and a path segment that
# can never be `..`.
CLIENT_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


class InvalidClientFolder(RuntimeError):
    """A client folder the product cannot serve. Raised at boot, on purpose."""


class ClientProfile(BaseModel):
    """A client's profile: ``app/clients/<key>/client.json``.

    Frozen, and shared by every request for that business -- so nothing may
    edit one in place. Callers that hand the apps on copy the list.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    # In the order the business sees them: the launcher lists them this way.
    apps: List[AppKey]
    # Its space is still being set up: the launcher says so on the way in.
    # Strict -- a JSON true or false, nothing else: `"no"`, `0` or `null` stop
    # the boot instead of being read as whatever the lax parse would make of
    # them. Absent is false: a business that is ready says nothing.
    preparing: StrictBool = False

    @field_validator("apps")
    @classmethod
    def _each_app_once(cls, apps: List[str]) -> List[str]:
        repeated = sorted({a for a in apps if apps.count(a) > 1})
        if repeated:
            raise ValueError("listed more than once: %s" % ", ".join(repeated))
        return apps


def read_profile(folder: Path) -> ClientProfile:
    """The profile in `folder`, checked. Uncached: see `profiles` for the cache."""
    path = folder / PROFILE_FILE
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise InvalidClientFolder("%s has no %s" % (folder, PROFILE_FILE)) from None
    try:
        return ClientProfile.model_validate_json(raw)
    except ValidationError as exc:
        raise InvalidClientFolder("%s is not a valid profile:\n%s" % (path, exc)) from None


def read_folders(root: Path = CLIENTS_DIR) -> Dict[str, ClientProfile]:
    """Every client folder under `root`, by key, read and checked.

    A folder is a client unless its name starts with ``_`` or ``.`` -- which
    leaves out the template, ``__pycache__`` and whatever an editor leaves
    behind. Anything else is a client and must be a valid one: a folder with no
    profile is a mistake, not a folder to skip.
    """
    found: Dict[str, ClientProfile] = {}
    for folder in sorted(root.iterdir()):
        if not folder.is_dir() or folder.name.startswith(("_", ".")):
            continue
        if not CLIENT_KEY_PATTERN.fullmatch(folder.name):
            raise InvalidClientFolder(
                "%s: a client folder is named like organization.client_key "
                "(%s), or no business can ever be filed under it"
                % (folder, CLIENT_KEY_PATTERN.pattern)
            )
        found[folder.name] = read_profile(folder)
    return found


@lru_cache(maxsize=1)
def profiles() -> Mapping[str, ClientProfile]:
    """Every client's profile, read from disk once per process."""
    return read_folders()


@lru_cache(maxsize=1)
def template() -> ClientProfile:
    """What a business with no folder gets."""
    return read_profile(TEMPLATE_DIR)


@lru_cache(maxsize=None)
def _warn_no_folder(client_key: str) -> None:
    # Once per key and process, not once per request: the point is that
    # somebody notices, and a line on every request is how a line stops being
    # read.
    logger.warning(
        "organization filed under client_key=%r, which has no folder in "
        "app/clients/: serving the template",
        client_key,
    )


def profile_for(client_key: Optional[str]) -> ClientProfile:
    """The profile this business is served from.

    No key is the normal case for a business nobody has set up yet, and gets
    the template. A key with no folder is a mistake -- a folder renamed, or a
    database ahead of the build -- and gets the template too, with a warning:
    the customer sees a space being prepared rather than an error page, and
    the log says why.
    """
    if client_key is None:
        return template()
    profile = profiles().get(client_key)
    if profile is None:
        _warn_no_folder(client_key)
        return template()
    return profile


def load_all() -> None:
    """Read every profile now, so a broken one stops the boot, not a request."""
    template()
    profiles()
