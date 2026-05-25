from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
import time
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _backend_src() -> Path:
    return _repo_root() / "backend" / "src"


def _pretty_json(obj: Any) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def _parse_json_maybe(text: str) -> Any:
    text = text.strip()
    if not text:
        return None
    return json.loads(text)


@dataclass
class BackendProcess:
    proc: subprocess.Popen[str]
    stdout_thread: threading.Thread
    stderr_thread: threading.Thread
    out_queue: queue.Queue[tuple[str, str]]  # (stream, line)


class MessagingClientApp(tk.Tk):
    COMMANDS = [
        "load_workspace",
        "get_preview",
        "sql_preview",
        "add_source",
        "remove_source",
        "add_recipe_step",
        "update_recipe_step",
        "remove_recipe_step",
    ]
    STEP_OP_TYPES = [
        "filter_rows",
        "rename_column",
        "unique",
        "sort",
        "set_type",
        "computed_column",
        "replace_value",
    ]

    def __init__(self) -> None:
        super().__init__()
        self.title("ClearQuery Messaging Client (Tkinter)")
        self.geometry("980x720")

        self._backend: BackendProcess | None = None
        self._next_id = 1

        self._python_var = tk.StringVar(value=sys.executable)
        self._workspace_var = tk.StringVar(value=str(_repo_root() / "backend" / "test_project" / "test_workspace.json"))
        self._command_var = tk.StringVar(value="load_workspace")

        self._source_name_var = tk.StringVar(value="")
        self._limit_var = tk.StringVar(value="10")
        self._step_index_var = tk.StringVar(value="0")
        self._csv_sep_var = tk.StringVar(value=",")
        self._csv_enc_var = tk.StringVar(value="utf-8")
        self._step_op_type_var = tk.StringVar(value="filter_rows")

        # SQL page
        self._sql_host_var = tk.StringVar(value="localhost")
        self._sql_port_var = tk.StringVar(value="3306")
        self._sql_db_var = tk.StringVar(value="")
        self._sql_user_var = tk.StringVar(value="")
        self._sql_password_var = tk.StringVar(value="")
        self._sql_limit_var = tk.StringVar(value="50")
        self._last_sql_request_id: str | None = None
        self._last_sources_request_id: str | None = None

        self._build_ui()
        self._refresh_form()

        self.after(100, self._drain_backend_output)

    # -------------------------
    # UI
    # -------------------------
    def _build_ui(self) -> None:
        top = ttk.Frame(self)
        top.pack(side=tk.TOP, fill=tk.X, padx=10, pady=10)

        ttk.Label(top, text="Python:").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self._python_var, width=80).grid(row=0, column=1, sticky="we", padx=(6, 6))
        ttk.Button(top, text="Use current", command=self._use_current_python).grid(row=0, column=2, sticky="e")

        btns = ttk.Frame(top)
        btns.grid(row=1, column=2, sticky="e", pady=(8, 0))
        ttk.Button(btns, text="Start backend", command=self._start_backend).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(btns, text="Stop backend", command=self._stop_backend).pack(side=tk.LEFT)

        top.grid_columnconfigure(1, weight=1)

        pages = ttk.Notebook(self)
        pages.pack(side=tk.TOP, fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        page_ws = ttk.Frame(pages)
        page_sql = ttk.Frame(pages)
        pages.add(page_ws, text="Workspace")
        pages.add(page_sql, text="SQL")

        # Workspace page header
        ws_top = ttk.Frame(page_ws)
        ws_top.pack(side=tk.TOP, fill=tk.X, pady=(0, 10))

        ttk.Label(ws_top, text="Workspace:").grid(row=0, column=0, sticky="w")
        ws_entry = ttk.Entry(ws_top, textvariable=self._workspace_var, width=80)
        ws_entry.grid(row=0, column=1, sticky="we", padx=(6, 6))
        ws_entry.bind("<Double-Button-1>", lambda _e: self._browse_workspace())
        ws_btns = ttk.Frame(ws_top)
        ws_btns.grid(row=0, column=2, sticky="e")
        ttk.Button(ws_btns, text="Choose…", command=self._browse_workspace).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(ws_btns, text="New workspace…", command=self._new_workspace).pack(side=tk.LEFT)

        ttk.Label(ws_top, text="Command:").grid(row=1, column=0, sticky="w", pady=(8, 0))
        cmd = ttk.Combobox(ws_top, textvariable=self._command_var, values=self.COMMANDS, state="readonly")
        cmd.grid(row=1, column=1, sticky="w", padx=(6, 6), pady=(8, 0))
        cmd.bind("<<ComboboxSelected>>", lambda _e: self._refresh_form())

        ws_top.grid_columnconfigure(1, weight=1)

        # Workspace page body
        mid = ttk.Frame(page_ws)
        mid.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        self._form = ttk.LabelFrame(mid, text="Args")
        self._form.pack(side=tk.LEFT, fill=tk.BOTH, expand=False, padx=(0, 10))

        self._args_widgets: dict[str, tk.Widget] = {}
        self._build_form_widgets(self._form)

        right = ttk.Frame(mid)
        right.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        req_frame = ttk.LabelFrame(right, text="Request (auto-built)")
        req_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=False)
        self._request_text = tk.Text(req_frame, height=10, wrap="none")
        self._request_text.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        send_row = ttk.Frame(right)
        send_row.pack(side=tk.TOP, fill=tk.X, pady=(8, 8))
        ttk.Button(send_row, text="Build request", command=self._build_request_preview).pack(side=tk.LEFT)
        ttk.Button(send_row, text="Send", command=self._send_request).pack(side=tk.LEFT, padx=(6, 0))
        ttk.Button(send_row, text="Clear log", command=self._clear_log).pack(side=tk.RIGHT)

        log_frame = ttk.LabelFrame(right, text="Output (stdout/stderr)")
        log_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        tabs = ttk.Notebook(log_frame)
        tabs.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        log_tab = ttk.Frame(tabs)
        preview_tab = ttk.Frame(tabs)
        tabs.add(log_tab, text="Log")
        tabs.add(preview_tab, text="Preview")

        # Log tab
        self._log_text = tk.Text(log_tab, wrap="none")
        self._log_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        log_scroll = ttk.Scrollbar(log_tab, orient=tk.VERTICAL, command=self._log_text.yview)
        log_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self._log_text.configure(yscrollcommand=log_scroll.set)

        # Preview tab
        self._preview_tree = ttk.Treeview(preview_tab, show="headings")
        self._preview_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        pv_scroll_y = ttk.Scrollbar(preview_tab, orient=tk.VERTICAL, command=self._preview_tree.yview)
        pv_scroll_y.pack(side=tk.RIGHT, fill=tk.Y)
        pv_scroll_x = ttk.Scrollbar(preview_tab, orient=tk.HORIZONTAL, command=self._preview_tree.xview)
        pv_scroll_x.pack(side=tk.BOTTOM, fill=tk.X)
        self._preview_tree.configure(yscrollcommand=pv_scroll_y.set, xscrollcommand=pv_scroll_x.set)

        # SQL page
        sql_top = ttk.Frame(page_sql)
        sql_top.pack(side=tk.TOP, fill=tk.X, pady=(0, 10))

        ttk.Label(sql_top, text="Host").grid(row=0, column=0, sticky="w")
        ttk.Entry(sql_top, textvariable=self._sql_host_var, width=18).grid(row=0, column=1, sticky="w", padx=(6, 14))

        ttk.Label(sql_top, text="Port").grid(row=0, column=2, sticky="w")
        ttk.Entry(sql_top, textvariable=self._sql_port_var, width=8).grid(row=0, column=3, sticky="w", padx=(6, 14))

        ttk.Label(sql_top, text="Database").grid(row=0, column=4, sticky="w")
        ttk.Entry(sql_top, textvariable=self._sql_db_var, width=18).grid(row=0, column=5, sticky="w", padx=(6, 0))

        ttk.Label(sql_top, text="User").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Entry(sql_top, textvariable=self._sql_user_var, width=18).grid(row=1, column=1, sticky="w", padx=(6, 14), pady=(8, 0))

        ttk.Label(sql_top, text="Password").grid(row=1, column=2, sticky="w", pady=(8, 0))
        ttk.Entry(sql_top, textvariable=self._sql_password_var, width=18, show="*").grid(row=1, column=3, sticky="w", padx=(6, 14), pady=(8, 0))

        ttk.Label(sql_top, text="Limit").grid(row=1, column=4, sticky="w", pady=(8, 0))
        ttk.Entry(sql_top, textvariable=self._sql_limit_var, width=8).grid(row=1, column=5, sticky="w", padx=(6, 0), pady=(8, 0))

        sql_body = ttk.Panedwindow(page_sql, orient=tk.HORIZONTAL)
        sql_body.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Left pane: sources tree
        sources_frame = ttk.Frame(sql_body)
        sql_body.add(sources_frame, weight=1)

        sources_header = ttk.Frame(sources_frame)
        sources_header.pack(side=tk.TOP, fill=tk.X)
        ttk.Label(sources_header, text="Sources").pack(side=tk.LEFT)
        ttk.Button(sources_header, text="Refresh", command=self._refresh_sql_sources).pack(side=tk.RIGHT)

        self._sql_sources_tree = ttk.Treeview(sources_frame)
        self._sql_sources_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, pady=(6, 0))
        src_scroll = ttk.Scrollbar(sources_frame, orient=tk.VERTICAL, command=self._sql_sources_tree.yview)
        src_scroll.pack(side=tk.RIGHT, fill=tk.Y, pady=(6, 0))
        self._sql_sources_tree.configure(yscrollcommand=src_scroll.set)
        self._sql_sources_tree.bind("<Double-1>", self._on_sql_sources_double_click)

        # Right pane: query + results
        right_sql = ttk.Frame(sql_body)
        sql_body.add(right_sql, weight=3)

        query_frame = ttk.LabelFrame(right_sql, text="Query")
        query_frame.pack(side=tk.TOP, fill=tk.BOTH, expand=False)
        self._sql_query_text = tk.Text(query_frame, height=10, wrap="none")
        self._sql_query_text.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self._sql_query_text.insert("1.0", "SELECT 1 AS one;")

        run_row = ttk.Frame(right_sql)
        run_row.pack(side=tk.TOP, fill=tk.X, pady=(8, 8))
        ttk.Button(run_row, text="Run preview", command=self._run_sql_preview).pack(side=tk.LEFT)
        ttk.Button(run_row, text="Clear", command=lambda: self._sql_query_text.delete("1.0", tk.END)).pack(side=tk.LEFT, padx=(6, 0))

        sql_out = ttk.LabelFrame(right_sql, text="Results")
        sql_out.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self._sql_result_text = tk.Text(sql_out, wrap="none")
        self._sql_result_text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        sql_scroll = ttk.Scrollbar(sql_out, orient=tk.VERTICAL, command=self._sql_result_text.yview)
        sql_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self._sql_result_text.configure(yscrollcommand=sql_scroll.set)

        # Initial population (no-op if backend not running)
        self.after(250, self._refresh_sql_sources)

    def _build_form_widgets(self, parent: ttk.LabelFrame) -> None:
        # get_preview / remove_source / recipe step ops
        ttk.Label(parent, text="source_name").grid(row=0, column=0, sticky="w", padx=8, pady=(8, 2))
        e_source = ttk.Entry(parent, textvariable=self._source_name_var, width=40)
        e_source.grid(row=0, column=1, sticky="we", padx=8, pady=(8, 2))
        self._args_widgets["source_name"] = e_source

        ttk.Label(parent, text="limit").grid(row=1, column=0, sticky="w", padx=8, pady=2)
        e_limit = ttk.Entry(parent, textvariable=self._limit_var, width=40)
        e_limit.grid(row=1, column=1, sticky="we", padx=8, pady=2)
        self._args_widgets["limit"] = e_limit

        ttk.Label(parent, text="step_index").grid(row=2, column=0, sticky="w", padx=8, pady=2)
        e_idx = ttk.Entry(parent, textvariable=self._step_index_var, width=40)
        e_idx.grid(row=2, column=1, sticky="we", padx=8, pady=2)
        self._args_widgets["step_index"] = e_idx

        ttk.Label(parent, text="csv_separator").grid(row=3, column=0, sticky="w", padx=8, pady=(8, 2))
        e_sep = ttk.Entry(parent, textvariable=self._csv_sep_var, width=40)
        e_sep.grid(row=3, column=1, sticky="we", padx=8, pady=(8, 2))
        self._args_widgets["csv_separator"] = e_sep

        ttk.Label(parent, text="csv_encoding").grid(row=4, column=0, sticky="w", padx=8, pady=2)
        e_enc = ttk.Entry(parent, textvariable=self._csv_enc_var, width=40)
        e_enc.grid(row=4, column=1, sticky="we", padx=8, pady=2)
        self._args_widgets["csv_encoding"] = e_enc

        source_label_row = ttk.Frame(parent)
        source_label_row.grid(row=5, column=0, sticky="nw", padx=8, pady=(8, 2))
        ttk.Label(source_label_row, text="source (JSON)").pack(side=tk.LEFT)
        ttk.Button(source_label_row, text="Choose file…", command=self._choose_source_file).pack(side=tk.LEFT, padx=(8, 0))
        t_source = tk.Text(parent, height=10, width=48, wrap="none")
        t_source.grid(row=5, column=1, sticky="we", padx=8, pady=(8, 2))
        t_source.insert(
            "1.0",
            _pretty_json(
                {
                    "name": "src2",
                    "type": "csv",
                    "path": "data/src2.csv",
                    "csv_separator": ",",
                    "csv_encoding": "utf-8",
                    "recipe": [],
                    "output_path": "data/src2.parquet",
                }
            ),
        )
        self._args_widgets["source_json"] = t_source

        step_header = ttk.Frame(parent)
        step_header.grid(row=6, column=0, sticky="nw", padx=8, pady=(8, 2))
        ttk.Label(step_header, text="step (JSON)").grid(row=0, column=0, sticky="w")
        op_combo = ttk.Combobox(step_header, textvariable=self._step_op_type_var, values=self.STEP_OP_TYPES, state="readonly", width=16)
        op_combo.grid(row=0, column=1, sticky="w", padx=(8, 0))
        op_combo.bind("<<ComboboxSelected>>", lambda _e: self._set_step_json_template())
        self._args_widgets["step_op_type"] = op_combo
        step_header.grid_columnconfigure(1, weight=1)

        t_step = tk.Text(parent, height=8, width=48, wrap="none")
        t_step.grid(row=6, column=1, sticky="we", padx=8, pady=(8, 8))
        t_step.insert("1.0", _pretty_json(self._step_template_payload("filter_rows")))
        self._args_widgets["step_json"] = t_step

        parent.grid_columnconfigure(1, weight=1)

    def _step_template_payload(self, op_type: str) -> dict[str, Any]:
        if op_type == "filter_rows":
            return {"type": "filter_rows", "column": "x", "operator": ">", "value": 1}
        if op_type == "rename_column":
            return {"type": "rename_column", "old_name": "old_col", "new_name": "new_col"}
        if op_type == "unique":
            return {"type": "unique"}  # or {"type":"unique","column":"x"}
        if op_type == "sort":
            return {"type": "sort", "column": "x", "ascending": True}
        if op_type == "set_type":
            return {"type": "set_type", "column": "x", "dtype": "string"}
        if op_type == "computed_column":
            return {"type": "computed_column", "name": "total", "expression": "a + b"}
        if op_type == "replace_value":
            return {"type": "replace_value", "column": "x", "value": 1, "replacement": 0}
        return {"type": op_type}

    def _set_step_json_template(self) -> None:
        widget = self._args_widgets.get("step_json")
        if not isinstance(widget, tk.Text):
            return

        op_type = self._step_op_type_var.get().strip() or "filter_rows"
        payload = self._step_template_payload(op_type)
        widget.delete("1.0", tk.END)
        widget.insert("1.0", _pretty_json(payload))

    def _choose_source_file(self) -> None:
        """
        Pick a csv/xlsx file and update the `source` JSON payload accordingly.
        """
        path = filedialog.askopenfilename(
            title="Select source file",
            initialdir=str(Path(self._workspace_var.get()).resolve().parent) if self._workspace_var.get().strip() else str(_repo_root()),
            filetypes=[
                ("Data files", "*.csv *.xlsx"),
                ("CSV files", "*.csv"),
                ("Excel files", "*.xlsx"),
                ("All files", "*.*"),
            ],
        )
        if not path:
            return

        widget = self._args_widgets.get("source_json")
        if not isinstance(widget, tk.Text):
            return

        try:
            payload = _parse_json_maybe(widget.get("1.0", tk.END)) or {}
            if not isinstance(payload, dict):
                payload = {}
        except Exception:
            payload = {}

        p = Path(path)
        suffix = p.suffix.lower()
        src_type = "csv" if suffix == ".csv" else "xlsx" if suffix == ".xlsx" else payload.get("type", "csv")

        # Prefer storing relative paths to the workspace file if possible.
        ws_path = Path(self._workspace_var.get()).expanduser()
        try:
            base_dir = ws_path.resolve().parent
            rel = str(p.resolve().relative_to(base_dir)).replace("\\", "/")
            path_value: str = rel
        except Exception:
            path_value = str(p.resolve())

        if not payload.get("name"):
            payload["name"] = p.stem
        payload["type"] = src_type
        payload["path"] = path_value
        if src_type == "csv":
            payload.setdefault("csv_separator", self._csv_sep_var.get() or ",")
            payload.setdefault("csv_encoding", self._csv_enc_var.get() or "utf-8")

        widget.delete("1.0", tk.END)
        widget.insert("1.0", _pretty_json(payload))

    def _update_preview_table(self, columns: list[Any], rows: list[Any], dtypes: dict[str, Any] | None = None) -> None:
        cols = [str(c) for c in (columns or [])]
        if len(cols) > 200:
            cols = cols[:200]

        self._preview_tree.delete(*self._preview_tree.get_children())
        self._preview_tree["columns"] = cols

        for c in cols:
            dtype = None
            if dtypes and c in dtypes:
                dtype = dtypes.get(c)
            header = f"{c} ({dtype})" if dtype else c
            self._preview_tree.heading(c, text=header)
            self._preview_tree.column(c, width=120, stretch=True, anchor="w")

        if not rows:
            return

        max_rows = min(len(rows), 500)
        for i in range(max_rows):
            row = rows[i]
            if not isinstance(row, (list, tuple)):
                row = [row]
            values = ["" if v is None else str(v) for v in list(row)[: len(cols)]]
            if len(values) < len(cols):
                values.extend([""] * (len(cols) - len(values)))
            self._preview_tree.insert("", "end", values=values)

    # -------------------------
    # Backend process lifecycle
    # -------------------------
    def _start_backend(self) -> None:
        if self._backend is not None:
            messagebox.showinfo("Backend", "Backend is already running.")
            return

        python = self._python_var.get().strip()
        if not python:
            messagebox.showerror("Python", "Python executable is required.")
            return

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        backend_src = str(_backend_src())
        env["PYTHONPATH"] = backend_src + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

        cmd = [python, "-m", "clear_query.messaging"]
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=str(_repo_root()),
                env=env,
            )
        except Exception as exc:
            messagebox.showerror("Backend", f"Failed to start backend:\n{exc}")
            return

        out_q: queue.Queue[tuple[str, str]] = queue.Queue()

        def pump(stream_name: str, fp: Any) -> None:
            try:
                for line in fp:
                    out_q.put((stream_name, line))
            except Exception as exc:
                out_q.put((stream_name, f"[reader error] {exc}\n"))

        assert proc.stdout is not None
        assert proc.stderr is not None
        t_out = threading.Thread(target=pump, args=("stdout", proc.stdout), daemon=True)
        t_err = threading.Thread(target=pump, args=("stderr", proc.stderr), daemon=True)
        t_out.start()
        t_err.start()

        self._backend = BackendProcess(proc=proc, stdout_thread=t_out, stderr_thread=t_err, out_queue=out_q)
        self._log(f"[system] started backend: {' '.join(cmd)}\n")

    def _stop_backend(self) -> None:
        if self._backend is None:
            return

        proc = self._backend.proc
        try:
            proc.terminate()
        except Exception:
            pass

        self._backend = None
        self._log("[system] stopped backend\n")

    # -------------------------
    # Sending
    # -------------------------
    def _build_request(self) -> dict[str, Any]:
        workspace_path = self._workspace_var.get().strip()
        if not workspace_path:
            raise ValueError("workspace_path is required")

        cmd = self._command_var.get().strip()
        req_id = f"ui-{self._next_id}"
        self._next_id += 1

        args: dict[str, Any] = {"workspace_path": workspace_path}

        if cmd == "load_workspace":
            pass

        elif cmd == "sql_preview":
            conn = {
                "host": self._sql_host_var.get().strip(),
                "port": int(self._sql_port_var.get().strip() or "3306"),
                "database": self._sql_db_var.get().strip(),
                "user": self._sql_user_var.get().strip(),
                "password": self._sql_password_var.get(),
            }
            q = self._sql_query_text.get("1.0", tk.END).strip()
            if not q:
                raise ValueError("query is required for sql_preview")
            args["connection"] = conn
            args["query"] = q
            args["limit"] = int(self._sql_limit_var.get().strip() or "50")

        elif cmd == "get_preview":
            source_name = self._source_name_var.get().strip()
            if not source_name:
                raise ValueError("source_name is required for get_preview")
            args["source_name"] = source_name
            args["limit"] = int(self._limit_var.get().strip() or "10")

        elif cmd == "add_source":
            source_payload = _parse_json_maybe(self._text_value("source_json"))
            if not isinstance(source_payload, dict):
                raise ValueError("source JSON must be an object")
            if str(source_payload.get("type", "")).lower() == "csv":
                sep = self._csv_sep_var.get()
                enc = self._csv_enc_var.get()
                if sep:
                    source_payload["csv_separator"] = sep
                if enc:
                    source_payload["csv_encoding"] = enc
            args["source"] = source_payload

        elif cmd == "remove_source":
            source_name = self._source_name_var.get().strip()
            if not source_name:
                raise ValueError("source_name is required for remove_source")
            args["source_name"] = source_name

        elif cmd == "add_recipe_step":
            source_name = self._source_name_var.get().strip()
            if not source_name:
                raise ValueError("source_name is required for add_recipe_step")
            step_payload = _parse_json_maybe(self._text_value("step_json"))
            if not isinstance(step_payload, dict):
                raise ValueError("step JSON must be an object")
            args["source_name"] = source_name
            args["step"] = step_payload

        elif cmd == "update_recipe_step":
            source_name = self._source_name_var.get().strip()
            if not source_name:
                raise ValueError("source_name is required for update_recipe_step")
            step_payload = _parse_json_maybe(self._text_value("step_json"))
            if not isinstance(step_payload, dict):
                raise ValueError("step JSON must be an object")
            args["source_name"] = source_name
            args["step_index"] = int(self._step_index_var.get().strip() or "0")
            args["step"] = step_payload

        elif cmd == "remove_recipe_step":
            source_name = self._source_name_var.get().strip()
            if not source_name:
                raise ValueError("source_name is required for remove_recipe_step")
            args["source_name"] = source_name
            args["step_index"] = int(self._step_index_var.get().strip() or "0")

        else:
            raise ValueError(f"Unknown command: {cmd}")

        return {"id": req_id, "command": cmd, "args": args}

    def _build_request_preview(self) -> None:
        try:
            req = self._build_request()
        except Exception as exc:
            messagebox.showerror("Build request", str(exc))
            return

        self._request_text.delete("1.0", tk.END)
        self._request_text.insert("1.0", _pretty_json(req))

    def _send_request(self) -> None:
        if self._backend is None:
            messagebox.showerror("Backend", "Backend is not running. Click 'Start backend' first.")
            return

        try:
            req = self._build_request()
        except Exception as exc:
            messagebox.showerror("Send", str(exc))
            return

        proc = self._backend.proc
        assert proc.stdin is not None

        line = json.dumps(req, ensure_ascii=False)
        try:
            proc.stdin.write(line + "\n")
            proc.stdin.flush()
        except Exception as exc:
            messagebox.showerror("Send", f"Failed to write to backend stdin:\n{exc}")
            return

        self._request_text.delete("1.0", tk.END)
        self._request_text.insert("1.0", _pretty_json(req))
        self._log(f"\n>>> {req['id']} {req['command']}\n")

    def _run_sql_preview(self) -> None:
        if self._backend is None:
            self._start_backend()
        if self._backend is None:
            return

        try:
            req = self._build_request_for_sql()
        except Exception as exc:
            messagebox.showerror("SQL preview", str(exc))
            return

        proc = self._backend.proc
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        proc.stdin.flush()

        self._last_sql_request_id = str(req.get("id"))
        self._sql_result_text.insert(tk.END, f"\n>>> {req['id']} sql_preview\n")
        self._sql_result_text.see(tk.END)

    def _build_request_for_sql(self) -> dict[str, Any]:
        req_id = f"ui-{self._next_id}"
        self._next_id += 1

        conn = {
            "host": self._sql_host_var.get().strip(),
            "port": int(self._sql_port_var.get().strip() or "3306"),
            "database": self._sql_db_var.get().strip(),
            "user": self._sql_user_var.get().strip(),
            "password": self._sql_password_var.get(),
        }
        if not conn["host"]:
            raise ValueError("Host is required")
        if not conn["database"]:
            raise ValueError("Database is required")
        if not conn["user"]:
            raise ValueError("User is required")

        query = self._sql_query_text.get("1.0", tk.END).strip()
        if not query:
            raise ValueError("Query is required")

        limit = int(self._sql_limit_var.get().strip() or "50")
        return {"id": req_id, "command": "sql_preview", "args": {"connection": conn, "query": query, "limit": limit}}

    def _refresh_sql_sources(self) -> None:
        ws = self._workspace_var.get().strip()
        if not ws:
            return

        if self._backend is None:
            return

        req_id = f"ui-{self._next_id}"
        self._next_id += 1
        self._last_sources_request_id = req_id

        req = {"id": req_id, "command": "get_sources_schema", "args": {"workspace_path": ws}}
        proc = self._backend.proc
        assert proc.stdin is not None
        proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
        proc.stdin.flush()

    def _populate_sql_sources_tree(self, payload: dict[str, Any]) -> None:
        self._sql_sources_tree.delete(*self._sql_sources_tree.get_children())

        sources = payload.get("sources", [])
        if not isinstance(sources, list):
            return

        for src in sources:
            if not isinstance(src, dict):
                continue
            src_name = str(src.get("name", ""))
            src_type = str(src.get("type", ""))
            src_error = src.get("error")

            label = f"{src_name} [{src_type}]"
            src_node = self._sql_sources_tree.insert("", "end", text=label, values=("source", src_name, ""))

            if src_error:
                self._sql_sources_tree.insert(src_node, "end", text=f"[error] {src_error}", values=("error", src_name, ""))
                continue

            cols = src.get("columns", [])
            if not isinstance(cols, list):
                continue
            for col in cols:
                if not isinstance(col, dict):
                    continue
                col_name = str(col.get("name", ""))
                dtype = str(col.get("dtype", ""))
                self._sql_sources_tree.insert(
                    src_node,
                    "end",
                    text=f"{col_name} ({dtype})",
                    values=("column", src_name, col_name),
                )

    def _on_sql_sources_double_click(self, _event) -> None:
        item = self._sql_sources_tree.focus()
        if not item:
            return
        values = self._sql_sources_tree.item(item, "values")
        if not values or len(values) < 3:
            return
        kind, src_name, col_name = values[0], values[1], values[2]
        if kind != "column":
            return
        token = f"{{{src_name}.{col_name}}}"
        try:
            self._sql_query_text.insert(tk.INSERT, token)
            self._sql_query_text.focus_set()
        except Exception:
            pass

    # -------------------------
    # Helpers
    # -------------------------
    def _use_current_python(self) -> None:
        self._python_var.set(sys.executable)

    def _browse_workspace(self) -> None:
        path = filedialog.askopenfilename(
            title="Select workspace.json",
            initialdir=str(_repo_root() / "backend"),
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if path:
            self._workspace_var.set(path)

    def _new_workspace(self) -> None:
        folder = filedialog.askdirectory(
            title="Choose a folder for workspace.json",
            initialdir=str(_repo_root() / "backend"),
            mustexist=False,
        )
        if not folder:
            return

        ws_file = Path(folder).resolve() / "workspace.json"
        default_name = ws_file.parent.name
        name = simpledialog.askstring("Workspace name", "Enter a workspace name:", initialvalue=default_name)
        if name is None or not name.strip():
            return

        if self._backend is None:
            self._start_backend()
        if self._backend is None:
            return

        req = {
            "id": f"ui-{self._next_id}",
            "command": "create_workspace",
            "args": {"workspace_path": str(ws_file.parent), "name": name.strip()},
        }
        self._next_id += 1

        proc = self._backend.proc
        assert proc.stdin is not None
        try:
            proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
            proc.stdin.flush()
        except Exception as exc:
            messagebox.showerror("Create workspace", f"Failed to write to backend stdin:\n{exc}")
            return

        self._workspace_var.set(str(ws_file))
        self._command_var.set("load_workspace")
        self._refresh_form()
        self._log(f"\n>>> {req['id']} create_workspace\n")

    def _text_value(self, key: str) -> str:
        w = self._args_widgets.get(key)
        if not isinstance(w, tk.Text):
            return ""
        return w.get("1.0", tk.END)

    def _clear_log(self) -> None:
        self._log_text.delete("1.0", tk.END)

    def _log(self, text: str) -> None:
        self._log_text.insert(tk.END, text)
        self._log_text.see(tk.END)

    def _refresh_form(self) -> None:
        cmd = self._command_var.get()

        def show(widget_key: str, visible: bool) -> None:
            w = self._args_widgets[widget_key]
            if visible:
                # Re-show using the geometry options already configured at creation time.
                w.grid()
            else:
                w.grid_remove()

        # Always present for multiple commands; just hide irrelevant fields.
        wants_source_name = cmd in {"get_preview", "remove_source", "add_recipe_step", "update_recipe_step", "remove_recipe_step"}
        wants_limit = cmd == "get_preview"
        wants_step_index = cmd in {"update_recipe_step", "remove_recipe_step"}
        wants_source_json = cmd == "add_source"
        wants_step_json = cmd in {"add_recipe_step", "update_recipe_step"}
        wants_csv_opts = cmd == "add_source"
        wants_step_op_picker = cmd in {"add_recipe_step", "update_recipe_step"}

        show("source_name", wants_source_name)
        show("limit", wants_limit)
        show("step_index", wants_step_index)
        show("csv_separator", wants_csv_opts)
        show("csv_encoding", wants_csv_opts)
        show("source_json", wants_source_json)
        show("step_op_type", wants_step_op_picker)
        show("step_json", wants_step_json)

        self._build_request_preview()

    def _drain_backend_output(self) -> None:
        backend = self._backend
        if backend is not None:
            while True:
                try:
                    stream, line = backend.out_queue.get_nowait()
                except queue.Empty:
                    break

                if stream == "stdout":
                    # Try to pretty-print JSON responses; fallback to raw.
                    stripped = line.strip()
                    if stripped:
                        try:
                            obj = json.loads(stripped)
                            self._log(_pretty_json(obj) + "\n")
                            try:
                                if (
                                    isinstance(obj, dict)
                                    and obj.get("success") is True
                                    and isinstance(obj.get("data"), dict)
                                    and "columns" in obj["data"]
                                    and "rows" in obj["data"]
                                ):
                                    self._update_preview_table(
                                        obj["data"].get("columns", []),
                                        obj["data"].get("rows", []),
                                        obj["data"].get("dtypes", None),
                                    )
                            except Exception:
                                pass
                            try:
                                if (
                                    isinstance(obj, dict)
                                    and self._last_sql_request_id is not None
                                    and obj.get("id") == self._last_sql_request_id
                                ):
                                    self._sql_result_text.insert(tk.END, _pretty_json(obj) + "\n")
                                    self._sql_result_text.see(tk.END)
                            except Exception:
                                pass
                            try:
                                if (
                                    isinstance(obj, dict)
                                    and self._last_sources_request_id is not None
                                    and obj.get("id") == self._last_sources_request_id
                                    and obj.get("success") is True
                                    and isinstance(obj.get("data"), dict)
                                ):
                                    self._populate_sql_sources_tree(obj["data"])
                            except Exception:
                                pass
                        except Exception:
                            self._log(line)
                    else:
                        self._log(line)
                else:
                    self._log(f"[stderr] {line}")

            # Detect exit
            if backend.proc.poll() is not None:
                code = backend.proc.returncode
                self._log(f"[system] backend exited (code={code})\n")
                self._backend = None

        self.after(100, self._drain_backend_output)


def main() -> int:
    app = MessagingClientApp()
    try:
        app.mainloop()
    finally:
        try:
            app._stop_backend()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
