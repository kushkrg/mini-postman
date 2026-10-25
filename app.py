#!/usr/bin/env python3
"""Mini Postman - API Testing Tool.

Usage:
    python app.py                 # http://127.0.0.1:8000
    python app.py --port 9000
    python app.py --host 0.0.0.0 --port 8000   # allow LAN access

No third-party packages are required - Python 3.10+ standard library only.
"""

import argparse

from mini_postman.server import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mini Postman - API Testing Tool")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="Port (default 8000)")
    args = parser.parse_args()
    run(host=args.host, port=args.port)
