import io
import json
import sys
from pathlib import Path

import pytest

from clear_query import messaging


def _run_requests(monkeypatch, requests: list[dict]) -> list[dict]:
    inputs = "\n".join(json.dumps(r) for r in requests) + "\n"
    stdin_mock = io.StringIO(inputs)
    stdout_mock = io.StringIO()

    monkeypatch.setattr(sys, "stdin", stdin_mock)
    monkeypatch.setattr(sys, "stdout", stdout_mock)

    messaging.main()

    stdout_mock.seek(0)
    lines = [ln for ln in stdout_mock.getvalue().splitlines() if ln.strip()]
    return [json.loads(ln) for ln in lines]


def test_create_workspace_creates_file(tmp_path: Path, monkeypatch):
    ws_dir = tmp_path / "new_ws"
    ws_path = ws_dir / "workspace.json"
    req_create = {
        "id": "create-1",
        "command": "create_workspace",
        "args": {"workspace_path": str(ws_dir), "name": "demo"},
    }

    responses = _run_requests(monkeypatch, [req_create])
    assert responses[0]["id"] == "create-1"
    assert responses[0]["success"] is True
    assert ws_path.exists()
    assert responses[0]["data"]["name"] == "demo"
    assert responses[0]["data"]["sources"] == []


def test_create_workspace_no_overwrite_by_default(tmp_path: Path, monkeypatch):
    ws_dir = tmp_path / "new_ws"
    ws_path = ws_dir / "workspace.json"
    ws_dir.mkdir(parents=True, exist_ok=True)
    ws_path.write_text(json.dumps({"name": "existing", "sources": []}), encoding="utf-8")

    req_create = {
        "id": "create-1",
        "command": "create_workspace",
        "args": {"workspace_path": str(ws_dir), "name": "demo"},
    }

    responses = _run_requests(monkeypatch, [req_create])
    assert responses[0]["success"] is False
    assert "already exists" in responses[0]["error"]


def test_create_workspace_overwrite_true(tmp_path: Path, monkeypatch):
    ws_dir = tmp_path / "new_ws"
    ws_path = ws_dir / "workspace.json"
    ws_dir.mkdir(parents=True, exist_ok=True)
    ws_path.write_text(json.dumps({"name": "existing", "sources": []}), encoding="utf-8")

    req_create = {
        "id": "create-1",
        "command": "create_workspace",
        "args": {"workspace_path": str(ws_dir), "name": "demo", "overwrite": True},
    }

    responses = _run_requests(monkeypatch, [req_create])
    assert responses[0]["success"] is True
    assert responses[0]["data"]["name"] == "demo"


def test_create_workspace_path_can_be_json_file_for_compat(tmp_path: Path, monkeypatch):
    ws_path = tmp_path / "workspace.json"
    req_create = {
        "id": "create-1",
        "command": "create_workspace",
        "args": {"workspace_path": str(ws_path), "name": "demo"},
    }

    responses = _run_requests(monkeypatch, [req_create])
    assert responses[0]["success"] is True
    assert ws_path.exists()
    assert responses[0]["data"]["name"] == "demo"
