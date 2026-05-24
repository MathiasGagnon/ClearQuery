# csv_loader.py

from pathlib import Path

import pandas as pd
from pydantic import BaseModel, FilePath


class CSVLoaderInput(BaseModel):
    file_path: FilePath
    separator: str = ","
    encoding: str = "utf-8"


def csv_loader(config: CSVLoaderInput) -> pd.DataFrame:
    """
    Load a CSV file into a pandas DataFrame.

    Args:
        config: Validated CSV loader configuration.

    Returns:
        pandas.DataFrame
    """
    return pd.read_csv(config.file_path, sep=config.separator, encoding=config.encoding)
