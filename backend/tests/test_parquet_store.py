import pandas as pd
from clear_query.datasets.parquet_store import ParquetWriteInput, ParquetReadInput, write_parquet, read_parquet


def test_parquet_roundtrip(tmp_path):
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})

    file_path = tmp_path / "test.parquet"

    write_parquet(ParquetWriteInput(df=df, output_path=file_path))

    result = read_parquet(ParquetReadInput(file_path=file_path))

    assert result.shape == (2, 2)
    assert list(result.columns) == ["a", "b"]