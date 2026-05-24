import pandas as pd
from clear_query.recipes.types import Unique


def apply_unique(df: pd.DataFrame, op: Unique) -> pd.DataFrame:
    if op.column:
        return df.drop_duplicates(subset=[op.column])
    return df.drop_duplicates()