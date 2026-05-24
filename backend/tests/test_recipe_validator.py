import pytest

from clear_query.recipes.types import Recipe
from clear_query.recipes.validator import validate_recipe


def test_validate_recipe_rejects_empty():
    recipe = Recipe.model_validate({"operations": []})
    with pytest.raises(ValueError, match="cannot be empty"):
        validate_recipe(recipe)

