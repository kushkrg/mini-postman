"""HTTP request execution engine for Mini Postman.

Takes a plain ``dict`` describing a request (the same shape the web UI
sends to ``POST /api/request``), executes it with the standard library
only, and returns a plain ``dict`` describing the response.  No network
response is ever treated as a Python exception for HTTP error statuses:
a 404 or 500 from the target API is a *successful test result*, exactly
like in Postman.
"""

from __future__ import annotations

import base64
import gzip
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
ALLOWED_SCHEMES = {"http", "https"}
MAX_RESPONSE_BYTES = 5 * 1024 * 1024  # 5 MB safety cap
DEFAULT_TIMEOUT = 30
MAX_TIMEOUT = 120


def _enabled_pairs(rows: Any) -> list[tuple[str, str]]:
    """Extract (key, value) pairs from UI key/value rows that are enabled."""
    pairs: list[tuple[str, str]] = []
    if not isinstance(rows, list):
        return pairs
    for row in rows:
        if not isinstance(row, dict):
            continue
        if row.get("enabled", True) is False:
            continue
        key = str(row.get("key", "")).strip()
        if not key:
            continue
        pairs.append((key, str(row.get("value", ""))))
    return pairs


def _apply_auth(headers: dict[str, str], auth: Any) -> None:
    """Apply bearer / basic / api-key auth to the header dict (in place)."""
    if not isinstance(auth, dict):
        return
    auth_type = str(auth.get("type", "none")).lower()
    if auth_type == "bearer":
        token = str(auth.get("token", "")).strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
    elif auth_type == "basic":
        username = str(auth.get("username", ""))
        password = str(auth.get("password", ""))
        raw = f"{username}:{password}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    elif auth_type == "apikey":
        key = str(auth.get("key", "")).strip()
        value = str(auth.get("value", ""))
        if key:
            headers[key] = value


def _build_body(spec: dict[str, Any], headers: dict[str, str]) -> bytes | None:
    """Build the request body bytes from the spec, setting Content-Type."""
    body_type = str(spec.get("body_type", "none")).lower()
    if body_type == "none":
        return None
    if body_type == "form":
        pairs = _enabled_pairs(spec.get("body_form"))
        encoded = urllib.parse.urlencode(pairs).encode("utf-8")
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded")
        return encoded
    raw = str(spec.get("body", ""))
    if body_type == "json":
        if raw.strip():
            try:
                json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Request body is not valid JSON: {exc}") from exc
        headers.setdefault("Content-Type", "application/json")
    elif body_type == "text":
        headers.setdefault("Content-Type", "text/plain; charset=utf-8")
    return raw.encode("utf-8")


def _decode_body(raw: bytes, headers: Any) -> str:
    """Decode response bytes, handling gzip and the declared charset."""
    if headers.get("Content-Encoding", "").lower() == "gzip":
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
    charset = "utf-8"
    if hasattr(headers, "get_content_charset"):
        charset = headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


def execute_request(spec: dict[str, Any]) -> dict[str, Any]:
    """Execute the request described by *spec* and return the result.

    The result always contains ``ok``.  On success it also contains
    ``status``, ``status_text``, ``time_ms``, ``size_bytes``, ``headers``
    (a list of [name, value] pairs) and ``body`` (decoded text).  On a
    client-side or network failure it contains ``error`` instead.
    """
    if not isinstance(spec, dict):
        return {"ok": False, "error": "Request spec must be a JSON object."}

    method = str(spec.get("method", "GET")).upper()
    if method not in ALLOWED_METHODS:
        return {"ok": False, "error": f"Unsupported method: {method}"}

    url = str(spec.get("url", "")).strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        return {"ok": False, "error": "Enter a valid http(s) URL, e.g. https://api.example.com/users"}

    # Merge query-param rows into the URL.
    params = _enabled_pairs(spec.get("params"))
    if params:
        existing = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        url = urllib.parse.urlunparse(parsed._replace(
            query=urllib.parse.urlencode(existing + params)))

    headers: dict[str, str] = {"User-Agent": "Mini-Postman/1.0", "Accept": "*/*"}
    for key, value in _enabled_pairs(spec.get("headers")):
        headers[key] = value
    _apply_auth(headers, spec.get("auth"))

    try:
        data = _build_body(spec, headers)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    if method in {"GET", "HEAD"}:
        data = None

    try:
        timeout = min(max(int(spec.get("timeout", DEFAULT_TIMEOUT)), 1), MAX_TIMEOUT)
    except (TypeError, ValueError):
        timeout = DEFAULT_TIMEOUT

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    # Direct connection: a local API-testing tool must not route the
    # user's test requests through environment proxy variables.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    started = time.perf_counter()
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:  # 4xx / 5xx are valid results
        response = exc
    except (urllib.error.URLError, ValueError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        return {"ok": False, "error": f"Request failed: {reason}",
                "time_ms": round((time.perf_counter() - started) * 1000)}
    with response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        truncated = len(raw) > MAX_RESPONSE_BYTES
        raw = raw[:MAX_RESPONSE_BYTES]
        elapsed_ms = round((time.perf_counter() - started) * 1000)
        body = "" if method == "HEAD" else _decode_body(raw, response.headers)
        status = response.getcode()
        return {
            "ok": True,
            "status": status,
            "status_text": getattr(response, "reason", "") or "",
            "time_ms": elapsed_ms,
            "size_bytes": len(raw),
            "truncated": truncated,
            "url": response.geturl(),
            "headers": [[k, v] for k, v in response.headers.items()],
            "body": body,
        }
