"use strict";
/* Mini Postman - frontend logic. State (saved requests, history, variables)
   lives in localStorage; requests are executed by the Python backend at
   POST /api/request so browser CORS never blocks API testing. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem("mp:" + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) { localStorage.setItem("mp:" + key, JSON.stringify(value)); },
};

/* ---------------- environments ----------------
   Variables live inside named environments (issue #3): one set of
   variables per environment, switched from the top bar. The ACTIVE
   environment's variables are mirrored to `variables` (and to the
   legacy "variables" storage key) so substitution, export and any
   older saved data keep working unchanged. */
function _seedEnvironments() {
  return [{ id: "default", name: "Default", variables: store.get("variables", []) }];
}
let environments = store.get("environments", null);
if (!Array.isArray(environments) || !environments.length) {
  environments = _seedEnvironments();
}
let activeEnvironmentId = store.get("activeEnvironmentId", environments[0].id);
if (!environments.some((e) => e.id === activeEnvironmentId)) {
  activeEnvironmentId = environments[0].id;
}
let variables = [];   // [{key, value}] of the active environment
function activeEnvironment() {
  return environments.find((e) => e.id === activeEnvironmentId) || environments[0];
}
function syncVariables() {
  variables = activeEnvironment().variables || [];
  store.set("variables", variables);
}
function persistEnvironments() {
  store.set("environments", environments);
  store.set("activeEnvironmentId", activeEnvironmentId);
  syncVariables();
  renderEnvSelect();
}
function renderEnvSelect() {
  const sel = $("#envSelect");
  if (!sel) return;
  sel.innerHTML = "";
  environments.forEach((e) => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    sel.appendChild(opt);
  });
  sel.value = activeEnvironmentId;
}
syncVariables();
let saved = store.get("saved", []);           // [{id, name, spec}]
let history = store.get("history", []);       // [{id, at, spec, status}]
let lastResponseBody = "";

/* ---------------- variables ---------------- */
function applyVars(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const v of variables) {
    if (v.key) out = out.split("{{" + v.key + "}}").join(v.value ?? "");
  }
  return out;
}
function substSpec(spec) {
  const clone = JSON.parse(JSON.stringify(spec));
  clone.url = applyVars(clone.url);
  for (const group of ["params", "headers", "body_form"]) {
    (clone[group] || []).forEach((r) => { r.key = applyVars(r.key); r.value = applyVars(r.value); });
  }
  if (clone.body) clone.body = applyVars(clone.body);
  if (clone.auth) Object.keys(clone.auth).forEach((k) => { clone.auth[k] = applyVars(clone.auth[k]); });
  return clone;
}

/* ---------------- key/value rows ---------------- */
function kvRow(container, key = "", value = "", enabled = true) {
  const row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = `
    <input type="checkbox" class="kv-enabled" ${enabled ? "checked" : ""}>
    <input type="text" class="kv-key" placeholder="Key" value="">
    <input type="text" class="kv-value" placeholder="Value" value="">
    <button class="rm" title="Remove">&times;</button>`;
  row.querySelector(".kv-key").value = key;
  row.querySelector(".kv-value").value = value;
  row.querySelector(".rm").addEventListener("click", () => { row.remove(); refreshCurl(); });
  row.addEventListener("input", refreshCurl);
  container.appendChild(row);
  return row;
}
function readKv(container) {
  return [...container.querySelectorAll(".kv-row")].map((row) => ({
    enabled: row.querySelector(".kv-enabled").checked,
    key: row.querySelector(".kv-key").value,
    value: row.querySelector(".kv-value").value,
  })).filter((r) => r.key.trim() !== "" || r.value.trim() !== "");
}
function fillKv(container, rows) {
  container.innerHTML = "";
  (rows && rows.length ? rows : [{}]).forEach((r) => kvRow(container, r.key || "", r.value || "", r.enabled !== false));
}

/* ---------------- spec <-> UI ---------------- */
function currentSpec() {
  return {
    method: $("#method").value,
    url: $("#url").value.trim(),
    params: readKv($("#paramsRows")),
    headers: readKv($("#headersRows")),
    auth: {
      type: $("#authType").value,
      token: $("#authToken").value,
      username: $("#authUser").value,
      password: $("#authPass").value,
      key: $("#authKey").value,
      value: $("#authValue").value,
    },
    body_type: document.querySelector('input[name="bodyType"]:checked').value,
    body: $("#bodyText").value,
    body_form: readKv($("#bodyFormRows")),
  };
}
function loadSpec(spec) {
  $("#method").value = spec.method || "GET";
  $("#url").value = spec.url || "";
  fillKv($("#paramsRows"), spec.params);
  fillKv($("#headersRows"), spec.headers);
  const auth = spec.auth || {};
  $("#authType").value = auth.type || "none";
  $("#authToken").value = auth.token || "";
  $("#authUser").value = auth.username || "";
  $("#authPass").value = auth.password || "";
  $("#authKey").value = auth.key || "";
  $("#authValue").value = auth.value || "";
  syncAuthFields();
  const bt = spec.body_type || "none";
  document.querySelector(`input[name="bodyType"][value="${bt}"]`).checked = true;
  $("#bodyText").value = spec.body || "";
  fillKv($("#bodyFormRows"), spec.body_form);
  syncBodyFields();
  refreshCurl();
}

