from pydantic import BaseModel, FilePath, ConfigDict
import pandas as pd
from pathlib import Path
from typing import Optional


class ParquetWriteInput(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    df: pd.DataFrame
    output_path: Path
    index: bool = False
    compression: Optional[str] = "snappy"


class ParquetReadInput(BaseModel):
    file_path: FilePath

    model_config = ConfigDict(arbitrary_types_allowed=True)


def write_parquet(config: ParquetWriteInput) -> Path:
    """
    Write a DataFrame to a parquet file.

    Returns:
        Path to written file
    """
    config.output_path.parent.mkdir(parents=True, exist_ok=True)

    config.df.to_parquet(
        config.output_path,
        index=config.index,
        compression=config.compression,
    )

    return config.output_path


def read_parquet(config: ParquetReadInput) -> pd.DataFrame:
    """
    Read a parquet file into a DataFrame.
    """
    return pd.read_parquet(config.file_path)