"""What we look up about a business like this one, in the place it is.

The interview ends with a paragraph in the manager's words: a bar, in
Barcelona, six people. That is what THEY know. There is a second thing worth
knowing before a calendar is planned, and nobody has to be asked for it: how a
business of that kind, in that place, usually runs -- when the neighbourhood
eats, which nights are the busy ones, whether August empties the street or
fills it, which local holidays close the shutters. A manager who has run the
bar for years knows all of this and never thinks to type it; a planner that
does not know it arranges Thursdays like Mondays.

So Gemini is asked to search for it. The Gemini API can ground a reply in a
Google search of its own, and this module makes exactly one such call: the
interview paragraph (plus the location and the vertical, when the profile has
them) goes in, and a short summary in the manager's language comes out. That
summary is written to ``business_profile.research_notes`` -- a column that has
existed since migration 0013 for precisely this, and that both prompt
builders already read, labelled as OURS: "what we looked up, which the manager
has not confirmed and may be wrong". Nothing here changes that label. The
summary reaches Claude beside what the manager said, never in its place.

THE SAME PRIVACY RULE AS THE INTERVIEW. This is the free tier, so what is sent
may be trained on. The input is the paragraph the manager already approved
for that very tier (no names by construction), the location and the industry.
``house_notes`` is deliberately NOT sent: it is free text the manager typed
into a settings box that never promised to stay off a free tier.

Like the interview, the HTTP call is one injectable function, so what is asked
and how the reply is read are pinned in tests without a key.

THE SECOND CALL, AND WHY THERE ARE TWO. A paragraph of prose is the right thing
to show a manager in Settings and the wrong thing to plan from: it reached
Claude as BACKGROUND, under an instruction that forbids it from adding coverage
(see `planning_background` in services/business_profile), so the reasoning was
written down and then changed nothing. A bar that fills on Friday night got the
same Friday as a Tuesday.

So a second call turns the prose into SIGNALS -- weekdays, windows, months,
holidays, a headcount -- which the planner already knows how to act on: they
join the ones the brief itself carries and become coverage rules, each one
announced as an assumption the manager can argue with.

It is two calls rather than one because the grounded call cannot be asked for
JSON: the API does not promise to honour a response schema and a search tool at
once (see `_call_gemini_grounded`). The split turns out to be the honest one
anyway -- the first call SEARCHES, the second REASONS about what it found, and
only the second is allowed to produce anything the calendar acts on.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, List, Optional

from app.services import interview as interview_svc
from app.services.interview import GEMINI_ENDPOINT, _post_with_retries

# A grounded call searches before it answers, so it is slower than a plain
# turn. Forty seconds is generous for the lite model and still short enough
# that a manager watching a "looking this up" line does not give up on it.
CALL_TIMEOUT_S = 40

# How much of the summary is kept. It is background for a prompt and a box in
# Settings, not a report; past this it stops being read.
MAX_SUMMARY_CHARS = 2000
MAX_SOURCES = 5


@dataclass
class ResearchInput:
    """What the search is built from. Everything here is about the business."""

    notes: str
    location: Optional[str] = None
    vertical_label: Optional[str] = None
    language: str = "en"

    def has_anything(self) -> bool:
        return bool(
            (self.notes or "").strip()
            or (self.location or "").strip()
            or (self.vertical_label or "").strip()
        )


@dataclass
class Source:
    title: str
    url: str


@dataclass
class ResearchResult:
    summary: str
    sources: List[Source] = field(default_factory=list)
    queries: List[str] = field(default_factory=list)


def build_system_instruction(language: str) -> str:
    return "\n".join(
        [
            "You research how a small business like the one described usually "
            "runs, in the place it is, so a shift calendar can be planned for it. "
            "Search the web for what is typical of THAT kind of business in THAT "
            "town or neighbourhood.",
            "",
            "Report only what matters for staffing: the usual opening pattern "
            "for that trade there, the busy hours and busy days, the quiet ones, "
            "seasonality (high and low months, tourist seasons), local holidays "
            "and festivals that change trade or close businesses, and anything "
            "else that changes how many people are needed and when. Skip prices, "
            "history, reviews and advice.",
            "",
            "Write %s. One short paragraph, at most 150 words, plain prose: no "
            "headings, no bullet points, no links in the text. Say what is "
            "typical, not what this particular business does -- you have not "
            "seen it. If you find nothing specific to the place, say what is "
            "typical of the trade in that country and say that it is general."
            % ("in Spanish" if language == "es" else "in English"),
            "",
            "Never mention or look up any person. Do not name the business or "
            "guess which one it is.",
        ]
    )


def build_prompt(inp: ResearchInput) -> str:
    """The user turn: what the manager told us, as the thing to search from."""
    lines = []
    if inp.vertical_label:
        lines.append("Kind of business: %s." % inp.vertical_label.strip())
    if inp.location:
        lines.append("Where it is: %s." % inp.location.strip())
    if inp.notes and inp.notes.strip():
        lines.append("What the manager said about it: %s" % inp.notes.strip())
    lines.append(
        "Search for how a business like this usually runs there, and summarise "
        "what matters for planning who works when."
    )
    return "\n".join(lines)


@dataclass
class GeminiRequest:
    system_instruction: str
    prompt: str


Caller = Callable[[GeminiRequest, str, str], dict]


def _call_gemini_grounded(req: GeminiRequest, api_key: str, model: str) -> dict:
    """One generateContent call with Google Search switched on. Returns the raw payload.

    No response schema here: a grounded reply is prose with citations attached
    as metadata, and the API does not promise to honour a JSON schema and a
    search tool in the same call. The prose is the summary; the citations are
    read from ``groundingMetadata``.
    """
    body = {
        "system_instruction": {"parts": [{"text": req.system_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": req.prompt}]}],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2},
    }
    url = "%s?%s" % (
        GEMINI_ENDPOINT.format(model=model),
        urllib.parse.urlencode({"key": api_key}),
    )
    http_req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return _post_with_retries(http_req, timeout=CALL_TIMEOUT_S)


def parse_result(payload: dict) -> ResearchResult:
    """The summary and its sources out of a generateContent payload.

    Tolerant on purpose: a grounded reply that searched nothing has no
    metadata at all, and a reply with a malformed chunk must cost one source,
    not the summary.
    """
    try:
        candidate = payload["candidates"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini returned no content: %s" % payload) from exc
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "\n".join(
        str(p.get("text", "")).strip() for p in parts if isinstance(p, dict) and p.get("text")
    ).strip()
    if not text:
        raise RuntimeError("Gemini returned an empty summary")
    if len(text) > MAX_SUMMARY_CHARS:
        text = text[:MAX_SUMMARY_CHARS].rstrip() + "…"

    meta = candidate.get("groundingMetadata") or {}
    sources: List[Source] = []
    seen = set()
    for chunk in meta.get("groundingChunks") or []:
        web = (chunk or {}).get("web") if isinstance(chunk, dict) else None
        if not isinstance(web, dict):
            continue
        url = str(web.get("uri") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        sources.append(Source(title=str(web.get("title") or url).strip(), url=url))
        if len(sources) >= MAX_SOURCES:
            break
    queries = [str(q) for q in (meta.get("webSearchQueries") or []) if q]
    return ResearchResult(summary=text, sources=sources, queries=queries)


def research(
    inp: ResearchInput,
    api_key: str,
    model: str,
    call: Caller = _call_gemini_grounded,
    rest: "Optional[interview_svc.GeminiRest]" = None,
) -> ResearchResult:
    """Look the business up and summarise what a planner should know.

    After a 429 it is not tried again for RESEARCH_REST_S: the welcome waits
    for this call, and a spent quota took it eleven seconds of retries to say
    so. While resting it says so at once, as the same QuotaSpent.
    """
    if rest is None:
        rest = interview_svc.RESEARCH_REST
    if rest.resting():
        raise interview_svc.QuotaSpent("Gemini search is resting after a 429")
    req = GeminiRequest(
        system_instruction=build_system_instruction(inp.language),
        prompt=build_prompt(inp),
    )
    try:
        payload = call(req, api_key, model)
    except interview_svc.QuotaSpent:
        rest.rest(interview_svc.RESEARCH_REST_S)
        raise
    except RuntimeError as exc:
        if "returned 429" in str(exc):
            rest.rest(interview_svc.RESEARCH_REST_S)
        raise
    return parse_result(payload)


def notes_with_sources(result: ResearchResult) -> str:
    """The text kept on the profile: the summary, then where it came from.

    The sources travel with the summary rather than in a column of their own
    because they are the one thing that keeps it honest -- a manager reading
    "August is the busy month" in Settings can see whether that came from the
    city's tourism office or from a blog -- and because what is stored is what
    the planner is shown, labelled as ours, and a citation does not hurt there.
    """
    if not result.sources:
        return result.summary
    # Titles only. The URIs the API hands back are redirects through Google,
    # so the title -- usually the site's domain -- is the readable part.
    cited = "; ".join(s.title for s in result.sources)
    return "%s\n\nSources: %s" % (result.summary, cited)


# --- The second call: from prose to signals ---------------------------------

# A ceiling on what an inference may buy. The planner's own assumption for a
# ranked day is `minStaff + 1` (RANKED_EXTRA), chosen because it is the
# smallest thing "busier" can mean. A model that has read the internet about
# bars is allowed to be a little braver than that and no braver: two over the
# floor is a busy Friday, twelve is a hallucination with a payroll.
MAX_PEAK_OVER_FLOOR = 2

# Windows and weekdays past these stop being a peak and start being the
# opening hours restated, which would raise cover over the whole week.
MAX_BUSY_WEEKDAYS = 4
MAX_BUSY_WINDOWS = 3
MAX_HOLIDAYS = 12

_WEEKDAYS = {
    "sunday": 0,
    "monday": 1,
    "tuesday": 2,
    "wednesday": 3,
    "thursday": 4,
    "friday": 5,
    "saturday": 6,
}


@dataclass
class ResearchSignals:
    """What the research means for a calendar, as values rather than prose.

    Every field is empty by default and every reader treats empty as "nothing
    was inferred" -- so a business whose research was never run, or whose
    second call failed, plans exactly as it did before this existed.
    """

    #: Weekday indexes (0 = Sunday) that are busier than the rest.
    busy_weekdays: List[int] = field(default_factory=list)
    #: Busier stretches of the day, as (startMin, endMin) from midnight.
    busy_windows: List[tuple] = field(default_factory=list)
    #: People on shift at the peak, or None to let the planner assume one more.
    peak_staff: Optional[int] = None
    #: Months (1-12) the trade is busier / quieter there.
    busy_months: List[int] = field(default_factory=list)
    quiet_months: List[int] = field(default_factory=list)
    #: Local holidays as "MM-DD", and whether the trade usually SHUTS on them.
    holidays: List[dict] = field(default_factory=list)
    #: One line, in the manager's language, saying what this rests on. Shown
    #: as the "because" of every assumption these produce.
    rationale: str = ""

    @property
    def has_anything(self) -> bool:
        return bool(
            self.busy_weekdays
            or self.busy_windows
            or self.busy_months
            or self.quiet_months
            or self.holidays
        )

    def to_json(self) -> dict:
        return {
            "busy_weekdays": self.busy_weekdays,
            "busy_windows": [[a, b] for a, b in self.busy_windows],
            "peak_staff": self.peak_staff,
            "busy_months": self.busy_months,
            "quiet_months": self.quiet_months,
            "holidays": self.holidays,
            "rationale": self.rationale,
        }

    @staticmethod
    def from_json(raw: Optional[dict]) -> "ResearchSignals":
        """Read a stored row back, defensively.

        Anything malformed costs that one field and never the whole set: this
        is a column written by a model, and a planner that raises on it would
        take the calendar down rather than plan without an inference.
        """
        if not isinstance(raw, dict):
            return ResearchSignals()
        windows = []
        for pair in raw.get("busy_windows") or []:
            if isinstance(pair, (list, tuple)) and len(pair) == 2:
                try:
                    windows.append((int(pair[0]), int(pair[1])))
                except (TypeError, ValueError):
                    continue
        return ResearchSignals(
            busy_weekdays=[int(d) for d in (raw.get("busy_weekdays") or []) if isinstance(d, int)],
            busy_windows=windows,
            peak_staff=raw.get("peak_staff") if isinstance(raw.get("peak_staff"), int) else None,
            busy_months=[int(m) for m in (raw.get("busy_months") or []) if isinstance(m, int)],
            quiet_months=[int(m) for m in (raw.get("quiet_months") or []) if isinstance(m, int)],
            holidays=[h for h in (raw.get("holidays") or []) if isinstance(h, dict)],
            rationale=str(raw.get("rationale") or ""),
        )


SIGNALS_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "busy_weekdays": {
            "type": "ARRAY",
            "items": {
                "type": "STRING",
                "enum": list(_WEEKDAYS.keys()),
            },
            "description": "Lowercase English weekday names that are BUSIER "
            "than the rest for this trade in this place. At most 4 -- a trade "
            "that is busy every day is not busy on any day in particular. "
            "Empty when nothing you found singles out particular days.",
        },
        "busy_windows": {
            "type": "ARRAY",
            "items": {"type": "STRING"},
            "description": 'The busier stretches of the day as "HH:MM-HH:MM" '
            'on a 24-hour clock (a bar\'s evening peak: ["21:00-01:00"]). At '
            "most 3, and each one a PEAK rather than the whole opening day. "
            "Empty when the hours are evenly busy or you do not know.",
        },
        "peak_staff": {
            "type": "INTEGER",
            "description": "How many people a business of this size usually "
            "has on shift at that peak. 0 when you cannot tell -- never guess "
            "from the size of the town.",
        },
        "busy_months": {
            "type": "ARRAY",
            "items": {"type": "INTEGER"},
            "description": "Months (1-12) when this trade is busier there, "
            "e.g. a coastal town in summer. Empty when trade is level or "
            "unknown.",
        },
        "quiet_months": {
            "type": "ARRAY",
            "items": {"type": "INTEGER"},
            "description": "Months (1-12) when it is quieter there, e.g. a "
            "city bar in August when the city empties. Empty when unknown.",
        },
        "holidays": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "date": {
                        "type": "STRING",
                        "description": 'Month and day as "MM-DD".',
                    },
                    "name": {"type": "STRING"},
                    "closes": {
                        "type": "BOOLEAN",
                        "description": "True only when a business of this kind "
                        "in this place USUALLY SHUTS that day. False when the "
                        "day merely changes trade.",
                    },
                },
                "required": ["date", "name", "closes"],
            },
            "description": "Local holidays and festivals that change trade. "
            "Only ones specific to that town, region or country. At most 12.",
        },
        "rationale": {
            "type": "STRING",
            "description": "ONE short clause, in the language the instruction "
            "names, saying what this rests on -- 'a bar in Barcelona fills on "
            "Friday and Saturday night'. It is shown to the manager as the "
            "reason for the staffing, so it must read as a sentence about "
            "their trade and their city. No preamble, no citation, under 120 "
            "characters.",
        },
    },
    "required": ["busy_weekdays", "busy_windows", "peak_staff", "rationale"],
}


def build_signals_instruction(language: str) -> str:
    return "\n".join(
        [
            "You turn research about a small business into the handful of "
            "figures a shift planner can act on. You are given what was found "
            "about that kind of business in that place, and what the manager "
            "said about their own.",
            "",
            "Reason about the TRADE and the PLACE together: a bar fills on "
            "Friday and Saturday night in a city, and a bar in a village that "
            "empties at nine does not. A bakery peaks in the morning wherever "
            "it is. Say what is typical for that trade THERE.",
            "",
            "Only fill a field you have a real reason for. An empty field is a "
            "correct answer and costs nothing: the planner has its own "
            "defaults and will use them. A field filled on a guess costs "
            "somebody a shift they did not need to work, so guessing is the "
            "one thing you must not do.",
            "",
            "Never contradict the manager. If they said when they are busy, "
            "that is settled and you are not being asked about it.",
            "",
            "Write `rationale` %s."
            % ("in Spanish" if language == "es" else "in English"),
        ]
    )


def build_signals_prompt(inp: ResearchInput, summary: str) -> str:
    lines = []
    if inp.vertical_label:
        lines.append("Kind of business: %s." % inp.vertical_label.strip())
    if inp.location:
        lines.append("Where it is: %s." % inp.location.strip())
    if inp.notes and inp.notes.strip():
        lines.append("What the manager said: %s" % inp.notes.strip())
    if summary.strip():
        lines.append("What was found about businesses like it: %s" % summary.strip())
    lines.append(
        "Give the figures a planner can act on. Leave empty whatever you do "
        "not actually know."
    )
    return "\n".join(lines)


def _call_gemini_json(req: "GeminiRequest", api_key: str, model: str) -> dict:
    """One generateContent call with a response schema and NO search tool.

    Separate from `_call_gemini_grounded` because the two cannot be combined:
    asking for both a schema and a search gets the schema ignored. This one has
    already been given what the search found, as text.
    """
    body = {
        "system_instruction": {"parts": [{"text": req.system_instruction}]},
        "contents": [{"role": "user", "parts": [{"text": req.prompt}]}],
        "generationConfig": {
            "temperature": 0.2,
            "responseMimeType": "application/json",
            "responseSchema": SIGNALS_SCHEMA,
        },
    }
    url = "%s?%s" % (
        GEMINI_ENDPOINT.format(model=model),
        urllib.parse.urlencode({"key": api_key}),
    )
    http_req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return _post_with_retries(http_req, timeout=CALL_TIMEOUT_S)


def _minutes(hhmm: str) -> Optional[int]:
    """"HH:MM" as minutes from midnight, or None if it is not one."""
    parts = str(hhmm).strip().split(":")
    if len(parts) != 2:
        return None
    try:
        hours, mins = int(parts[0]), int(parts[1])
    except (TypeError, ValueError):
        return None
    if not (0 <= hours <= 23 and 0 <= mins <= 59):
        return None
    return hours * 60 + mins


def parse_signals(payload: dict, floor: int = 0) -> ResearchSignals:
    """Read the JSON reply, keeping only what is usable.

    Every bound here is a refusal to trust the model with something expensive.
    A window that is not a window, a month that is not a month, a headcount
    from a model that has never seen the room -- each is dropped rather than
    passed on, because the cost of a bad figure lands on somebody's week.
    """
    try:
        candidate = payload["candidates"][0]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("Gemini returned no content: %s" % payload) from exc
    parts = (candidate.get("content") or {}).get("parts") or []
    raw = "".join(
        str(p.get("text", "")) for p in parts if isinstance(p, dict) and p.get("text")
    ).strip()
    if not raw:
        raise RuntimeError("Gemini returned an empty reply")
    data = json.loads(raw)

    weekdays = []
    for name in data.get("busy_weekdays") or []:
        index = _WEEKDAYS.get(str(name).strip().lower())
        if index is not None and index not in weekdays:
            weekdays.append(index)
    # Busy every day is busy on no day, and the rule would raise cover over the
    # whole week -- the same pruning `ranked_signals` does for the brief.
    if len(weekdays) > MAX_BUSY_WEEKDAYS:
        weekdays = []

    windows = []
    for raw_window in (data.get("busy_windows") or [])[:MAX_BUSY_WINDOWS]:
        halves = str(raw_window).split("-")
        if len(halves) != 2:
            continue
        start, end = _minutes(halves[0]), _minutes(halves[1])
        if start is None or end is None or start == end:
            continue
        # A window that ends before it starts runs through midnight, the same
        # reading the opening hours are given in services/intake.
        if end < start:
            end += 24 * 60
        windows.append((start, end))

    peak = data.get("peak_staff")
    if not isinstance(peak, int) or peak <= 0:
        peak = None
    elif floor > 0:
        peak = min(peak, floor + MAX_PEAK_OVER_FLOOR)

    def months(key: str) -> List[int]:
        return [
            m
            for m in (data.get(key) or [])
            if isinstance(m, int) and 1 <= m <= 12
        ]

    holidays = []
    for entry in (data.get("holidays") or [])[:MAX_HOLIDAYS]:
        if not isinstance(entry, dict):
            continue
        date = str(entry.get("date") or "").strip()
        bits = date.split("-")
        if len(bits) != 2:
            continue
        try:
            month, day = int(bits[0]), int(bits[1])
        except (TypeError, ValueError):
            continue
        if not (1 <= month <= 12 and 1 <= day <= 31):
            continue
        holidays.append(
            {
                "date": "%02d-%02d" % (month, day),
                "name": str(entry.get("name") or "").strip()[:80],
                "closes": bool(entry.get("closes")),
            }
        )

    return ResearchSignals(
        busy_weekdays=weekdays,
        busy_windows=windows,
        peak_staff=peak,
        busy_months=months("busy_months"),
        quiet_months=months("quiet_months"),
        holidays=holidays,
        rationale=str(data.get("rationale") or "").strip()[:160],
    )


def derive_signals(
    inp: ResearchInput,
    summary: str,
    api_key: str,
    model: str,
    floor: int = 0,
    call: Caller = _call_gemini_json,
) -> ResearchSignals:
    """Turn what the search found into figures the planner can act on."""
    req = GeminiRequest(
        system_instruction=build_signals_instruction(inp.language),
        prompt=build_signals_prompt(inp, summary),
    )
    return parse_signals(call(req, api_key, model), floor=floor)
