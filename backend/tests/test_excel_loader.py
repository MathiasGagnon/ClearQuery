import pandas as pd
import pytest

from clear_query.datasets.loaders.excel_loader import ExcelLoaderInput, excel_loader


def test_excel_loader(tmp_path):
    file = tmp_path / "test.xlsx"

    df_input = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    df_input.to_excel(file, index=False)

    config = ExcelLoaderInput(file_path=str(file), sheet_name=0)
    df = excel_loader(config)

    assert isinstance(df, pd.DataFrame)
    assert df.shape == (2, 2)
    assert list(df.columns) == ["a", "b"]