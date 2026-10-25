"""HTTP server for Mini Postman.

Serves the single-page web UI from ``static/`` and exposes two JSON
endpoints:

* ``GET  /api/health``  -> {"status": "ok", "version": ...}
* ``POST /api/request`` -> executes the request spec in the JSON body
  with :func:`mini_postman.executor.execute_request` and returns the
  result.  Executing requests server-side avoids browser CORS limits,
  which is the whole point of a local Postman-style tool.
"""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from . import __version__
from .executor import execute_request

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_REQUEST_JSON = 2 * 1024 * 1024  # 2 MB


class MiniPostmanHandler(BaseHTTPRequestHandler):
    server_version = f"MiniPostman/{__version__}"

    # -- helpers ---------------------------------------------------------
    def _send_json(self, payload: Any, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_static(self, name: str) -> None:
        path = (STATIC_DIR / name).resolve()
        if STATIC_DIR.resolve() not in path.parents or not path.is_file():
            self.send_error(404, "Not found")
            return
        data = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8"
                         if content_type.startswith("text/") or "javascript" in content_type
                         else content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -- routes ----------------------------------------------------------
    def do_GET(self) -> None:  # noqa: N802 (stdlib naming)
        route = self.path.split("?", 1)[0]
        if route == "/api/health":
            self._send_json({"status": "ok", "version": __version__})
        elif route in {"/", "/index.html"}:
            self._send_static("index.html")
        elif route == "/styles.css":
            self._send_static("styles.css")
        elif route == "/app.js":
            self._send_static("app.js")
        elif route == "/logo.svg":
            self._send_static("logo.svg")
        else:
            self.send_error(404, "Not found")

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        route = self.path.split("?", 1)[0]
        if route != "/api/request":
            self.send_error(404, "Not found")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_REQUEST_JSON:
            self._send_json({"ok": False, "error": "Invalid request size."}, status=400)
            return
        try:
            spec = json.loads(self.rfile.read(length).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._send_json({"ok": False, "error": "Request body must be valid JSON."}, status=400)
            return
        self._send_json(execute_request(spec))

    def log_message(self, format: str, *args: Any) -> None:  # keep the console clean
        pass


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    server = ThreadingHTTPServer((host, port), MiniPostmanHandler)
    print(f"Mini Postman v{__version__} running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
