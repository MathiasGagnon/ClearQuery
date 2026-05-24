import json
from pathlib import Path

import pandas as pd

from clear_query.datasets.materialize import materialize_workspace
from clear_query.workspace.loader import load_workspace


def test_materialize_workspace_writes_parquet(tmp_path: Path):
    # Arrange: CSV + workspace config
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    csv_path = tmp_path / "data" / "sample.csv"
    pd.DataFrame({"name": ["A", "A", "B"], "age": [10, 20, 30]}).to_csv(csv_path, index=False)

    out_parquet = tmp_path / "workspace_out" / "sample.parquet"

    ws_path = tmp_path / "workspace.json"
    ws_path.write_text(
        json.dumps(
            {
                "project": "demo",
                "sources": [
                    {
                        "name": "sample",
                        "type": "csv",
                        "path": str(csv_path.relative_to(tmp_path)),
                        "recipe": [
                            {"type": "unique"},
                            {"type": "filter_rows", "column": "age", "operator": ">", "value": 15},
                        ],
                        "output_path": str(out_parquet)
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    # Act
    results = materialize_workspace(ws_path)

    # Assert
    assert len(results) == 1
    assert results[0].parquet_path.exists()
    assert results[0].parquet_path.suffix == ".parquet"
    assert (results[0].df["age"] > 15).all()


