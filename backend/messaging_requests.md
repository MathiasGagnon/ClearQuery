# Messaging playground requests (one JSON per line)

The backend messaging loop reads **one JSON object per line** from stdin and prints **one JSON response per line** to stdout.

## How to use

- With the playground: run `backend/play_messaging_subprocess.py` and paste the JSON lines below into its interactive prompt.
- With the Tk UI: run `backend/tk_messaging_client.py` and click “Start backend”.
- Or pipe a file into the backend:
  - `backend\.venv\Scripts\python.exe -m clear_query.messaging < requests.txt`

## Replace these placeholders

- `WORKSPACE_PATH`: absolute or relative path to your workspace JSON (example: `backend/test_project/test_workspace.json`)
- `SOURCE_NAME`: one of the `sources[].name` values returned by `load_workspace` (example: `sample_data`)

---

# Implemented commands (work today)

## 1) Load workspace

```json
{"id":"load-1","command":"load_workspace","args":{"workspace_path":"WORKSPACE_PATH"}}
```

## 2) Preview a source (applies recipe)

```json
{"id":"preview-1","command":"get_preview","args":{"workspace_path":"WORKSPACE_PATH","source_name":"SOURCE_NAME","limit":5}}
```

## 3) Preview edge cases

Unknown source:

```json
{"id":"preview-unknown","command":"get_preview","args":{"workspace_path":"WORKSPACE_PATH","source_name":"__does_not_exist__","limit":5}}
```

Limit = 0 (no rows):

```json
{"id":"preview-limit-0","command":"get_preview","args":{"workspace_path":"WORKSPACE_PATH","source_name":"SOURCE_NAME","limit":0}}
```

Bad command:

```json
{"id":"bad-command","command":"nope","args":{}}
```

Bad args shape:

```json
{"id":"bad-args","command":"load_workspace","args":"not-an-object"}
```

---

# Not implemented yet (requests you can try once we add CRUD commands)

These align with the existing Python helpers in `clear_query.workspace.modifier` and are now supported by the messaging endpoint.

## A) Add a source

```json
{
  "id": "add-source-1",
  "command": "add_source",
  "args": {
    "workspace_path": "WORKSPACE_PATH",
    "source": {
      "name": "src2",
      "type": "csv",
      "path": "data/src2.csv",
      "csv_separator": ",",
      "csv_encoding": "utf-8",
      "recipe": [],
      "output_path": "data/src2.parquet"
    }
  }
}
```

## B) Remove a source

```json
{"id":"remove-source-1","command":"remove_source","args":{"workspace_path":"WORKSPACE_PATH","source_name":"src2"}}
```

## C) Add a recipe step

Example: append a filter step.

```json
{
  "id": "add-step-1",
  "command": "add_recipe_step",
  "args": {
    "workspace_path": "WORKSPACE_PATH",
    "source_name": "SOURCE_NAME",
    "step": { "type": "filter_rows", "column": "a", "operator": ">", "value": 2 }
  }
}
```

## D) Update a recipe step (by index)

```json
{
  "id": "update-step-1",
  "command": "update_recipe_step",
  "args": {
    "workspace_path": "WORKSPACE_PATH",
    "source_name": "SOURCE_NAME",
    "step_index": 0,
    "step": { "type": "unique" }
  }
}
```

## E) Remove a recipe step (by index)

```json
{"id":"remove-step-1","command":"remove_recipe_step","args":{"workspace_path":"WORKSPACE_PATH","source_name":"SOURCE_NAME","step_index":0}}
```
