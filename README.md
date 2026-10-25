<p align="center">
  <img src="assets/logo.svg" alt="Mini Postman logo" width="120">
</p>

<h1 align="center">Mini Postman — API Testing Tool</h1>

<p align="center">
  A lightweight, open-source API testing tool inspired by Postman — built with <strong>pure Python</strong>.<br>
  No accounts, no cloud, no bloat, and <strong>zero third-party dependencies</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="Cross platform">
</p>

---

## ✨ Features

- **All HTTP methods** — GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **Query params & headers** — unlimited key/value rows, enable/disable each row
- **Request bodies** — raw JSON (with validation + one-click formatting), raw text, and form-urlencoded
- **Auth built in** — Bearer token, Basic Auth, and API-key header
- **Variables** — define `{{base_url}}` once and reuse it in the URL, headers and body
- **Beautiful response viewer** — status pill, response time, size, syntax-highlighted JSON, full response headers
- **History** — your last 50 requests, one click to re-run
- **Saved requests & collections** — save, organise, and **import/export** collections as JSON
- **Live cURL generator** — copy an equivalent cURL command for any request
- **No CORS problems** — requests run through the local Python backend, not the browser
- **Private by design** — everything stays on your machine; nothing is sent anywhere except the APIs you test

## 🚀 Quick Start

You only need **Python 3.10 or newer**. Nothing to install.

```bash
git clone https://github.com/kushkrg/mini-postman.git
cd mini-postman
python app.py
```

Then open **http://127.0.0.1:8000** in your browser.

```bash
python app.py --port 9000          # use a different port
python app.py --host 0.0.0.0       # allow access from other devices on your network
```

## 🖥️ How to Use

1. Pick a **method** and paste your API **URL**.
2. Add **Params**, **Headers**, **Auth** and a **Body** using the tabs.
3. Hit **Send** (or `Ctrl + Enter`) and inspect the response — status, time, size, pretty-printed body and headers.
4. **Save** requests you run often, define **Variables** for base URLs and tokens, and **Export** your collection to share it.

Three one-click samples are built in (GET a post, POST create, echo headers) so you can try it instantly.

## 📡 API

The web UI talks to two local endpoints — you can use them directly too:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Returns `{"status": "ok", "version": "1.0.0"}` |
| `POST /api/request` | Executes a request spec (JSON) and returns status, timing, headers and body |

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/request \
  -H "Content-Type: application/json" \
  -d '{"method": "GET", "url": "https://api.github.com/users/kushkrg"}'
```

## 🗂️ Project Structure

```
mini-postman/
├── app.py                    # Entry point (python app.py)
├── mini_postman/
│   ├── executor.py           # Request execution engine (stdlib urllib)
│   └── server.py             # HTTP server + /api endpoints
├── static/
│   ├── index.html            # Single-page UI
│   ├── styles.css            # Dark theme
│   ├── app.js                # UI logic, history, saved, variables, cURL
│   └── logo.svg
├── assets/
│   └── logo.svg              # Project logo
├── examples/
│   └── collection.json       # Sample importable collection
├── tests/
│   └── test_executor.py      # Unit tests (no internet needed)
├── requirements.txt          # Empty on purpose — zero dependencies
└── LICENSE                   # MIT
```

## 🧪 Run the Tests

```bash
python -m unittest discover -s tests -v
```

The tests spin up a local echo server and verify params, headers, JSON/form
bodies, Bearer & Basic auth, error statuses and input validation — 9 tests,
no internet required.

## 🛣️ Roadmap

- [ ] Postman collection (v2.1) import
- [ ] Response assertions / simple test scripts
- [ ] Cookie jar support
- [ ] GraphQL mode
- [ ] Desktop packaging (single executable)

## 🤝 Contributing

Issues and pull requests are welcome. Keep the project's core promise in
mind: **standard library only** for the backend.

## 👨‍💻 Author

**Lavkush Kumar** — Full Stack Web Developer
- GitHub: [@kushkrg](https://github.com/kushkrg)
- Website: [lavkushkumar.com](https://lavkushkumar.com)
- Learn coding: [codingcush.com](https://codingcush.com)

## 📄 License

Released under the [MIT License](LICENSE).

<p align="center"><i>Built for developers who want Postman's essentials — in a tool they can read, run and own.</i></p>
