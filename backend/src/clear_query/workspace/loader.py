from __future__ import annotations

import json
from pathlib import Path

from clear_query.workspace.types import Workspace

def load_workspace(workspace_path: str | Path) -> Workspace:
    """
    Load and validate a workspace JSON file.

    Notes:
    - Accepts both legacy root key `name` and current `project`.
    - Accepts both recipe shapes:
        - list[operation]  (legacy)
        - {"operations": [...]} (current Recipe model)
    """
    path = Path(workspace_path)
    raw = json.loads(path.read_text(encoding="utf-8"))

    # Root key drift: support `project` and `name`.
    if "name" not in raw and "project" in raw:
        raw = dict(raw)
        raw["name"] = raw["project"]

    sources = []
    for src in raw.get("sources", []):
        src = dict(src)
        recipe = src.get("recipe")
        if isinstance(recipe, list):
            src["recipe"] = {"operations": recipe}
        sources.append(src)

    raw["sources"] = sources

    if hasattr(Workspace, "model_validate"):
        return Workspace.model_validate(raw)  # pydantic v2
    return Workspace.parse_obj(raw)  # pydantic v1
