# ClearQuery — Release & Distribution Guide

## Prerequisites (your machine, one-time)

```powershell
npm install -g @vscode/vsce
```

Python 3.10+ must be on your PATH with pip available.

---

## How the bundle works

When you run `vsce package`, three things happen automatically (via `vscode:prepublish`):

1. **`copy-backend`** — copies `backend/src/clear_query/` into the extension folder at
   `frontend/clear-query/backend/src/clear_query/`

2. **`vendor`** — runs `pip install --target backend/vendor/ -r backend/requirements-prod.txt`
   This installs all Python dependencies (pandas, pyarrow, pymysql, etc.) into a local folder
   bundled inside the .vsix. The boss's Python installation is never touched.

3. **`compile`** — compiles TypeScript → JavaScript

The vendor folder is Windows-specific (compiled .pyd extensions). Rebuild on Mac/Linux
if distributing cross-platform.

Both `backend/src/` and `backend/vendor/` are in `.gitignore` (generated, not committed)
but are included in the `.vsix` package.

---

## To build and package

```powershell
cd "frontend\clear-query"
vsce package
# Produces: clear-query-0.0.1.vsix (~85 MB due to pandas + pyarrow)
```

Bump the version in `frontend/clear-query/package.json` before each release:
```json
"version": "0.1.0"
```

---

## What to send your boss

- The `.vsix` file
- These setup instructions (below)

---

## Boss setup instructions

### Prerequisites (one-time)

1. Install **Python 3.10+**
   - Download from https://www.python.org/downloads/
   - During install: check **"Add Python to PATH"**
   - Verify: open a terminal and run `python --version`

2. No `pip install` needed — all packages are bundled inside the extension.

### Install the extension

1. Open VS Code
2. Go to **Extensions** (Ctrl+Shift+X)
3. Click the **···** menu (top-right of the Extensions panel)
4. Choose **Install from VSIX…**
5. Select the `clear-query-x.x.x.vsix` file

### Configure MariaDB connection

1. Open **Settings** (Ctrl+,)
2. Search for `clearquery`
3. Fill in:
   - `clearquery.connection.host` — e.g. `localhost`
   - `clearquery.connection.port` — e.g. `3306`
   - `clearquery.connection.database` — your database name
   - `clearquery.connection.user` — your MariaDB username
4. The password is **never saved** — you will be prompted for it on the first query of each session.

### If Python is not on PATH

Set the full path to your Python executable in Settings:
- `clearquery.pythonPath` — e.g. `C:\Python312\python.exe`

### Open a workspace

1. Click the **ClearQuery icon** in the activity bar (left sidebar)
2. Click **Open Workspace**
3. Navigate to and select a `workspace.json` file

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "ClearQuery backend crashed after 3 restart attempts" | Python not found | Check `clearquery.pythonPath` in Settings |
| "No workspace open" | No workspace.json loaded | Click Open Workspace in the ClearQuery panel |
| "No MariaDB connection configured" | Settings not filled in | See Configure MariaDB connection above |
| Query returns empty results | Column/table names with spaces | Double-click columns from the sources pane to insert with backticks |

---

## Re-packaging after backend changes

If you change any Python files in `backend/src/`:

```powershell
cd "frontend\clear-query"
vsce package
```

`copy-backend` runs automatically and picks up the changes.

If you add a new Python dependency:
1. Add it to `backend/requirements.txt` (dev, includes pytest)
2. Add it to `backend/requirements-prod.txt` (bundled, no pytest)
3. Run `vsce package` — `vendor` will reinstall everything

---

## File layout reference

```
ClearQuery/
  backend/
    src/clear_query/        ← Python source (edit here)
    requirements.txt        ← dev dependencies (includes pytest)
    requirements-prod.txt   ← bundled dependencies (no pytest)
  frontend/clear-query/
    src/                    ← TypeScript source (edit here)
    webviews/               ← HTML/JS panels (edit here)
    backend/                ← GENERATED, do not edit
      src/clear_query/      ← copy of backend/src/clear_query/
      vendor/               ← pip install --target output
    out/                    ← compiled JS, do not edit
    package.json            ← version number lives here
    .vscodeignore           ← controls what ends up in the .vsix
    .gitignore              ← backend/src/ and backend/vendor/ excluded from git
```
