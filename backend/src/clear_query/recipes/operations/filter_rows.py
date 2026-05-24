import pandas as pd
from clear_query.recipes.types import FilterRows


def apply_filter(df: pd.DataFrame, op: FilterRows) -> pd.DataFrame:
    if op.operator == "==":
        return df[df[op.column] == op.value]
    if op.operator == "!=":
        return df[df[op.column] != op.value]
    if op.operator == ">":
        return df[df[op.column] > op.value]
    if op.operator == "<":
        return df[df[op.column] < op.value]
    if op.operator == ">=":
        return df[df[op.column] >= op.value]
    if op.operator == "<=":
        return df[df[op.column] <= op.value]

    raise ValueError(f"Unknown operator: {op.operator}")