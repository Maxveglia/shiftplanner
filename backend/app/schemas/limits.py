"""How long a thing a client sends may be.

THE PROBLEM. Every ``str`` in these schemas was unbounded, and so was every
column behind one: SQLAlchemy's ``String`` with no length is ``TEXT`` in
Postgres. So a name could be a megabyte, a note could be a novel, and the only
thing standing between a bored person with curl and a full disk was nothing at
all. The same holds for the lists -- one element of ``PublishIn.shifts`` is one
row inserted, and a list with no ceiling is a database filled by one request.

WHERE THE NUMBERS COME FROM. The biggest roster this product plans for is 50
people (a single site; above that a business runs more than one). Everything
here is sized at roughly five times whatever that business actually does, so
the limit is a wall for an attacker and invisible to a customer. A limit a real
manager can hit is a support ticket, and we would rather have the ticket from
the attacker.

WHY CONSTANTS RATHER THAN A NUMBER AT EACH FIELD. The same kind of field turns
up in seven files -- a person's name is in ``EmployeeCreate``, in ``SignupIn``
and in the back office -- and three different ceilings for one kind of field is
how a form starts accepting what the API refuses. Name the kind, not the site.

WHY ONLY THE INPUT SCHEMAS CARRY THESE. An ``*Out`` model is built from a row
with ``model_validate``, which validates -- so a ceiling on an output is a
ceiling on what can be READ BACK, and any row already longer than it (written
before this file existed, or by the model: ``research_notes`` is prose an LLM
wrote) would turn a perfectly good record into a 500 on the way out. Bound what
comes in. What is already stored has to keep coming out.
"""
from __future__ import annotations

# A person's name, a workspace's name, a shift template's name. Long enough for
# a full Spanish name with both surnames and then some; five times what a form
# field on screen will ever hold.
NAME = 200

# What the till's tablet is called on the Accesos screen ("Barra", "Terraza"):
# a label, not a person's name, so shorter than NAME -- it is shown in a list
# row next to its address.
STORE_ACCOUNT_NAME = 80

# RFC 5321 caps an address at 254 characters, so this is the protocol's own
# ceiling rather than one of ours. Nothing legitimate is longer.
EMAIL = 254

# A short machine-ish token typed or picked from a list: an employee code, a
# jurisdiction, a vertical, an objective, a colour, where a shift came from.
# These are compared against known values anyway -- the length is only here so
# the comparison is not done against a megabyte.
CODE = 64

# The floor is the one ``schemas/account.py`` already enforced for an employee
# login, applied now to the OWNER's password too -- the account that can delete
# the organization was the one with no rule at all.
#
# The ceiling is not a security limit (bcrypt reads the first 72 bytes and
# ignores the rest, see ``app/security.py``); it is there so a password field
# cannot be used to post a megabyte. It sits well above 72 bytes on purpose:
# refusing a long passphrase for a reason we do not explain is worse than
# hashing a prefix of it, which is what we have always done.
PASSWORD_MIN = 8
PASSWORD_MAX = 128

# One line a manager types about one thing: why somebody is off, mostly.
NOTE = 2_000

# One adjustment typed at a calendar -- "give Ana Fridays off". Typed once and
# sent twice: to `/schedule/refine`, which turns it into operations, and with
# those operations to `/profile/observations`, which asks whether it states a
# rule. One ceiling for both, so a sentence the first accepted is never refused
# by the second.
ADJUSTMENT = 4_000

# What a manager writes about their own business, free-form, in a textarea they
# can paste into.
NOTES = 20_000

# Prose a MODEL wrote and the manager may edit and send back: the interview
# summary, the research summary. It is one of the things the planning context
# carries, so its ceiling is well under PLAN_CONTEXT below.
PROSE = 40_000

# The whole snapshot the client builds for a replan: the requirements, the
# roster, who is away, and up to MAX_LISTED_SHIFTS shifts already on the
# calendar. Measured by running ``buildPlanContext``, not guessed -- 14 people
# spend 38k characters, 20 with a long brief 41k, and the 50-person roster this
# product plans for 41.6k. Three times the worst case measured, because the
# thing that decides what a replan costs is MAX_LISTED_SHIFTS on the client,
# and a ceiling here that bites would refuse the replan in pydantic's English.
PLAN_CONTEXT = 120_000

# One month of shifts for the biggest roster we plan for, with room:
# 50 people x 31 days x 3 shifts a day = 4,650, rounded up. A business running
# split shifts uses two of those three; nobody uses all three every day.
SHIFTS = 5_000

# Refine operations applied in one session. A manager adjusting a month makes
# tens of these, not hundreds; 500 is the wall, not the workload.
OPS = 500

# The roster and the template book, as the generator is told about them. 250 is
# five times the 50-person ceiling; 100 templates is more shift patterns than a
# hospitality site has hours in a day.
EMPLOYEES = 250
TEMPLATES = 100

# Products in one business's inventory. A bar carries a few hundred lines, a
# small shop a thousand or two; five times the second is still a wall only a
# script would reach, and one count sends every product once.
INVENTORY_ITEMS = 5_000

# Sections and dishes on one business's menu. A long carta has ten sections and
# a hundred-odd dishes, drinks included; these are the wall, not the workload,
# and they bound what one `GET /menu` sends to every phone of the team.
MENU_SECTIONS = 50
MENU_DISHES = 500

# Lines on one sale typed in by hand. A table's bill is a dozen lines and a
# whole day typed as one sale, dish by dish, a hundred-odd; each line is a row
# inserted, so this is the wall on what one save can write.
STORE_SALE_LINES = 200

# Why a sale was voided: one short line ("cobrada dos veces"), not a note. The
# column's CHECK says the same number (migration 0043).
VOID_REASON = 200

# Addresses the day notes are shared with. A handful in practice -- partners,
# a second manager, the head of each shift; 100 is a wall, and also the free
# tier's daily email allowance, so one send can never exceed it alone.
DAY_NOTE_READERS = 100
