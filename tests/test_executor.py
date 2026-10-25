"""Tests for mini_postman.executor against a local echo HTTP server.

Run from the project root:  python -m unittest discover -s tests -v
No internet access is needed.
"""

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mini_postman.executor import execute_request  # noqa: E402


class EchoHandler(BaseHTTPRequestHandler):
    def _reply(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if "/status/404" in self.path:
            code, payload = 404, {"error": "not here"}
        elif "/status/500" in self.path:
            code, payload = 500, {"error": "boom"}
        else:
            code, payload = 200, {
                "method": self.command,
                "path": self.path,
                "headers": dict(self.headers),
                "body": raw.decode("utf-8", "replace"),
            }
        data = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _reply
    do_POST = _reply
    do_PUT = _reply
    do_DELETE = _reply

    def log_message(self, *args):
        pass


class ExecutorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), EchoHandler)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def test_get_with_params_and_headers(self):
        result = execute_request({
            "method": "GET", "url": self.base + "/echo",
            "params": [{"key": "q", "value": "hello world", "enabled": True},
                       {"key": "off", "value": "x", "enabled": False}],
            "headers": [{"key": "X-Test", "value": "yes", "enabled": True}],
        })
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], 200)
        body = json.loads(result["body"])
        self.assertIn("q=hello+world", body["path"])
        self.assertNotIn("off=", body["path"])
        self.assertEqual(body["headers"].get("X-Test"), "yes")

    def test_post_json_body(self):
        result = execute_request({
            "method": "POST", "url": self.base + "/echo",
            "body_type": "json", "body": '{"title": "Hi", "n": 3}',
        })
        self.assertTrue(result["ok"])
        body = json.loads(result["body"])
        self.assertEqual(json.loads(body["body"]), {"title": "Hi", "n": 3})
        self.assertEqual(body["headers"].get("Content-Type"), "application/json")

    def test_post_form_body(self):
        result = execute_request({
            "method": "POST", "url": self.base + "/echo",
            "body_type": "form",
            "body_form": [{"key": "name", "value": "Lav", "enabled": True}],
        })
        self.assertTrue(result["ok"])
        self.assertEqual(json.loads(result["body"])["body"], "name=Lav")

    def test_bearer_auth_header(self):
        result = execute_request({
            "method": "GET", "url": self.base + "/echo",
            "auth": {"type": "bearer", "token": "secret123"},
        })
        self.assertEqual(json.loads(result["body"])["headers"].get("Authorization"),
                         "Bearer secret123")

    def test_basic_auth_header(self):
        result = execute_request({
            "method": "GET", "url": self.base + "/echo",
            "auth": {"type": "basic", "username": "user", "password": "pass"},
        })
        self.assertEqual(json.loads(result["body"])["headers"].get("Authorization"),
                         "Basic dXNlcjpwYXNz")

    def test_http_error_status_is_a_result_not_an_exception(self):
        result = execute_request({"method": "GET", "url": self.base + "/status/404"})
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], 404)

    def test_invalid_url_rejected(self):
        result = execute_request({"method": "GET", "url": "not-a-url"})
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_invalid_json_body_rejected(self):
        result = execute_request({
            "method": "POST", "url": self.base + "/echo",
            "body_type": "json", "body": "{broken",
        })
        self.assertFalse(result["ok"])
        self.assertIn("JSON", result["error"])

    def test_bad_method_rejected(self):
        result = execute_request({"method": "FETCH", "url": self.base + "/echo"})
        self.assertFalse(result["ok"])


if __name__ == "__main__":
    unittest.main()
