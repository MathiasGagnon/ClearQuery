import json
import tempfile
from pathlib import Path

import pandas as pd
import pytest

from clear_query.messaging import handle_get_sources_schema
from clear_query.datasets.parquet_store import write_parquet, ParquetWriteInput
from clear_query.workspace.modifier import save_workspace
from clear_query.workspace.types import Workspace, Source, MaterializedTable


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        artifacts_dir = tmpdir_path / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        # Create workspace with two sources
        workspace = Workspace(
            name="test_workspace",
            sources=[
                Source(
                    name="source_with_artifact",
                    type="csv",
                    path="dummy.csv",
                ),
                Source(
                    name="source_without_artifact",
                    type="csv",
                    path="dummy2.csv",
                ),
            ],
        )

        workspace_file = tmpdir_path / "workspace.json"
        save_workspace(workspace_file, workspace)

        # Create a parquet artifact for the first source
        df_with_artifact = pd.DataFrame({
            "id": pd.array([1, 2, 3], dtype="Int64"),
            "name": pd.array(["Alice", "Bob", "Charlie"], dtype="string"),
            "amount": [10.5, 20.3, 15.7],
        })
        config = ParquetWriteInput(
            df=df_with_artifact,
            output_path=artifacts_dir / "source_with_artifact.parquet",
        )
        write_parquet(config)

        yield {
            "workspace_path": str(workspace_file),
            "artifacts_dir": artifacts_dir,
            "workspace_file": workspace_file,
        }


def test_get_sources_schema_with_parquet_artifact(temp_workspace):
    """Test that schema is read from parquet artifact when available."""
    result = handle_get_sources_schema({
        "workspace_path": temp_workspace["workspace_path"]
    })

    assert "sources" in result
    sources = result["sources"]
    assert len(sources) == 2

    # Source with artifact should have columns and schema_source=parquet_artifact
    source_with = sources[0]
    assert source_with["name"] == "source_with_artifact"
    assert source_with["schema_source"] == "parquet_artifact"
    assert "columns" in source_with
    assert len(source_with["columns"]) == 3

    # Check column details
    col_names = {col["name"] for col in source_with["columns"]}
    assert col_names == {"id", "name", "amount"}

    # Check dtypes from parquet
    dtypes = {col["name"]: col["dtype"] for col in source_with["columns"]}
    assert dtypes["id"] == "Int64"
    assert dtypes["name"] == "string"
    assert dtypes["amount"] == "float64"


def test_get_sources_schema_without_parquet_artifact(temp_workspace):
    """Test that sources without parquet artifacts show schema_source=none."""
    result = handle_get_sources_schema({
        "workspace_path": temp_workspace["workspace_path"]
    })

    sources = result["sources"]

    # Source without artifact should not have columns
    source_without = sources[1]
    assert source_without["name"] == "source_without_artifact"
    assert source_without["schema_source"] == "none"
    # Should not have columns key or it should be empty
    assert not source_without.get("columns", [])
    assert "error" not in source_without


def test_get_sources_schema_response_structure(temp_workspace):
    """Test that the response has the expected structure."""
    result = handle_get_sources_schema({
        "workspace_path": temp_workspace["workspace_path"]
    })

    assert isinstance(result, dict)
    assert "sources" in result
    assert isinstance(result["sources"], list)

    for src in result["sources"]:
        assert "name" in src
        assert "type" in src
        assert "schema_source" in src
        # schema_source should be either "parquet_artifact" or "none"
        assert src["schema_source"] in {"parquet_artifact", "none"}


def test_get_sources_schema_multiple_parquet_artifacts():
    """Test with multiple sources having parquet artifacts."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir_path = Path(tmpdir)
        artifacts_dir = tmpdir_path / "artifacts"
        artifacts_dir.mkdir(parents=True, exist_ok=True)

        # Create workspace
        workspace = Workspace(
            name="test_workspace",
            sources=[
                Source(name="source1", type="csv", path="dummy1.csv"),
                Source(name="source2", type="csv", path="dummy2.csv"),
                Source(name="source3", type="csv", path="dummy3.csv"),
            ],
        )

        workspace_file = tmpdir_path / "workspace.json"
        save_workspace(workspace_file, workspace)

        # Create parquet artifacts for sources 1 and 2
        for i in [1, 2]:
            df = pd.DataFrame({
                "col1": pd.array([1, 2], dtype="Int64"),
                "col2": pd.array(["a", "b"], dtype="string"),
            })
            config = ParquetWriteInput(
                df=df,
                output_path=artifacts_dir / f"source{i}.parquet",
            )
            write_parquet(config)

        result = handle_get_sources_schema({
            "workspace_path": str(workspace_file)
        })

        sources = result["sources"]
        assert len(sources) == 3

        # Sources 1 and 2 should have artifacts
        assert sources[0]["schema_source"] == "parquet_artifact"
        assert len(sources[0]["columns"]) == 2

        assert sources[1]["schema_source"] == "parquet_artifact"
        assert len(sources[1]["columns"]) == 2

        # Source 3 should not have artifact
        assert sources[2]["schema_source"] == "none"
        assert not sources[2].get("columns", [])
