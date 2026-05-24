# src/clear_query/recipes/validator.py

from clear_query.recipes.types import Recipe


def validate_recipe(recipe: Recipe) -> None:
    if not recipe.operations:
        raise ValueError("Recipe cannot be empty")

    for op in recipe.operations:
        if not hasattr(op, "type"):
            raise ValueError("Invalid operation: missing type")