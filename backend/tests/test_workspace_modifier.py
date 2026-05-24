import json
from pathlib import Path

import pandas as pd
import pytest

from clear_query.datasets.materialize import materialize_workspace
from clear_query.workspace.loader import load_workspace
from clear_query.workspace.modifier import (
    add_recipe_step,
    add_source,
    remove_recipe_step,
    remove_source,
    update_recipe_step,
)


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
    # Create the sample data file
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    pd.DataFrame({"x": [1, 2, 2]}).to_csv(tmp_path / "data/src1.csv", index=False)
    return ws_path


def test_add_remove_source(temp_ws: Path):
    # Act: Add a new source
    new_src = {
        "name": "src2",
        "type": "csv",
        "path": "data/src2.csv",
        "recipe": [],
        "output_path": "data/src2.parquet",
    }
    add_source(temp_ws, new_src)

    # Assert: Load and check
    ws = load_workspace(temp_ws)
    assert len(ws.sources) == 2
    assert ws.sources[1].name == "src2"
    assert len(ws.sources[1].recipe.operations) == 0

    # Act: Remove source
    remove_source(temp_ws, "src1")

    # Assert
    ws = load_workspace(temp_ws)
    assert len(ws.sources) == 1
    assert ws.sources[0].name == "src2"

    # Assert raises error if duplicate name
    with pytest.raises(ValueError, match="already exists"):
        add_source(temp_ws, new_src)

    # Assert raises error if source not found
    with pytest.raises(ValueError, match="does not exist"):
        remove_source(temp_ws, "non_existent")


def test_recipe_step_lifecycle(temp_ws: Path):
    # Act: Add step
    step = {"type": "filter_rows", "column": "x", "operator": ">", "value": 1}
    add_recipe_step(temp_ws, "src1", step)

    # Assert
    ws = load_workspace(temp_ws)
    assert len(ws.sources[0].recipe.operations) == 2
    assert ws.sources[0].recipe.operations[1].type == "filter_rows"
    assert ws.sources[0].recipe.operations[1].value == 1

    # Act: Update step
    new_step = {"type": "filter_rows", "column": "x", "operator": "==", "value": 2}
    update_recipe_step(temp_ws, "src1", 1, new_step)

    # Assert
    ws = load_workspace(temp_ws)
    assert ws.sources[0].recipe.operations[1].operator == "=="

    # Act: Remove step
    remove_recipe_step(temp_ws, "src1", 0)

    # Assert
    ws = load_workspace(temp_ws)
    assert len(ws.sources[0].recipe.operations) == 1
    assert ws.sources[0].recipe.operations[0].type == "filter_rows"


def test_targeted_materialization(tmp_path: Path):
    # Arrange: Create workspace with 2 sources
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    csv1 = tmp_path / "data" / "s1.csv"
    csv2 = tmp_path / "data" / "s2.csv"
    pd.DataFrame({"x": [1, 2]}).to_csv(csv1, index=False)
    pd.DataFrame({"y": [3, 4]}).to_csv(csv2, index=False)

    p1 = tmp_path / "out1.parquet"
    p2 = tmp_path / "out2.parquet"

    ws_path = tmp_path / "workspace.json"
    ws_path.write_text(
        json.dumps(
            {
                "project": "demo",
                "sources": [
                    {
                        "name": "s1",
                        "type": "csv",
                        "path": str(csv1),
                        "output_path": str(p1),
                    },
                    {
                        "name": "s2",
                        "type": "csv",
                        "path": str(csv2),
                        "output_path": str(p2),
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    # Act: Materialize only s1
    results = materialize_workspace(ws_path, source_names=["s1"])

    # Assert
    assert len(results) == 1
    assert results[0].source.name == "s1"
    assert p1.exists()
    assert not p2.exists()
