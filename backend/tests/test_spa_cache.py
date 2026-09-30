"""What a browser may keep, and for how long.

The app shell went out with no Cache-Control, a browser guessed, and a manager
kept running the previous deploy after reloading. No database, no network.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.spa import HASHED_CACHE, SHELL_CACHE, mount_frontend


def _app(tmp_path: Path) -> TestClient:
    (tmp_path / "index.html").write_text("<html>shell</html>")
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index-D1x7XY4d.js").write_text("console.log(1)")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    app = FastAPI()
    assert mount_frontend(app, str(tmp_path))
    return TestClient(app)


def test_the_shell_is_checked_every_time(tmp_path):
    r = _app(tmp_path).get("/")
    assert r.status_code == 200
    assert r.headers["cache-control"] == SHELL_CACHE


def test_a_client_route_gets_the_shell_with_the_shells_rules(tmp_path):
    r = _app(tmp_path).get("/employees/123")
    assert "shell" in r.text
    assert r.headers["cache-control"] == SHELL_CACHE


def test_a_hashed_asset_is_kept_for_a_year(tmp_path):
    r = _app(tmp_path).get("/assets/index-D1x7XY4d.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == HASHED_CACHE


def test_an_unhashed_file_at_the_root_is_checked_too(tmp_path):
    r = _app(tmp_path).get("/favicon.svg")
    assert r.headers["cache-control"] == SHELL_CACHE


def test_an_unchanged_shell_still_comes_back_as_304(tmp_path):
    client = _app(tmp_path)
    etag = client.get("/").headers["etag"]
    assert client.get("/", headers={"If-None-Match": etag}).status_code == 304


def test_a_missing_api_path_is_still_json_and_not_cached_as_the_shell(tmp_path):
    r = _app(tmp_path).get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Not found"}
