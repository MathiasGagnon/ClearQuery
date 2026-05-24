import pandas as pd
from clear_query.recipes.types import RenameColumn


def apply_rename(df: pd.DataFrame, op: RenameColumn) -> pd.DataFrame:
    return df.rename(columns={op.old_name: op.new_name})