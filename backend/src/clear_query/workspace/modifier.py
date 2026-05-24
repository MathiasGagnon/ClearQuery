import json
from pathlib import Path
from typing import Any

from clear_query.recipes.types import Recipe, RecipeOperation
from clear_query.workspace.loader import load_workspace
from clear_query.workspace.types import Workspace, Source


def save_workspace(workspace_path: str | Path, workspace: Workspace) -> None:
    """
    Serialize a Workspace model back to a JSON file, sanitizing paths.
    """
    if hasattr(workspace, "model_dump"):
        data = workspace.model_dump(exclude_none=True)
    else:
        data = workspace.dict(exclude_none=True)

    def clean_obj(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: clean_obj(v) for k, v in obj.items() if v is not None}
        elif isinstance(obj, list):
            return [clean_obj(v) for v in obj]
        elif isinstance(obj, Path):
            return str(obj).replace("\\", "/")
        return obj

    cleaned_data = clean_obj(data)

    # Root key drift: keep the root key as 'project' if it was originally 'project'
    # load_workspace converts 'project' -> 'name'. We write 'name' back as 'project' or 'name'.
    # For safety, let's keep 'name' as it's the official Workspace attribute,
    # but let's also preserve 'project' root key format if we want it to be perfectly backward compatible.
    # We can write both or map 'name' back to 'project' if we detect the original file used 'project'.
    try:
        raw_orig = json.loads(Path(workspace_path).read_text(encoding="utf-8"))
        if "project" in raw_orig:
            cleaned_data["project"] = cleaned_data.pop("name")
    except Exception:
        pass

    Path(workspace_path).write_text(
        json.dumps(cleaned_data, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )


def add_source(workspace_path: str | Path, source_data: dict) -> Source:
    """
    Add a source to the workspace.
    """
    workspace = load_workspace(workspace_path)

    # Normalize recipe list if present in input dict
    recipe = source_data.get("recipe")
    if isinstance(recipe, list):
        source_data["recipe"] = {"operations": recipe}

    if hasattr(Source, "model_validate"):
        new_source = Source.model_validate(source_data)
    else:
        new_source = Source.parse_obj(source_data)

    # Check for duplicate source name
    if any(s.name == new_source.name for s in workspace.sources):
        raise ValueError(f"Source '{new_source.name}' already exists in the workspace.")

    workspace.sources.append(new_source)
    save_workspace(workspace_path, workspace)
    return new_source


def remove_source(workspace_path: str | Path, source_name: str) -> None:
    """
    Remove a source from the workspace by name.
    """
    workspace = load_workspace(workspace_path)

    initial_len = len(workspace.sources)
    workspace.sources = [s for s in workspace.sources if s.name != source_name]

    if len(workspace.sources) == initial_len:
        raise ValueError(f"Source '{source_name}' does not exist in the workspace.")

    save_workspace(workspace_path, workspace)


def add_recipe_step(workspace_path: str | Path, source_name: str, step_data: dict) -> RecipeOperation:
    """
    Add a recipe step to a source.
    """
    workspace = load_workspace(workspace_path)

    source = next((s for s in workspace.sources if s.name == source_name), None)
    if source is None:
        raise ValueError(f"Source '{source_name}' does not exist in the workspace.")

    # Validate step_data by parsing it into a Recipe
    payload = {"operations": [step_data]}
    recipe_parsed = Recipe.model_validate(payload) if hasattr(Recipe, "model_validate") else Recipe.parse_obj(payload)
    new_op = recipe_parsed.operations[0]

    source.recipe.operations.append(new_op)

    save_workspace(workspace_path, workspace)
    return new_op


def remove_recipe_step(workspace_path: str | Path, source_name: str, step_index: int) -> None:
    """
    Remove a recipe step from a source by index.
    """
    workspace = load_workspace(workspace_path)

    source = next((s for s in workspace.sources if s.name == source_name), None)
    if source is None:
        raise ValueError(f"Source '{source_name}' does not exist in the workspace.")

    if step_index < 0 or step_index >= len(source.recipe.operations):
        raise IndexError(f"Recipe step index {step_index} is out of bounds for source '{source_name}'.")

    source.recipe.operations.pop(step_index)

    save_workspace(workspace_path, workspace)


def update_recipe_step(workspace_path: str | Path, source_name: str, step_index: int, step_data: dict) -> RecipeOperation:
    """
    Update an existing recipe step of a source by index.
    """
    workspace = load_workspace(workspace_path)

    source = next((s for s in workspace.sources if s.name == source_name), None)
    if source is None:
        raise ValueError(f"Source '{source_name}' does not exist in the workspace.")

    if step_index < 0 or step_index >= len(source.recipe.operations):
        raise IndexError(f"Recipe step index {step_index} is out of bounds for source '{source_name}'.")

    payload = {"operations": [step_data]}
    recipe_parsed = Recipe.model_validate(payload) if hasattr(Recipe, "model_validate") else Recipe.parse_obj(payload)
    updated_op = recipe_parsed.operations[0]

    source.recipe.operations[step_index] = updated_op

    save_workspace(workspace_path, workspace)
    return updated_op
