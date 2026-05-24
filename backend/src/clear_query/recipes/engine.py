# src/clear_query/recipes/engine.py

import pandas as pd

from clear_query.recipes.types import Recipe
from clear_query.recipes.operations.filter_rows import apply_filter
from clear_query.recipes.operations.rename_column import apply_rename
from clear_query.recipes.operations.unique import apply_unique
from clear_query.recipes.operations.sort import apply_sort
from clear_query.recipes.operations.set_type import apply_set_type
from clear_query.recipes.operations.computed_column import apply_computed_column
from clear_query.recipes.operations.replace_value import apply_replace_value
from clear_query.recipes.validator import validate_recipe


def run_recipe(df: pd.DataFrame, recipe: Recipe) -> pd.DataFrame:
    validate_recipe(recipe)

    for op in recipe.operations:
        if op.type == "filter_rows":
            df = apply_filter(df, op)

        elif op.type == "rename_column":
            df = apply_rename(df, op)

        elif op.type == "unique":
            df = apply_unique(df, op)

        elif op.type == "sort":
            df = apply_sort(df, op)

        elif op.type == "set_type":
            df = apply_set_type(df, op)

        elif op.type == "computed_column":
            df = apply_computed_column(df, op)

        elif op.type == "replace_value":
            df = apply_replace_value(df, op)

        else:
            raise ValueError(f"Unknown operation: {op.type}")

    return df
