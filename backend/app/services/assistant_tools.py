"""What the business assistant can look up, and what it is never shown.

The assistant's tools are CUSTOM tools: declared on the agent (``backend/
assistant/agent.yaml``), and carried out HERE, in our backend, when the agent
asks. Anthropic's container never touches our database and never holds a
credential for it -- it emits ``agent.custom_tool_use``, we answer with
``user.custom_tool_result``, and what we answer is the only thing it learns.

That makes this file the assistant's whole view of a business, and it is
built as one:

* READ ONLY, by construction. Five functions, each a SELECT. There is no tool
  that writes, so there is no instruction -- from the manager, from a memory,
  from a line of text in a profile -- that could make the assistant change a
  calendar. When the manager wants a change, the assistant is told to say
  what to type in the brief box, and the manager types it.
* ONE ORGANISATION, by construction. The org comes from the caller's token
  and is passed in by the router; no tool takes an org, an employee id, or
  anything else that names a row. The session is also behind ``org_isolation``
  like every tenant query.
* NO NAMES. Every person is written as their stable alias (``assistant_
  privacy``), and every result is run through ``People.mask`` before it leaves,
  so a name hiding in free text -- a rule the manager typed, a template called
  after somebody -- is caught by the same table as the manager's own message.
* NOTHING PRIVATE. No pay, no cost, no contract, no absence, no reason. The
  calendar is the PUBLISHED one, shifts only -- not who is off or why. Profile
  prose is sent sentence by sentence with any sentence about pay, contracts,
  leave, health or family dropped (``planner_notes.SENSITIVE``, the planner's
  own list). A rule the manager confirmed goes through the same filter.
* BOUNDED. A period is at most ``MAX_DAYS``; a result is cut at
  ``MAX_RESULT_CHARS``. A model that asks for a year gets told to ask for less.

The input the model sends is validated here and refused with a message it can
read and recover from -- a bad date is an ``is_error`` result, never a 500.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Dict, List, Mapping, Optional, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.services import business_profile as bp
from app.services import planner_notes as pn
from app.services.assistant_privacy import People

# The longest period one call may describe. Two months is enough to compare
# one month with the next; a year of shifts is tens of thousands of tokens the
# model would read to answer one question.
MAX_DAYS = 62
# Past this a result is cut, and says so. The platform itself offloads results
# over 100,000 characters to a file; ours never get near that.
MAX_RESULT_CHARS = 20_000
DEFAULT_TZ = "Europe/Madrid"

_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class ToolInputError(Exception):
    """The model asked for something we refuse. The text goes back to it."""


@dataclass
class ToolContext:
    """Everything a tool may use, fixed by the router before the turn."""

    org_id: UUID
    people: People
    tz: str = DEFAULT_TZ
    today: Optional[date] = None


def zone(name: Optional[str]) -> ZoneInfo:
    """The manager's zone, or Madrid. Never raises: a browser that sends
    nonsense gets the product's home zone rather than an error."""
    try:
        return ZoneInfo(str(name or DEFAULT_TZ))
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        return ZoneInfo(DEFAULT_TZ)


def safe_prose(text: Optional[str], limit: int = 1500) -> str:
    """Profile prose without any sentence about pay, contracts, leave, health
    or family. Masking is done once, on the whole result."""
    if not text or not str(text).strip():
        return ""
    sentences = re.split(r"(?<=[.!?;])\s+|\n+", str(text).strip())
    kept = [s.strip() for s in sentences if s.strip() and not pn.SENSITIVE.search(s)]
    return " ".join(kept)[:limit]


def _date(value: object, field: str) -> date:
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except (TypeError, ValueError):
        raise ToolInputError("%s must be a date as YYYY-MM-DD, got %r." % (field, value))


def _hhmm(dt: datetime) -> str:
    return dt.strftime("%H:%M")


# --- the tools ------------------------------------------------------------------


