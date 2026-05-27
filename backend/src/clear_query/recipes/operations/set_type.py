import pandas as pd
from clear_query.recipes.types import SetType


def apply_set_type(df: pd.DataFrame, op: SetType) -> pd.DataFrame:
    df = df.copy()
    col = op.column
    dtype = op.dtype

    if dtype == "string":
        # Use pandas nullable string type
        df[col] = df[col].astype("string")
    elif dtype == "int":
        # Convert to numeric, then nullable Int64
        df[col] = pd.to_numeric(df[col], errors="raise").astype("Int64")
    elif dtype == "float":
        df[col] = pd.to_numeric(df[col], errors="raise").astype(float)
    elif dtype == "datetime":
        df[col] = pd.to_datetime(df[col], errors="raise")
    else:
        raise ValueError(f"Unsupported dtype: {dtype}")

    return df
