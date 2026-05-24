import pandas as pd

from clear_query.recipes.types import ReplaceValue


def _cast_scalar_to_dtype(value, dtype) -> object:
    if value is None:
        return None

    # Datetime
    if pd.api.types.is_datetime64_any_dtype(dtype):
        try:
            return pd.to_datetime(value, errors="raise")
        except Exception as exc:
            raise ValueError(f"Cannot cast value to datetime: {value!r}") from exc

    # Boolean
    if pd.api.types.is_bool_dtype(dtype):
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)
        if isinstance(value, str):
            v = value.strip().lower()
            if v in {"true", "1", "yes"}:
                return True
            if v in {"false", "0", "no"}:
                return False
        raise ValueError(f"Cannot cast value to boolean: {value!r}")

    # Numeric (int/float)
    if pd.api.types.is_integer_dtype(dtype):
        try:
            return pd.to_numeric([value], errors="raise").astype("Int64")[0]
        except Exception as exc:
            raise ValueError(f"Cannot cast value to int: {value!r}") from exc

    if pd.api.types.is_float_dtype(dtype):
        try:
            return float(pd.to_numeric([value], errors="raise")[0])
        except Exception as exc:
            raise ValueError(f"Cannot cast value to float: {value!r}") from exc

    # Default: string-like / object
    return str(value)


def apply_replace_value(df: pd.DataFrame, op: ReplaceValue) -> pd.DataFrame:
    """
    Replace an exact match value in a column with another value.

    Casting rules:
    - Both `op.value` and `op.replacement` are cast to the column dtype.
    - If casting fails, raise ValueError.
    """
    if op.column not in df.columns:
        raise ValueError(f"Column not found: {op.column}")

    df = df.copy()
    series = df[op.column]

    target = _cast_scalar_to_dtype(op.value, series.dtype)
    replacement = _cast_scalar_to_dtype(op.replacement, series.dtype)

    df[op.column] = series.where(series != target, replacement)
    return df

