import pandas as pd
from clear_query.recipes.types import ComputedColumn


def apply_computed_column(df: pd.DataFrame, op: ComputedColumn) -> pd.DataFrame:
    df = df.copy()

    # Create evaluation context where each column is accessible as a variable
    local_dict = {col: df[col] for col in df.columns}

    # Evaluate the expression
    try:
        # We allow pandas as 'pd' in the global scope if they want to call pd functions
        result = eval(op.expression, {"pd": pd}, local_dict)
    except Exception as e:
        raise ValueError(f"Error evaluating expression '{op.expression}': {e}") from e

    df[op.name] = result
    return df
