"""Create or update the business assistant's agent and environment from the YAML.

The alternative to the ``ant`` CLI for whoever does not have it. Same files,
same result: ``agent.yaml`` and ``environment.yaml`` next to this script are
the definition, and this only sends them.

    cd backend
    ANTHROPIC_API_KEY=... .venv/bin/python assistant/setup_assistant.py            # dry run: prints what it would send
    ANTHROPIC_API_KEY=... .venv/bin/python assistant/setup_assistant.py --apply    # creates both, prints the ids

With ``ASSISTANT_AGENT_ID`` / ``ASSISTANT_ENVIRONMENT_ID`` already set in the
environment it UPDATES those instead of creating new ones: an agent update is
a new version, and conversations already open keep the version they started
with. Creating a second agent because the first one exists is the mistake this
is written to avoid -- the app points at exactly one.

NEVER RUN BY THE APP. Nothing in ``app/`` imports this file; the app only
reads the two ids from its configuration.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name: str) -> dict:
    import yaml

    with open(HERE / name, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--apply", action="store_true", help="actually call the API")
    args = parser.parse_args(argv)

    agent = load("agent.yaml")
    environment = load("environment.yaml")
    agent_id = os.environ.get("ASSISTANT_AGENT_ID", "").strip()
    environment_id = os.environ.get("ASSISTANT_ENVIRONMENT_ID", "").strip()

    if not args.apply:
        print("DRY RUN (pass --apply to send).")
        print("environment: %s %s" % ("update " + environment_id if environment_id else "create", json.dumps(environment, ensure_ascii=False)))
        print("agent: %s %s" % ("update " + agent_id if agent_id else "create", json.dumps({k: v for k, v in agent.items() if k != "system"}, ensure_ascii=False)))
        return 0

    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY is not set.", file=sys.stderr)
        return 2

    import anthropic

    client = anthropic.Anthropic()

    if environment_id:
        env = client.beta.environments.update(environment_id, **environment)
    else:
        env = client.beta.environments.create(**environment)
    print("ASSISTANT_ENVIRONMENT_ID=%s" % env.id)

    if agent_id:
        current = client.beta.agents.retrieve(agent_id)
        # The version we read is the one we expect to replace: a concurrent
        # edit in the Console makes this a 409 instead of silently losing it.
        out = client.beta.agents.update(agent_id, version=current.version, **agent)
    else:
        out = client.beta.agents.create(**agent)
    print("ASSISTANT_AGENT_ID=%s" % out.id)
    print("agent version: %s" % out.version)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
