import pandas as pd
import pytest

from clear_query.datasets.loaders.csv_loader import CSVLoaderInput, csv_loader


def test_csv_loader(tmp_path):
    file = tmp_path / "test.csv"
    file.write_text("a,b\n1,2\n3,4\n")

    config = CSVLoaderInput(file_path=str(file))
    df = csv_loader(config)

    assert isinstance(df, pd.DataFrame)
    assert df.shape == (2, 2)
    assert list(df.columns) == ["a", "b"]


def test_csv_loader_separator_and_encoding(tmp_path):
    file = tmp_path / "test_sc.csv"
    # latin-1 encoded content with a non-ascii character
    content = "col1;col2\ncafé;2\n".encode("latin-1")
    file.write_bytes(content)

    config = CSVLoaderInput(file_path=str(file), separator=";", encoding="latin-1")
    df = csv_loader(config)

    assert df["col1"].tolist() == ["café"]
    assert df["col2"].tolist() == [2]