def get_published_schedule(db: Session, ctx: ToolContext, args: Mapping) -> str:
    """The published shifts between two dates, inclusive, in the manager's zone."""
    from app.models.shift_template import ShiftTemplate
    from app.services import schedule as schedule_svc

    start = _date(args.get("start_date"), "start_date")
    end = _date(args.get("end_date"), "end_date")
    if end < start:
        raise ToolInputError("end_date is before start_date.")
    if (end - start).days + 1 > MAX_DAYS:
        raise ToolInputError(
            "At most %d days per call. Ask for a shorter period, or for two." % MAX_DAYS
        )
    tz = zone(ctx.tz)
    lo = datetime.combine(start, time.min, tzinfo=tz).astimezone(timezone.utc)
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    shifts = schedule_svc.list_published(db, ctx.org_id, lo, hi)
    templates: Dict[UUID, str] = {
        t.id: t.name
        for t in db.execute(select(ShiftTemplate).where(ShiftTemplate.org_id == ctx.org_id)).scalars()
    }

    by_day: Dict[date, List[Tuple[datetime, str]]] = {}
    hours: Dict[str, float] = {}
    count: Dict[str, int] = {}
    for a in shifts:
        lower = getattr(a.during, "lower", None)
        upper = getattr(a.during, "upper", None)
        if lower is None or upper is None:
            continue
        s, e = lower.astimezone(tz), upper.astimezone(tz)
        who = ctx.people.alias(a.employee_id)
        label = "%s %s-%s" % (who, _hhmm(s), _hhmm(e))
        name = templates.get(a.shift_template_id) if a.shift_template_id else None
        if name:
            label += " (%s)" % name
        by_day.setdefault(s.date(), []).append((s, label))
        paid = max(0.0, (e - s).total_seconds() / 3600.0 - (a.unpaid_break_minutes or 0) / 60.0)
        hours[who] = hours.get(who, 0.0) + paid
        count[who] = count.get(who, 0) + 1

    lines = [
        "Published calendar from %s to %s, times in %s. Only published shifts; "
        "drafts, absences and pay are not part of this." % (start.isoformat(), end.isoformat(), tz.key)
    ]
    if not by_day:
        lines.append("Nothing is published in this period.")
        return "\n".join(lines)
    empty: List[str] = []
    d = start
    while d <= end:
        day = by_day.get(d)
        tag = "%s %s" % (d.isoformat(), _WEEKDAYS[d.weekday()])
        if day:
            lines.append("%s: %s" % (tag, ", ".join(label for _, label in sorted(day))))
        else:
            empty.append(tag)
        d += timedelta(days=1)
    if empty:
        lines.append("Days with nobody published: %s." % ", ".join(empty))
    lines.append(
        "Paid hours per person in the period: %s."
        % "; ".join(
            "%s %.1f h in %d shift%s" % (who, hours[who], count[who], "" if count[who] == 1 else "s")
            for who in sorted(hours, key=lambda w: (-hours[w], w))
        )
    )
    return "\n".join(lines)


def get_team(db: Session, ctx: ToolContext, args: Mapping) -> str:
    """Who is on the roster (as aliases), and the business's shift templates."""
    from app.models.employee import Employee
    from app.models.shift_template import ShiftTemplate
    from app.services.employees import LIVE

    live = list(
        db.execute(
            select(Employee.id).where(Employee.org_id == ctx.org_id).where(LIVE)
        ).scalars()
    )
    aliases = sorted(ctx.people.alias(i) for i in live)
    lines = [
        "People on the roster: %d. Each is shown by an alias; the manager's "
        "screen shows their name in its place." % len(aliases)
    ]
    if aliases:
        lines.append(", ".join(aliases) + ".")
    templates = list(
        db.execute(
            select(ShiftTemplate)
            .where(ShiftTemplate.org_id == ctx.org_id)
            .order_by(ShiftTemplate.start_time)
        ).scalars()
    )
    if templates:
        lines.append(
            "Shift templates: %s."
            % "; ".join(
                "%s %s-%s%s"
                % (
                    t.name,
                    t.start_time.strftime("%H:%M"),
                    t.end_time.strftime("%H:%M"),
                    " (night)" if t.is_night else "",
                )
                for t in templates
            )
        )
    lines.append(
        "Not available to you, on purpose: pay, contracts, contracted hours, "
        "absences and anything personal about anyone."
    )
    return "\n".join(lines)


