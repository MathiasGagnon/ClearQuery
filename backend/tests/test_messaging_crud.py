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


def test_add_remove_source_via_messaging(temp_ws: Path, monkeypatch):
    req_add = {
        "id": "add-1",
        "command": "add_source",
        "args": {
            "workspace_path": str(temp_ws),
            "source": {
                "name": "src2",
                "type": "csv",
                "path": "data/src2.csv",
                "recipe": [],
                "output_path": "data/src2.parquet",
            },
        },
    }
    req_load = {
        "id": "load-1",
        "command": "load_workspace",
        "args": {"workspace_path": str(temp_ws)},
    }
    req_add_dup = {
        "id": "add-dup",
        "command": "add_source",
        "args": {
            "workspace_path": str(temp_ws),
            "source": {
                "name": "src2",
                "type": "csv",
                "path": "data/src2.csv",
                "recipe": [],
                "output_path": "data/src2.parquet",
            },
        },
    }
    req_remove = {
        "id": "rm-1",
        "command": "remove_source",
        "args": {"workspace_path": str(temp_ws), "source_name": "src1"},
    }

    responses = _run_requests(monkeypatch, [req_add, req_load, req_add_dup, req_remove])
    assert [r["id"] for r in responses] == ["add-1", "load-1", "add-dup", "rm-1"]

    assert responses[0]["success"] is True
    assert len(responses[0]["data"]["sources"]) == 2

    assert responses[1]["success"] is True
    assert len(responses[1]["data"]["sources"]) == 2

    assert responses[2]["success"] is False
    assert "already exists" in responses[2]["error"]

    assert responses[3]["success"] is True
    assert len(responses[3]["data"]["sources"]) == 1
    assert responses[3]["data"]["sources"][0]["name"] == "src2"


def test_recipe_step_lifecycle_via_messaging(temp_ws: Path, monkeypatch):
    req_add_step = {
        "id": "step-add",
        "command": "add_recipe_step",
        "args": {
            "workspace_path": str(temp_ws),
            "source_name": "src1",
            "step": {"type": "filter_rows", "column": "x", "operator": ">", "value": 1},
        },
    }
    req_update_step = {
        "id": "step-upd",
        "command": "update_recipe_step",
        "args": {
            "workspace_path": str(temp_ws),
            "source_name": "src1",
            "step_index": 1,
            "step": {"type": "filter_rows", "column": "x", "operator": "==", "value": 2},
        },
    }
    req_remove_step_oob = {
        "id": "step-rm-oob",
        "command": "remove_recipe_step",
        "args": {"workspace_path": str(temp_ws), "source_name": "src1", "step_index": 99},
    }
    req_remove_step = {
        "id": "step-rm",
        "command": "remove_recipe_step",
        "args": {"workspace_path": str(temp_ws), "source_name": "src1", "step_index": 0},
    }
    req_preview = {
        "id": "preview-1",
        "command": "get_preview",
        "args": {"workspace_path": str(temp_ws), "source_name": "src1", "limit": 10},
    }

    responses = _run_requests(
        monkeypatch,
        [req_add_step, req_update_step, req_remove_step_oob, req_remove_step, req_preview],
    )
    by_id = {r["id"]: r for r in responses}

    assert by_id["step-add"]["success"] is True
    ops_after_add = by_id["step-add"]["data"]["sources"][0]["recipe"]["operations"]
    assert len(ops_after_add) == 2
    assert ops_after_add[1]["type"] == "filter_rows"

    assert by_id["step-upd"]["success"] is True
    ops_after_upd = by_id["step-upd"]["data"]["sources"][0]["recipe"]["operations"]
    assert ops_after_upd[1]["operator"] == "=="
    assert ops_after_upd[1]["value"] == 2

    assert by_id["step-rm-oob"]["success"] is False
    assert "out of bounds" in by_id["step-rm-oob"]["error"]

    assert by_id["step-rm"]["success"] is True
    ops_after_rm = by_id["step-rm"]["data"]["sources"][0]["recipe"]["operations"]
    assert len(ops_after_rm) == 1
    assert ops_after_rm[0]["type"] == "filter_rows"

    assert by_id["preview-1"]["success"] is True
    # After removing unique, only filter x == 2 remains -> [[2]]
    assert by_id["preview-1"]["data"]["rows"] == [[2]]

