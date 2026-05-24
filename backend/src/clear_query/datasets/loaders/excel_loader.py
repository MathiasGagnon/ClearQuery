from pathlib import Path

import pandas as pd
from pydantic import BaseModel, FilePath


class ExcelLoaderInput(BaseModel):
    file_path: FilePath
    sheet_name: str | int = 0


def excel_loader(config: ExcelLoaderInput) -> pd.DataFrame:
    """
    Load an Excel sheet into a pandas DataFrame.

    Args:
        config: Validated Excel loader configuration.

    Returns:
        pandas.DataFrame
    """
    return pd.read_excel(
        config.file_path,
        sheet_name=config.sheet_name,
    )