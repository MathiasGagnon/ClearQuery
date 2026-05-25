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
                "name": "demo",
                "sources": [
                    {
                        "name": "src1",
                        "type": "csv",
                        "path": "data/src1.csv",
                        "recipe": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    pd.DataFrame({"x": [1, 2, 3]}).to_csv(tmp_path / "data/src1.csv", index=False)
    return ws_path


def test_get_sources_schema(temp_ws: Path, monkeypatch):
    req = {
        "id": "req-1",
        "command": "get_sources_schema",
        "args": {"workspace_path": str(temp_ws)},
    }

    stdin_mock = io.StringIO(json.dumps(req) + "\n")
    stdout_mock = io.StringIO()

    monkeypatch.setattr(sys, "stdin", stdin_mock)
    monkeypatch.setattr(sys, "stdout", stdout_mock)

    messaging.main()

    stdout_mock.seek(0)
    resp = json.loads(stdout_mock.getvalue().strip())
    assert resp["id"] == "req-1"
    assert resp["success"] is True
    sources = resp["data"]["sources"]
    assert len(sources) == 1
    assert sources[0]["name"] == "src1"
    assert sources[0]["columns"][0]["name"] == "x"

