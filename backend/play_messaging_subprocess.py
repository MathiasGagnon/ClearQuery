from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _backend_src() -> Path:
    return _repo_root() / "backend" / "src"


def _python_executable() -> str:
    """
    Prefer the currently-running interpreter. If you run this script with the
    backend venv interpreter, it'll use that venv for the subprocess too.
    """
    return sys.executable


def _start_backend() -> subprocess.Popen[str]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    # Ensure `clear_query` is importable even if not installed as a package.
    backend_src = str(_backend_src())
    env["PYTHONPATH"] = backend_src + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

    # Run the messaging loop as a module so relative imports behave.
    cmd = [_python_executable(), "-m", "clear_query.messaging"]
    return subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,  # line-buffered
        env=env,
        cwd=str(_repo_root()),
    )


def _send(proc: subprocess.Popen[str], payload: dict[str, Any]) -> dict[str, Any]:
    assert proc.stdin is not None
    assert proc.stdout is not None

    proc.stdin.write(json.dumps(payload) + "\n")
    proc.stdin.flush()

    while True:
        line = proc.stdout.readline()
        if not line:
            err = ""
            if proc.stderr is not None:
                err = proc.stderr.read() or ""
            raise RuntimeError(f"Backend exited or produced no output.\nSTDERR:\n{err}")
        if not line.strip():
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            # If the backend ever emits non-JSON (or partial) lines, keep reading.
            continue


def main() -> int:
    # Optional: pass a workspace path as argv[1], otherwise use an example location.
    workspace_path = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else (Path.cwd() / "backend" / "test_project" / "test_workspace.json")

    proc = _start_backend()
    try:
        # 1) Load workspace first so we can preview an actual source_name present in that file.
        load_req = {
            "id": "load-1",
            "command": "load_workspace",
            "args": {"workspace_path": str(workspace_path)},
        }
        load_resp = _send(proc, load_req)
        print("\n>>> load-1")
        print(json.dumps(load_resp, indent=2, ensure_ascii=False))

        first_source_name: str | None = None
        try:
            sources = load_resp.get("data", {}).get("sources", [])
            if sources and isinstance(sources, list) and isinstance(sources[0], dict):
                first_source_name = sources[0].get("name")
        except Exception:
            first_source_name = None

        if not first_source_name:
            first_source_name = "src1"  # fallback for the unit-test workspace shape

        commands: list[dict[str, Any]] = [
            {
                "id": "preview-1",
                "command": "get_preview",
                "args": {"workspace_path": str(workspace_path), "source_name": first_source_name, "limit": 5},
            },
            # Variations / error cases to play with:
            {
                "id": "preview-unknown-source",
                "command": "get_preview",
                "args": {"workspace_path": str(workspace_path), "source_name": "__does_not_exist__", "limit": 3},
            },
            {
                "id": "bad-command",
                "command": "nope",
                "args": {},
            },
            {
                "id": "bad-args-shape",
                "command": "load_workspace",
                "args": "not-an-object",
            },
        ]

        for req in commands:
            resp = _send(proc, req)
            print(f"\n>>> {req['id']}")
            print(json.dumps(resp, indent=2, ensure_ascii=False))

        # Interactive mode (optional): type JSON requests, one per line.
        print("\nInteractive mode: type a JSON request per line (or Ctrl+Z then Enter to quit).")
        while True:
            try:
                line = input("> ").strip()
            except EOFError:
                break
            if not line:
                continue
            try:
                req = json.loads(line)
                if not isinstance(req, dict):
                    print("Request must be a JSON object.")
                    continue
                resp = _send(proc, req)
                print(json.dumps(resp, indent=2, ensure_ascii=False))
            except Exception as exc:
                print(f"Error: {exc}")

        return 0
    finally:
        try:
            proc.terminate()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