/* ---------------- auth / body panels ---------------- */
function syncAuthFields() {
  const t = $("#authType").value;
  ["bearer", "basic", "apikey"].forEach((x) => $("#auth-" + x).classList.toggle("hidden", x !== t));
}
function syncBodyFields() {
  const bt = document.querySelector('input[name="bodyType"]:checked').value;
  $("#bodyText").classList.toggle("hidden", bt === "form" || bt === "none");
  $("#bodyFormWrap").classList.toggle("hidden", bt !== "form");
  $("#formatJsonBtn").style.visibility = bt === "json" ? "visible" : "hidden";
}

/* ---------------- cURL preview ---------------- */
function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function buildCurl(specRaw) {
  const spec = substSpec(specRaw);
  const parts = ["curl", "-X", spec.method];
  let url = spec.url || "https://example.com";
  const qs = spec.params.filter((p) => p.enabled !== false && p.key)
    .map((p) => encodeURIComponent(p.key) + "=" + encodeURIComponent(p.value)).join("&");
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  parts.push(shellQuote(url));
  const headers = spec.headers.filter((h) => h.enabled !== false && h.key);
  if (spec.auth?.type === "bearer" && spec.auth.token) headers.push({ key: "Authorization", value: "Bearer " + spec.auth.token });
  if (spec.auth?.type === "apikey" && spec.auth.key) headers.push({ key: spec.auth.key, value: spec.auth.value });
  if (spec.auth?.type === "basic") parts.push("-u", shellQuote((spec.auth.username || "") + ":" + (spec.auth.password || "")));
  headers.forEach((h) => parts.push("-H", shellQuote(h.key + ": " + h.value)));
  if (spec.body_type === "json" || spec.body_type === "text") {
    if (spec.body) parts.push("--data", shellQuote(spec.body));
  } else if (spec.body_type === "form") {
    spec.body_form.filter((f) => f.enabled !== false && f.key)
      .forEach((f) => parts.push("--data-urlencode", shellQuote(f.key + "=" + f.value)));
  }
  return parts.join(" ");
}
function refreshCurl() { $("#curlPreview").textContent = buildCurl(currentSpec()); }

/* ---------------- response rendering ---------------- */
function highlightJson(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(/("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g, (m) => {
    let cls = "json-number";
    if (/^"/.test(m)) cls = /:$/.test(m.trim()) || /"\s*:$/.test(m) ? "json-key" : "json-string";
    else if (/true|false|null/.test(m)) cls = "json-bool";
    return `<span class="${cls}">${m}</span>`;
  });
}
function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}
function statusClass(s) {
  if (s >= 200 && s < 300) return "ok";
  if (s >= 300 && s < 400) return "redirect";
  if (s >= 400 && s < 500) return "client";
  return "server";
}
function renderResponse(result) {
  const meta = $("#responseMeta");
  if (!result.ok) {
    meta.innerHTML = `<span class="pill error">Error</span><span class="stat">${result.error || "Request failed"}</span>`;
    $("#responseBody").textContent = result.error || "Request failed.";
    $("#responseHeaders").innerHTML = "";
    lastResponseBody = "";
    return;
  }
  meta.innerHTML =
    `<span class="pill ${statusClass(result.status)}">${result.status} ${result.status_text || ""}</span>` +
    `<span class="stat">⏱ ${result.time_ms} ms</span>` +
    `<span class="stat">⇩ ${formatBytes(result.size_bytes)}</span>` +
    (result.truncated ? `<span class="stat">(truncated at 5 MB)</span>` : "");
  let body = result.body || "";
  try { body = JSON.stringify(JSON.parse(body), null, 2); $("#responseBody").innerHTML = highlightJson(body); }
  catch { $("#responseBody").textContent = body; }
  lastResponseBody = body;
  const rows = (result.headers || []).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  $("#responseHeaders").innerHTML = `<table class="headers-table">${rows}</table>`;
}

