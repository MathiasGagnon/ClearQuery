import pandas as pd
from clear_query.recipes.types import Sort


def apply_sort(df: pd.DataFrame, op: Sort) -> pd.DataFrame:
    return df.sort_values(by=op.column, ascending=op.ascending)