def get_business_profile(db: Session, ctx: ToolContext, args: Mapping) -> str:
    """What the manager told us about the business, and the rules they confirmed."""
    profile = bp.get_or_create(db, ctx.org_id)
    lines: List[str] = []
    if profile.vertical and profile.vertical_source == "declared":
        vertical = bp.VERTICALS.get(profile.vertical)
        if vertical is not None:
            lines.append("Kind of business: %s." % vertical.label)
    if profile.location and profile.location.strip():
        lines.append("Where: %s." % safe_prose(profile.location, 200))
    days = bp.declared_day_hours(profile)
    if days:
        # Stored with 0 = Sunday, like the rest of the profile.
        lines.append(
            "Opening hours the manager declared: %s."
            % "; ".join(
                "%s %s-%s" % (bp.WEEKDAY_NAMES[wd], bp._clock(o), bp._clock(c))
                for wd, (o, c) in sorted(days.items(), key=lambda kv: (kv[0] - 1) % 7)
            )
        )
    if profile.weekend_days:
        names = [bp.WEEKDAY_NAMES[d] for d in profile.weekend_days if isinstance(d, int) and 0 <= d < 7]
        if names:
            lines.append("Their weekend: %s." % ", ".join(names))
    if profile.objective:
        blurb = bp.OBJECTIVE_CONTEXT.get(profile.objective)
        lines.append("What they want a rota to optimise for: %s" % (blurb or profile.objective))
    for label, text in (
        ("How the manager describes the business", profile.house_notes),
        ("What the manager said in the opening interview", profile.interview_notes),
    ):
        prose = safe_prose(text)
        if prose:
            lines.append("%s: %s" % (label, prose))

    hints = bp.hints_for(db, ctx.org_id)
    active = [h for h in hints if bp.is_active(h)]
    stated = [safe_prose(bp.hint_label(h), 300) for h in active if bp.is_stated(h)]
    stated = [s for s in stated if s]
    if stated:
        lines.append("Standing rules the manager told us and CONFIRMED: %s." % "; ".join(stated))
    believed = [bp.hint_label(h) for h in active if not bp.is_stated(h)]
    if believed:
        lines.append(
            "Patterns learned from the manager's repeated corrections (active, "
            "not typed by them): %s." % "; ".join(believed)
        )
    research = safe_prose(profile.research_notes)
    if research:
        lines.append(
            "What WE looked up on the web about businesses like this one, which "
            "the manager has NOT confirmed and may be wrong: %s" % research
        )
    if not lines:
        return "The manager has not told us anything about the business yet."
    return "\n".join(lines)


def get_planner_notes(db: Session, ctx: ToolContext, args: Mapping) -> str:
    """What the calendar planner noticed on earlier calendars. Nobody confirmed it."""
    profile = bp.get_or_create(db, ctx.org_id)
    if not profile.learning_enabled:
        return "The manager has switched learning off, so there are no planner notes to read."
    notebook, _ = pn.load(db, ctx.org_id)
    notes = pn.notes_in(notebook.files)
    if not notes:
        return "The planner has not noted anything about this business yet."

    def person(m: "re.Match") -> str:
        return "someone" if m.group(1) == pn.UNKNOWN_ID else ctx.people.alias(m.group(1))

    lines = [
        "What the calendar planner noticed on this business's earlier calendars. "
        "The manager has NOT confirmed these; notes about a person are only "
        "proposals until the manager confirms them."
    ]
    lines.extend("- " + pn.MARKER_RE.sub(person, n.text) for n in notes)
    return "\n".join(lines)


def get_day_notes_insights(db: Session, ctx: ToolContext, args: Mapping) -> str:
    """What the manager's day notes of the last twelve weeks add up to.

    The same lines the planner is given (`day_insights.prose`), counted from a
    small model's reading of each note: takings, busy and quiet hours, when the
    team was short, what moved demand. Never a note's text -- the notes are the
    manager's diary, and the reading already has every person and every
    private subject taken out of it.
    """
    from app.services import day_insights

    if not day_insights.learning_enabled(db, ctx.org_id):
        return "The manager has switched learning off, so the day notes are not read."
    agg = day_insights.load_aggregate(db, ctx.org_id, ctx.today)
    lines = day_insights.prose(agg)
    if not lines:
        return "No day notes have been read in the last twelve weeks."
    return "\n".join(
        [
            "What the manager's day notes from %s to %s add up to (%d notes). The "
            "manager wrote the notes; the reading and the counting are ours and "
            "nobody has checked them. Hours are the business's own clock."
            % (agg.since, agg.until, agg.notes_read)
        ]
        + ["- " + line for line in lines]
    )


TOOLS: Dict[str, Callable[[Session, ToolContext, Mapping], str]] = {
    "get_published_schedule": get_published_schedule,
    "get_team": get_team,
    "get_business_profile": get_business_profile,
    "get_planner_notes": get_planner_notes,
    "get_day_notes_insights": get_day_notes_insights,
}


def run(db: Session, ctx: ToolContext, name: str, args: object) -> Tuple[str, bool]:
    """Carry out one tool call. Returns (text, is_error). Never raises for the
    model's mistakes; a bug of ours is logged by the caller and reported to
    the model as an error, not as a crash of the manager's request."""
    handler = TOOLS.get(str(name))
    if handler is None:
        return "Unknown tool: %s." % name, True
    if not isinstance(args, Mapping):
        args = {}
    try:
        text = handler(db, ctx, args)
    except ToolInputError as exc:
        return ctx.people.mask(str(exc)), True
    text = ctx.people.mask(text)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + "\n[cut: ask for a shorter period]"
    return text, False