/* ---------------- send ---------------- */
async function send() {
  const spec = currentSpec();
  if (!spec.url) { toast("Enter a URL first"); return; }
  const btn = $("#sendBtn");
  btn.disabled = true; btn.textContent = "Sending…";
  $("#responseMeta").innerHTML = `<span class="stat">Sending ${spec.method} request…</span>`;
  try {
    const res = await fetch("/api/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(substSpec(spec)),
    });
    const result = await res.json();
    renderResponse(result);
    history.unshift({ id: Date.now(), at: new Date().toISOString(), spec, status: result.ok ? result.status : 0 });
    history = history.slice(0, 50);
    store.set("history", history);
    renderSide();
  } catch (err) {
    renderResponse({ ok: false, error: "Could not reach the Mini Postman server: " + err.message });
  } finally {
    btn.disabled = false; btn.textContent = "Send";
  }
}

/* ---------------- sidebar ---------------- */
function methodClass(m) { return "m-" + (m || "GET").toLowerCase(); }
function sideItem(item, kind) {
  const el = document.createElement("div");
  el.className = "side-item";
  const title = kind === "saved" ? (item.name || item.spec.url) : item.spec.url;
  el.innerHTML = `<div class="row"><span><span class="m ${methodClass(item.spec.method)}">${item.spec.method}</span>${kind === "saved" ? escapeHtml(title) : ""}</span>${kind === "saved" ? '<button class="del" title="Delete">&times;</button>' : ""}</div><span class="u">${escapeHtml(item.spec.url)}${kind === "history" && item.status ? " · " + item.status : ""}</span>`;
  el.addEventListener("click", (e) => { if (!e.target.classList.contains("del")) loadSpec(item.spec); });
  if (kind === "saved") {
    el.querySelector(".del").addEventListener("click", () => {
      saved = saved.filter((s) => s.id !== item.id);
      store.set("saved", saved); renderSide(); toast("Deleted");
    });
  }
  return el;
}
function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function renderSide() {
  const sl = $("#savedList"), hl = $("#historyList");
  sl.innerHTML = saved.length ? "" : '<p class="side-empty">No saved requests yet. Build a request and click Save.</p>';
  saved.forEach((s) => sl.appendChild(sideItem(s, "saved")));
  hl.innerHTML = history.length ? "" : '<p class="side-empty">No history yet.</p>';
  history.forEach((h) => hl.appendChild(sideItem(h, "history")));
  $("#varsCount").textContent = variables.filter((v) => v.key).length;
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

/* ---------------- samples ---------------- */
const SAMPLES = {
  "get-post": { method: "GET", url: "https://jsonplaceholder.typicode.com/posts/1", params: [], headers: [], auth: { type: "none" }, body_type: "none", body: "", body_form: [] },
  "create-post": { method: "POST", url: "https://jsonplaceholder.typicode.com/posts", params: [], headers: [], auth: { type: "none" }, body_type: "json", body: '{\n  "title": "Hello from Mini Postman",\n  "body": "My first API test",\n  "userId": 1\n}', body_form: [] },
  "headers": { method: "GET", url: "https://httpbin.org/headers", params: [], headers: [{ enabled: true, key: "X-Demo", value: "Mini-Postman" }], auth: { type: "none" }, body_type: "none", body: "", body_form: [] },
};

/* ---------------- wiring ---------------- */
function init() {
  fillKv($("#paramsRows"), []);
  fillKv($("#headersRows"), [{ key: "Content-Type", value: "application/json", enabled: true }].slice(0, 0)); // start empty
  fillKv($("#bodyFormRows"), []);
  $$("[data-add]").forEach((btn) => btn.addEventListener("click", () => {
    const target = { params: "#paramsRows", headers: "#headersRows", bodyForm: "#bodyFormRows" }[btn.dataset.add];
    kvRow($(target)); refreshCurl();
  }));
  $$(".tab[data-tab]").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab[data-tab]").forEach((t) => t.classList.toggle("active", t === tab));
    ["params", "headers", "auth", "body", "curl"].forEach((name) =>
      $("#tab-" + name).classList.toggle("hidden", name !== tab.dataset.tab));
    if (tab.dataset.tab === "curl") refreshCurl();
  }));
  $$(".tab[data-rtab]").forEach((tab) => tab.addEventListener("click", () => {
    $$(".tab[data-rtab]").forEach((t) => t.classList.toggle("active", t === tab));
    $("#responseBody").classList.toggle("hidden", tab.dataset.rtab !== "rbody");
    $("#responseHeaders").classList.toggle("hidden", tab.dataset.rtab !== "rheaders");
  }));
  $$(".side-tab").forEach((tab) => tab.addEventListener("click", () => {
    $$(".side-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#savedList").classList.toggle("hidden", tab.dataset.side !== "saved");
    $("#historyList").classList.toggle("hidden", tab.dataset.side !== "history");
    $("#clearHistoryBtn").classList.toggle("hidden", tab.dataset.side !== "history");
  }));
  $("#authType").addEventListener("change", () => { syncAuthFields(); refreshCurl(); });
  $$('input[name="bodyType"]').forEach((r) => r.addEventListener("change", () => { syncBodyFields(); refreshCurl(); }));
  ["method", "url"].forEach((id) => $("#" + id).addEventListener("input", refreshCurl));
  $("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") send(); });
  $("#sendBtn").addEventListener("click", send);
  $("#formatJsonBtn").addEventListener("click", () => {
    try { $("#bodyText").value = JSON.stringify(JSON.parse($("#bodyText").value), null, 2); refreshCurl(); }
    catch { toast("Body is not valid JSON"); }
  });
  $("#copyCurlBtn").addEventListener("click", () => { navigator.clipboard.writeText($("#curlPreview").textContent); toast("cURL copied"); });
  $("#copyRespBtn").addEventListener("click", () => { navigator.clipboard.writeText(lastResponseBody); toast("Response copied"); });
  $("#saveBtn").addEventListener("click", () => {
    const spec = currentSpec();
    if (!spec.url) { toast("Enter a URL first"); return; }
    const name = prompt("Name this request:", spec.method + " " + spec.url);
    if (name === null) return;
    saved.unshift({ id: Date.now(), name: name || spec.url, spec });
    store.set("saved", saved); renderSide(); toast("Saved");
  });
  $("#clearHistoryBtn").addEventListener("click", () => { history = []; store.set("history", history); renderSide(); });
  $$(".sample").forEach((btn) => btn.addEventListener("click", () => { loadSpec(SAMPLES[btn.dataset.sample]); send(); }));

  /* environments: top-bar quick switch */
  renderEnvSelect();
  $("#envSelect").addEventListener("change", () => {
    activeEnvironmentId = $("#envSelect").value;
    persistEnvironments();
    renderSide(); refreshCurl();
    toast("Environment: " + activeEnvironment().name);
  });

  /* variables dialog */
  const dlg = $("#varsDialog");
  $("#varsBtn").addEventListener("click", () => {
    $("#envName").value = activeEnvironment().name;
    const wrap = $("#varsRows"); wrap.innerHTML = "";
    (variables.length ? variables : [{}]).forEach((v) => kvRow(wrap, v.key || "", v.value || "", true));
    dlg.showModal();
  });
  $("#newEnvBtn").addEventListener("click", () => {
    const name = prompt("Environment name:", "New environment");
    if (name === null) return;
    const env = { id: "env-" + Date.now(), name: name.trim() || "Untitled", variables: [] };
    environments.push(env);
    activeEnvironmentId = env.id;
    persistEnvironments();
    $("#envName").value = env.name;
    const wrap = $("#varsRows"); wrap.innerHTML = "";
    kvRow(wrap);
    renderSide();
    toast("Environment created: " + env.name);
  });
  $("#delEnvBtn").addEventListener("click", () => {
    if (environments.length <= 1) { toast("Keep at least one environment"); return; }
    const env = activeEnvironment();
    if (!confirm("Delete environment \"" + env.name + "\" and its variables?")) return;
    environments = environments.filter((e) => e.id !== env.id);
    activeEnvironmentId = environments[0].id;
    persistEnvironments();
    $("#envName").value = activeEnvironment().name;
    const wrap = $("#varsRows"); wrap.innerHTML = "";
    (variables.length ? variables : [{}]).forEach((v) => kvRow(wrap, v.key || "", v.value || "", true));
    renderSide();
    toast("Environment deleted");
  });
  $("#addVarBtn").addEventListener("click", () => kvRow($("#varsRows")));
  $("#varsDoneBtn").addEventListener("click", () => {
    const env = activeEnvironment();
    env.variables = readKv($("#varsRows")).map((r) => ({ key: r.key, value: r.value }));
    const name = $("#envName").value.trim();
    if (name) env.name = name;
    persistEnvironments();
    renderSide(); refreshCurl();
  });

  /* import / export */
  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ name: "Mini Postman Collection", saved, variables, environments, activeEnvironmentId }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "mini-postman-collection.json"; a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (Array.isArray(data.saved)) { saved = data.saved.concat(saved); store.set("saved", saved); }
      if (Array.isArray(data.variables)) { variables = data.variables; store.set("variables", variables); }
      if (Array.isArray(data.environments) && data.environments.length) {
        environments = data.environments;
        activeEnvironmentId = environments.some((e) => e.id === data.activeEnvironmentId)
          ? data.activeEnvironmentId : environments[0].id;
        persistEnvironments();
      }
      renderSide(); toast("Imported");
    } catch { toast("Import failed: invalid JSON file"); }
    e.target.value = "";
  });

  syncAuthFields(); syncBodyFields(); renderSide(); refreshCurl();
}
document.addEventListener("DOMContentLoaded", init);
