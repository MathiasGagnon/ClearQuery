import io
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

from clear_query import messaging


@pytest.fixture
def temp_ws(tmp_path: Path) -> Path:
    ws_path = tmp_path / "workspace.json"
    ws_path.write_text(
        json.dumps(
            {
                "project": "test_proj",
                "sources": [
                    {
                        "name": "src1",
                        "type": "csv",
                        "path": "data/src1.csv",
                        "recipe": [{"type": "unique"}],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    pd.DataFrame({"x": [1, 2, 2]}).to_csv(tmp_path / "data/src1.csv", index=False)
    return ws_path


def test_messaging_load_workspace_and_preview(temp_ws: Path, monkeypatch):
    # Prepare commands
    req_load = {
        "id": "req-1",
        "command": "load_workspace",
        "args": {"workspace_path": str(temp_ws)},
    }
    req_preview = {
        "id": "req-2",
        "command": "get_preview",
        "args": {"workspace_path": str(temp_ws), "source_name": "src1", "limit": 10},
    }

    # Standardize input stream
    inputs = json.dumps(req_load) + "\n" + json.dumps(req_preview) + "\n"
    stdin_mock = io.StringIO(inputs)
    stdout_mock = io.StringIO()

    monkeypatch.setattr(sys, "stdin", stdin_mock)
    monkeypatch.setattr(sys, "stdout", stdout_mock)

    # Act
    messaging.main()

    # Assert
    stdout_mock.seek(0)
    lines = stdout_mock.getvalue().strip().split("\n")
    assert len(lines) == 2

    # Verify first response (load_workspace)
    resp1 = json.loads(lines[0])
    assert resp1["id"] == "req-1"
    assert resp1["success"] is True
    assert resp1["data"]["name"] == "test_proj"
    assert len(resp1["data"]["sources"]) == 1

    # Verify second response (get_preview)
    resp2 = json.loads(lines[1])
    assert resp2["id"] == "req-2"
    assert resp2["success"] is True
    assert resp2["data"]["columns"] == ["x"]
    # unique applied, so [1, 2, 2] -> [1, 2]
    assert resp2["data"]["rows"] == [[1], [2]]


def test_messaging_error_handling(monkeypatch):
    req_bad = {
        "id": "req-err",
        "command": "load_workspace",
        "args": {"workspace_path": "non_existent_file.json"},
    }

    stdin_mock = io.StringIO(json.dumps(req_bad) + "\n")
    stdout_mock = io.StringIO()

    monkeypatch.setattr(sys, "stdin", stdin_mock)
    monkeypatch.setattr(sys, "stdout", stdout_mock)

    # Act
    messaging.main()

    # Assert
    stdout_mock.seek(0)
    lines = stdout_mock.getvalue().strip().split("\n")
    assert len(lines) == 1
    resp = json.loads(lines[0])
    assert resp["id"] == "req-err"
    assert resp["success"] is False
    assert "error" in resp
