from __future__ import annotations

from typing import List
from urllib.parse import quote, urlsplit, urlunsplit

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# --- Defaults that must not survive a deploy ---------------------------------
# Both values below ship in .env.example, so they are published: anyone who can
# read the repository can read them. On a laptop they are a convenience. Against
# a database that is not this machine's they are an open door -- the JWT secret
# forges tokens, and the app_user password reaches Postgres directly through the
# provider's TCP proxy, where row-level security is no barrier at all because
# the caller sets app.current_org_id himself.
#
# APP_DB_PASSWORD is checked even when APP_DATABASE_URL is given in full: the
# initial migration runs ALTER ROLE app_user ... PASSWORD with it on every
# upgrade, so leaving it at the default stamps a published password on the one
# role that row-level security is enforced against.
PUBLISHED_DEFAULTS = {
    "jwt_secret": "change-me-dev-secret",
    "app_db_password": "app_pass",
}

# Hostnames that mean "this machine", where the defaults above are harmless.
LOCAL_DB_HOSTS = {"localhost", "127.0.0.1", "::1"}


class Settings(BaseSettings):
    """Application settings loaded from environment / .env (pydantic-settings v2).

    Env var names map case-insensitively to the field names below, e.g.
    APP_DATABASE_URL -> app_database_url.
    """

    app_database_url: str = (
        "postgresql+psycopg://app_user:app_pass@localhost:5432/shiftplanner"
    )
    admin_database_url: str = (
        "postgresql+psycopg://postgres:postgres@localhost:5432/shiftplanner"
    )

    # Managed Postgres (Railway, Supabase, Heroku, ...) hands you ONE url, and
    # it is the superuser. Set this and the two above are derived from it.
    database_url: str = ""

    # Password for the restricted runtime role. It is what actually stands
    # between one customer's data and another's: app_user is NOSUPERUSER, so
    # FORCE ROW LEVEL SECURITY applies to it. Anything reachable from the
    # internet must set this -- the local default is a development convenience,
    # and a known password on a public database is not a barrier at all.
    app_db_password: str = "app_pass"

    jwt_secret: str = "change-me-dev-secret"

    # Escape hatch for the rare deployment whose Postgres really does live on
    # the same machine, and for anyone who would rather take the risk than be
    # stopped by it. Setting it disables the startup check below -- nothing
    # else -- and the consequences are then yours.
    allow_published_defaults: bool = False
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 1440
    # The till's tablet (role "store", app/access.py) stays signed in: ten
    # years. It is ended by changing its password or deleting the account
    # (session_epoch, app/deps.py), not by the clock.
    store_token_expire_days: int = 3650

    cors_origins: str = "http://localhost:5173"

    # Optional: enables the Claude-powered natural-language intake. When unset,
    # /schedule/interpret returns 503 and the frontend uses its local parser.
    anthropic_api_key: str = ""

    # Optional: enables the Gemini-powered opening interview -- the short
    # conversation that gathers the facts a brief needs before Claude reads it.
    # Free tier by design: Google may train on what is sent, so the interview
    # is about the BUSINESS and never about a named person (see
    # services/interview.py). When unset, /interview/* returns 503 and the
    # frontend simply does not offer it.
    gemini_api_key: str = ""
    # The lite model on purpose: asking one short question is not a job for a
    # big model, and measured on 2026-09-08 the lite one answered in under a
    # second where the full flash models took 7 to 60 seconds or came back
    # 503 "high demand". A manager mid-conversation feels every one of those.
    gemini_model: str = "gemini-3.5-flash-lite"
    # The model that looks the business up on the web after the interview
    # (services/research.py), with Google Search grounding switched on. Its
    # own setting because the reason `gemini_model` is the lite one -- latency
    # in a conversation -- does not apply to a call nobody is typing at; it
    # starts on the lite model too because that is what the key is known to
    # reach, and can be raised without touching the conversation.
    gemini_research_model: str = "gemini-3.5-flash-lite"

    # --- Telling the team ----------------------------------------------------
    # Optional: enables the email a person gets when their rota is published or
    # changed. When unset, publishing works exactly as before and reports that
    # it reached nobody -- which is the honest answer, and the one the manager
    # needs rather than a silent no-op.
    #
    # The key is a Resend API key. Chosen for the free tier's THREE verified
    # domains: the sending domain can change later without a bill. The cap that
    # matters is 100 emails a day -- one per person per publish, so a twenty
    # person bar has room for five publishes a day and a year published month
    # by month does not.
    resend_api_key: str = ""

    # Who the email is from. A verified domain at the provider, or the send is
    # refused -- so this is deliberately not defaulted to something plausible
    # that would fail at the worst moment.
    mail_from: str = ""

    # Where the links in an email point. Without it the email still says what
    # changed and simply carries no link, which is better than a link to
    # localhost in somebody's inbox.
    app_base_url: str = ""

    # --- What the model costs us ---------------------------------------------
    # See the lifespan in main.py. Raised from anyio's default of 40 because a
    # calendar generation holds one of these threads for minutes; they are
    # blocked on a socket, so the cost is stack memory rather than CPU.
    request_thread_limit: int = 120

    # What one organisation may spend on the model in a rolling 30 days.
    #
    # Sized against measurement: a month of 124 shifts costs on the order of
    # 0.15 USD to write, so a year is a couple of dollars and this is roughly a
    # dozen annual calendars a month -- generous for a real business, and a
    # wall for a loop. The number is here rather than per-customer because
    # subscriptions carry a plan name and no budget; when they carry one, this
    # becomes its default.
    api_budget_usd_per_month: float = 25.0

    # Whether reaching it REFUSES or merely warns. Off by default on purpose:
    # a spend ceiling that starts enforcing the day it ships turns an estimate
    # into an outage for whoever was already above it. Watch the warnings
    # first, then turn this on -- it is an environment variable, so enforcing
    # does not need a deploy.
    api_budget_enforced: bool = False

    # --- Planning as a job, not as a wait ------------------------------------
    # How many calendars this container plans at once. It is a CEILING on
    # concurrency, which the old design never had: a generation used to be one
    # request holding one pooled connection and its own eight threads for
    # minutes, so the limit was discovered rather than chosen -- fifteen
    # concurrent generations exhausted the connection pool and what stopped
    # answering was login. Two is deliberate and low: each job already fans out
    # to MAX_CONCURRENT_MONTHS calls of its own.
    generation_workers: int = 2

    # How long a job may go without a heartbeat before another worker may take
    # it. A worker writes one while the model works, so silence past this means
    # the container is gone -- a redeploy mid-month, which happens often here
    # because main is the deploy. Five minutes is far longer than the gap
    # between heartbeats and far shorter than a manager's patience.
    generation_stale_after_seconds: int = 300

    # Times a job may be picked up before it is abandoned. Two, so a redeploy
    # resumes the work exactly once: a job that kills its worker -- rather than
    # losing it -- would otherwise kill every worker in turn and the only
    # symptom would be a queue that never moves.
    generation_max_attempts: int = 2

    # Whether publishing REFUSES a rota that breaks the law, or merely says so
    # in the log. Off by default for the same reason as the budget above: a
    # control that starts refusing the day it ships turns our reading of the
    # rules into somebody else's Monday with no rota. Watch what it would have
    # refused first, then turn it on -- it is an environment variable, so
    # enforcing does not need a deploy.
    publish_law_enforced: bool = False

    # Whether the planner keeps its own notebook about each business.
    #
    # After a publish, in the background, one short call with the API's memory
    # tool lets the model read what was published and what the manager changed
    # in its proposal, and update a few lines of notes about the business
    # (services/planner_notes.py). Notes about the business reach the next
    # calendar as "noticed, not confirmed"; notes about a person only ever
    # become a proposal the manager confirms.
    #
    # Off by default, like every switch in this file that starts spending or
    # starts steering: merging it changes nothing in production. Off means the
    # model is never called AND the notes are never read into a calendar --
    # the manager can still see and delete whatever is there. It is an
    # environment variable (PLANNER_NOTES_ENABLED=true), not a deploy.
    planner_notes_enabled: bool = False

    # --- The business assistant ----------------------------------------------
    # A chat on the manager's dashboard that answers questions about their
    # business and their published calendar, and REMEMBERS between
    # conversations. Built on Claude Managed Agents (beta): one agent
    # configuration for everybody, one memory store per organisation. See
    # services/assistant.py and backend/assistant/agent.yaml.
    #
    # Off by default, and for the same reason as every other switch here that
    # starts spending: merging it changes nothing in production. It also needs
    # the two ids below, which exist only once somebody has created the agent
    # and the environment from backend/assistant/*.yaml -- a step taken once,
    # by hand, never in the request path. Missing either, or off, and the
    # assistant does not exist: the status endpoint says so, every other
    # endpoint is a 404, and not one call reaches the API.
    assistant_enabled: bool = False
    assistant_agent_id: str = ""
    assistant_environment_id: str = ""
    # Which model the agent in agent.yaml runs, for the ledger's price table
    # only. The agent's own configuration is what decides the model; this is
    # what we believe it decided, used when a session does not tell us.
    assistant_model: str = "claude-sonnet-5"
    # How long one answer may take, wall clock, tool calls included. Past it
    # the session is interrupted (it stops spending) and the manager is told
    # to ask again. A question about a month is a handful of seconds; ninety
    # is for the day the service is slow, not for a design that needs it.
    assistant_turn_timeout_seconds: float = 90.0
    # A hard ceiling on what ONE conversation may cost, in US cents at list
    # price, enforced by the platform before every model request (the
    # session's `budget`). The monthly budget above is a soft reading of our
    # own ledger; this one cannot be talked past. At a dollar a conversation
    # is dozens of questions; a conversation that reaches it is told to start
    # a new one, which keeps the memory and drops the long history.
    assistant_session_budget_cents: int = 100

    # --- Jev: a model that decides, and never writes --------------------------
    # TypeSafe AI's "decision model" (services/jev.py). It is not asked to plan
    # anything: it answers closed questions -- yes or no, one of these options --
    # with a probability, in a few hundred milliseconds. Three of the product's
    # questions are of that shape: whether a correction is a standing rule or a
    # one-off, which halves of the planner a sentence needs, and what kind of
    # business the interview describes.
    #
    # Off by default, like every switch in this file that starts spending or
    # starts steering: merging it changes nothing in production. It needs the
    # key as well -- off, or without one, and not one call leaves the server,
    # and each of the three questions is answered exactly as it was before.
    #
    # Hosted in the United States with no EU region (checked 2026-09-24). What
    # it is sent is the manager's sentence with every name masked, or the
    # interview notes -- never a roster, a shift or a reason for an absence.
    jev_enabled: bool = False
    jev_api_key: str = ""
    # The endpoint, not just the host. TypeSafe paused direct sign-ups on
    # 2026-09-22; OpenRouter serves the same API with the same body and needs
    # no TypeSafe account: JEV_BASE_URL=https://openrouter.ai/api/v1/systemone,
    # JEV_MODEL=~typesafe/jev-latest and an OpenRouter key in JEV_API_KEY.
    jev_base_url: str = "https://api.typesafe.ai/v1/systemone"
    jev_model: str = "jev-latest"
    # Whether the planner halves Jev calls unnecessary are actually SKIPPED, or
    # merely logged next to what they returned. Off by default for the reason
    # `publish_law_enforced` is: watch what it would have skipped first. A half
    # skipped wrongly is a request the manager made and nobody carried out.
    jev_route_enforced: bool = False

    # Whether the full Content-Security-Policy is ENFORCED or merely reported.
    #
    # Off by default, and for the third time in this file the reason is the
    # same one: a control that starts refusing the day it ships turns our
    # reading of a situation into somebody else's Monday. Here the situation
    # is "what the browser is allowed to load", and getting one directive
    # wrong does not degrade the app -- it shows a blank screen.
    #
    # While this is off, the directives that cannot break a working page are
    # enforced anyway and the rest goes out as Content-Security-Policy-Report-
    # Only. Turning it on promotes the identical string to enforcing, and it
    # is an environment variable, so it does not need a deploy -- or a revert.
    # See app/security_headers.py, which lists what to settle first.
    csp_enforced: bool = False

    # --- Back office ---------------------------------------------------------
    # How long a brand-new organization gets before it has to become a paying
    # customer. Only affects the trial_ends_at stamped at signup.
    trial_period_days: int = 14

    # Bootstrap credentials for the FIRST platform admin. There is no public
    # signup for the back office on purpose -- an account is created only by
    # running `make backend-bootstrap-admin`, which reads these two values.
    # Leave them empty in any environment where you have not just installed.
    platform_admin_email: str = ""
    platform_admin_password: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @model_validator(mode="after")
    def _derive_database_urls(self) -> "Settings":
        """Split one managed superuser URL into the two roles this app uses.

        The superuser URL runs migrations (DDL, role creation, RLS policies).
        The runtime URL is the SAME database as ``app_user``, the restricted
        role -- because row-level security is only enforced against a
        non-superuser. Connecting the app as the superuser would silently turn
        the multi-tenant barrier off while everything still appeared to work,
        which is the worst way for a security control to fail.

        An explicitly provided APP_/ADMIN_DATABASE_URL always wins.
        """
        if not self.database_url:
            return self

        parts = urlsplit(self.database_url)
        scheme = "postgresql+psycopg"
        host = parts.hostname or "localhost"
        port = ":%d" % parts.port if parts.port else ""

        # The query string is carried over too, and it is not cosmetic:
        # managed Postgres hands us `?sslmode=require`, and dropping it does
        # not fail -- libpq falls back to its own default, `prefer`, which
        # negotiates TLS if the server offers it, accepts plain text if it
        # does not, and verifies no certificate either way. The connection
        # keeps working and stops being private, which is the only kind of
        # security failure nobody notices.
        query = parts.query

        if "admin_database_url" not in self.model_fields_set:
            # Only the driver changes. The credentials are carried over exactly
            # as given -- they are already percent-encoded in the source URL,
            # and re-encoding them would turn a '@' in a password into '%2540'.
            self.admin_database_url = urlunsplit(
                (scheme, parts.netloc, parts.path, query, "")
            )

        if "app_database_url" not in self.model_fields_set:
            self.app_database_url = urlunsplit(
                (
                    scheme,
                    "app_user:%s@%s%s" % (quote(self.app_db_password, safe=""), host, port),
                    parts.path,
                    query,
                    "",
                )
            )

        return self

    @model_validator(mode="after")
    def _refuse_published_defaults(self) -> "Settings":
        """Refuse to start with a published secret against a remote database.

        Nothing used to stop it: the app came up, /health said ok, and it signed
        tokens with a secret that is in the repository. A missing variable in
        the deploy environment is an easy mistake and it failed silently, which
        is the one thing a security control must never do. It runs after the
        URLs are derived so that it sees the host actually connected to.
        """
        if self.allow_published_defaults or not self._database_is_remote():
            return self

        offenders = sorted(
            name for name, default in PUBLISHED_DEFAULTS.items()
            if getattr(self, name) == default
        )
        if not offenders:
            return self

        raise ValueError(
            "refusing to start: %s still %s the default value published in "
            ".env.example, and the database is not on this machine. Set %s in "
            "this environment (or ALLOW_PUBLISHED_DEFAULTS=true to override)."
            % (
                ", ".join(n.upper() for n in offenders),
                "has" if len(offenders) == 1 else "have",
                " and ".join(n.upper() for n in offenders),
            )
        )

    def _database_is_remote(self) -> bool:
        """True when any configured database lives somewhere other than here."""
        for url in (self.database_url, self.app_database_url, self.admin_database_url):
            if not url:
                continue
            host = urlsplit(url).hostname
            if host and host not in LOCAL_DB_HOSTS:
                return True
        return False

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
