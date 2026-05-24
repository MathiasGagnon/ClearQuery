# src/clear_query/recipes/recipe_parser.py

from clear_query.recipes.types import Recipe


def parse_recipe(data: dict) -> Recipe:
    return Recipe.model_validate(data)