// pa-desktop — Tauri backend.
// Thin HTTP client to the pa-desktop-bridge (which owns the prime-agent harness
// via DaemonClient). The frontend calls these commands; the bridge does the work.
use serde_json::Value;
use std::sync::Mutex;
use tauri::{Emitter, State};

const DEFAULT_BASE: &str = "http://100.77.132.68:8788";

struct Conn {
    base: String,
    token: String,
    client: reqwest::Client,
}

impl Conn {
    fn new(base: String, token: String) -> Self {
        Conn {
            base,
            token,
            client: reqwest::Client::new(),
        }
    }
}

struct AppState {
    conn: Mutex<Conn>,
    local_server: Mutex<LocalServerState>,
}

// ---------- helpers ----------
// Extract a request-ready snapshot (base, token, client) so we never hold the
// MutexGuard across an await (Tauri commands must return Send futures).
fn conn_snapshot(st: &State<'_, AppState>) -> (String, String, reqwest::Client) {
    let conn = st.conn.lock().unwrap();
    (conn.base.clone(), conn.token.clone(), conn.client.clone())
}

async fn get(st: &State<'_, AppState>, path: &str) -> Result<Value, String> {
    let (base, token, client) = conn_snapshot(st);
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
            .unwrap_or(reqwest::header::HeaderValue::from_static("Bearer ")),
    );
    let resp = client
        .get(format!("{}{}", base.trim_end_matches('/'), path))
        .headers(h)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(json)
    } else {
        Err(json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("request failed")
            .to_string())
    }
}

async fn post(st: &State<'_, AppState>, path: &str, body: Value) -> Result<Value, String> {
    let (base, token, client) = conn_snapshot(st);
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
            .unwrap_or(reqwest::header::HeaderValue::from_static("Bearer ")),
    );
    let resp = client
        .post(format!("{}{}", base.trim_end_matches('/'), path))
        .headers(h)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(json)
    } else {
        Err(json
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("request failed")
            .to_string())
    }
}

// ---------- commands ----------
#[tauri::command]
async fn bridge_capabilities(state: State<'_, AppState>) -> Result<Value, String> {
    get(&state, "/api/capabilities").await
}

#[tauri::command]
async fn bridge_agents(state: State<'_, AppState>) -> Result<Value, String> {
    get(&state, "/api/agents").await
}

#[tauri::command]
async fn bridge_new_session(state: State<'_, AppState>) -> Result<Value, String> {
    post(&state, "/api/new-session", Value::Null).await
}

#[tauri::command]
async fn bridge_messages(state: State<'_, AppState>, agent: String) -> Result<Value, String> {
    let q = format!("/api/messages?agent={}", urlencode(&agent));
    get(&state, &q).await
}

#[tauri::command]
async fn bridge_state(state: State<'_, AppState>, agent: String) -> Result<Value, String> {
    let q = format!("/api/state?agent={}", urlencode(&agent));
    get(&state, &q).await
}

#[tauri::command]
async fn bridge_models(state: State<'_, AppState>, agent: String) -> Result<Value, String> {
    let q = format!("/api/models?agent={}", urlencode(&agent));
    get(&state, &q).await
}

#[tauri::command]
async fn bridge_queue(state: State<'_, AppState>, agent: String) -> Result<Value, String> {
    let q = format!("/api/queue?agent={}", urlencode(&agent));
    get(&state, &q).await
}

#[tauri::command]
async fn bridge_set(
    state: State<'_, AppState>,
    agent: String,
    key: String,
    value: Value,
) -> Result<Value, String> {
    let mut body = serde_json::json!({ "agent": agent, "key": key, "value": value });
    if key == "model" {
        body["provider"] = value.get("provider").cloned().unwrap_or(Value::Null);
        body["modelId"] = value.get("modelId").cloned().unwrap_or(Value::Null);
    }
    post(&state, "/api/set", body).await
}

#[tauri::command]
async fn bridge_rename(
    state: State<'_, AppState>,
    agent: String,
    name: String,
) -> Result<Value, String> {
    post(
        &state,
        "/api/rename",
        serde_json::json!({ "agent": agent, "name": name }),
    )
    .await
}

#[tauri::command]
async fn bridge_heartbeat(
    state: State<'_, AppState>,
    agent: String,
    schedule: String,
    prompt: String,
) -> Result<Value, String> {
    post(
        &state,
        "/api/heartbeat",
        serde_json::json!({ "agent": agent, "schedule": schedule, "prompt": prompt }),
    )
    .await
}

// ---------- local control: filesystem + commands on THIS machine ----------
// These run on the machine where pa-desktop is installed (not the VPS). The
// agent reaches them via the embedded local control server (see setup_local_server).

fn local_resolve(path: String) -> std::path::PathBuf {
    let p = std::path::PathBuf::from(&path);
    if p.is_absolute() {
        p
    } else {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/")).join(p)
    }
}

#[tauri::command]
fn local_ls(path: String) -> Result<Value, String> {
    let p = local_resolve(path);
    let mut entries = Vec::new();
    for e in std::fs::read_dir(&p).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        let ft = e.file_type().map_err(|e| e.to_string())?;
        entries.push(serde_json::json!({
            "name": name,
            "isDir": ft.is_dir(),
            "isFile": ft.is_file(),
            "isSymlink": ft.is_symlink(),
        }));
    }
    entries.sort_by(|a, b| {
        let ad = a["isDir"].as_bool().unwrap_or(false);
        let bd = b["isDir"].as_bool().unwrap_or(false);
        bd.cmp(&ad).then_with(|| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")))
    });
    Ok(serde_json::json!({ "path": p.to_string_lossy(), "entries": entries }))
}

#[tauri::command]
fn local_read(path: String) -> Result<Value, String> {
    let p = local_resolve(path.clone());
    if p.is_dir() {
        return local_ls(path);
    }
    let data = std::fs::read(&p).map_err(|e| e.to_string())?;
    // binary guard: cap text, else base64
    let text = String::from_utf8_lossy(&data);
    let is_binary = data.iter().take(4096).any(|&b| b == 0);
    Ok(serde_json::json!({
        "path": p.to_string_lossy(),
        "content": if is_binary { String::new() } else { text.to_string() },
        "binary": is_binary,
        "size": data.len(),
    }))
}

#[tauri::command]
fn local_write(path: String, content: String) -> Result<Value, String> {
    let p = local_resolve(path);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let len = content.len();
    std::fs::write(&p, content).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true, "path": p.to_string_lossy(), "bytes": len }))
}

#[tauri::command]
fn local_mkdir(path: String) -> Result<Value, String> {
    let p = local_resolve(path);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true, "path": p.to_string_lossy() }))
}

#[tauri::command]
fn local_rm(path: String, recursive: bool) -> Result<Value, String> {
    let p = local_resolve(path);
    let meta = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        if !recursive {
            return Err("is a directory — pass recursive=true".into());
        }
        std::fs::remove_dir_all(&p).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    Ok(serde_json::json!({ "ok": true, "path": p.to_string_lossy() }))
}

/// Run a shell command on this machine. Returns combined stdout+stderr.
#[tauri::command]
fn local_exec(command: String, cwd: Option<String>) -> Result<Value, String> {
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "/bin/sh" };
    let mut cmd = std::process::Command::new(shell);
    if cfg!(target_os = "windows") {
        cmd.arg("/C").arg(&command);
    } else {
        cmd.arg("-c").arg(&command);
    }
    if let Some(c) = cwd {
        cmd.current_dir(local_resolve(c));
    }
    let out = cmd.output().map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    Ok(serde_json::json!({
        "ok": out.status.success(),
        "code": out.status.code(),
        "stdout": stdout,
        "stderr": stderr,
        "output": format!("{}{}{}", stdout, if !stdout.is_empty() && !stderr.is_empty() { "\n" } else { "" }, stderr),
    }))
}

// ---------- embedded local control server ----------
// Lets the VPS agent (or any tailnet device) reach THIS machine's filesystem and
// shell over HTTP. Token-protected; binds to the local Tailscale IP (tailnet only).
// Shared with the Tauri command surface via a mutex so the app can start/stop it.
use std::io::{Read, Write};
use std::sync::Arc;

pub struct LocalServerState {
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub listener: Option<Arc<Mutex<std::net::TcpListener>>>,
}

impl Default for LocalServerState {
    fn default() -> Self {
        LocalServerState { running: false, port: 8799, token: String::new(), listener: None }
    }
}

fn handle_local_conn(mut stream: std::net::TcpStream, token: &str) {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 1024];
    loop {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
                if buf.len() > 1_000_000 {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let req = String::from_utf8_lossy(&buf).to_string();
    let mut respond = |code: u16, ctype: &str, body: String| {
        let _ = stream.write_all(
            format!("HTTP/1.1 {code} {}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                if code == 200 { "OK" } else { "Error" }, body.len(), body).as_bytes());
        let _ = stream.flush();
    };
    // parse request line: METHOD PATH HTTP
    let mut lines = req.lines();
    let reqline = lines.next().unwrap_or("").to_string();
    let mut parts = reqline.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("/").to_string();
    // auth: ?token=... or Authorization: Bearer
    let authed = path.contains(&format!("token={}", token)) || req.contains(&format!("Bearer {}", token)) || token.is_empty();
    if !authed {
        return respond(401, "application/json", "{\"ok\":false,\"error\":\"unauthorized\"}".into());
    }
    let (p, q) = match path.split_once('?') {
        Some((a, b)) => (a.to_string(), b.to_string()),
        None => (path.clone(), String::new()),
    };
    let qv = |k: &str| -> Option<String> {
        q.split('&').find_map(|kv| {
            let mut it = kv.splitn(2, '=');
            if it.next() == Some(k) { Some(it.next().unwrap_or("").to_string()) } else { None }
        })
    };
    match (method.as_str(), p.as_str()) {
        ("GET", "/") => respond(200, "text/plain", format!("pa-desktop local control\nfs: /fs?path=..&token={}\nexec: /exec?cmd=..&token={}\n", token, token)),
        ("GET", "/fs") => {
            let path = qv("path").unwrap_or_else(|| "/".into());
            match local_ls(path) {
                Ok(v) => respond(200, "application/json", v.to_string()),
                Err(e) => respond(400, "application/json", format!("{{\"ok\":false,\"error\":{}}}", serde_json::json!(e))),
            }
        }
        ("GET", "/read") => {
            let path = qv("path").unwrap_or_default();
            match local_read(path) {
                Ok(v) => respond(200, "application/json", v.to_string()),
                Err(e) => respond(400, "application/json", format!("{{\"ok\":false,\"error\":{}}}", serde_json::json!(e))),
            }
        }
        ("POST", "/exec") => {
            let cmd = qv("cmd").unwrap_or_default();
            let cwd = qv("cwd");
            match local_exec(cmd, cwd) {
                Ok(v) => respond(200, "application/json", v.to_string()),
                Err(e) => respond(400, "application/json", format!("{{\"ok\":false,\"error\":{}}}", serde_json::json!(e))),
            }
        }
        _ => respond(404, "application/json", "{\"ok\":false,\"error\":\"no route\"}".into()),
    }
}

fn spawn_local_server(state: Arc<LocalServerState>) {
    let token = state.token.clone();
    let listener = match state.listener.as_ref() {
        Some(l) => l.clone(),
        None => return,
    };
    std::thread::spawn(move || {
        loop {
            match listener.lock().unwrap().accept() {
                Ok((stream, _)) => {
                    let token = token.clone();
                    std::thread::spawn(move || handle_local_conn(stream, &token));
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
fn local_server_start(state: tauri::State<'_, AppState>, port: Option<u16>, token: Option<String>) -> Result<Value, String> {
    let mut ls = state.local_server.lock().map_err(|e| e.to_string())?;
    if ls.running {
        return Ok(serde_json::json!({ "running": true, "port": ls.port }));
    }
    ls.port = port.unwrap_or(8799);
    ls.token = token.unwrap_or_default();
    let bind = format!("0.0.0.0:{}", ls.port);
    let listener = std::net::TcpListener::bind(&bind).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    ls.listener = Some(Arc::new(Mutex::new(listener)));
    ls.running = true;
    let arc = Arc::new(LocalServerState { running: true, port: ls.port, token: ls.token.clone(), listener: ls.listener.clone() });
    spawn_local_server(arc);
    Ok(serde_json::json!({ "running": true, "port": ls.port, "token": ls.token }))
}

#[tauri::command]
fn local_server_status(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let ls = state.local_server.lock().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "running": ls.running, "port": ls.port, "token": ls.token }))
}

#[tauri::command]
fn local_server_stop(state: tauri::State<'_, AppState>) -> Result<Value, String> {
    let mut ls = state.local_server.lock().map_err(|e| e.to_string())?;
    ls.running = false;
    ls.listener = None;
    Ok(serde_json::json!({ "running": false }))
}


#[tauri::command]
async fn memory_get(state: State<'_, AppState>) -> Result<Value, String> {
    get(&state, "/api/memory").await
}

#[tauri::command]
async fn memory_append(state: State<'_, AppState>, fact: String) -> Result<Value, String> {
    post(
        &state,
        "/api/memory/append",
        serde_json::json!({ "fact": fact }),
    )
    .await
}

#[tauri::command]
async fn memory_write(state: State<'_, AppState>, text: String) -> Result<Value, String> {
    post(&state, "/api/memory/write", serde_json::json!({ "text": text })).await
}

#[tauri::command]
async fn skill_save(
    state: State<'_, AppState>,
    name: String,
    description: String,
    content: String,
) -> Result<Value, String> {
    post(
        &state,
        "/api/skills/save",
        serde_json::json!({ "name": name, "description": description, "content": content }),
    )
    .await
}

#[tauri::command]
async fn skill_delete(state: State<'_, AppState>, name: String) -> Result<Value, String> {
    post(&state, "/api/skills/delete", serde_json::json!({ "name": name })).await
}

// Chat with SSE streaming: connect to /api/chat-stream, parse SSE lines, emit
// "pa://chat-event" to the frontend, return final messages.
#[tauri::command]
async fn bridge_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    agent: String,
    message: String,
) -> Result<Value, String> {
    let conn_base = {
        let c = state.conn.lock().unwrap();
        (c.base.clone(), c.token.clone())
    };
    let client = reqwest::Client::new();
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", conn_base.1))
            .unwrap_or(reqwest::header::HeaderValue::from_static("Bearer ")),
    );
    let url = format!("{}/api/chat-stream", conn_base.0.trim_end_matches('/'));
    let resp = client
        .post(url)
        .headers(h)
        .json(&serde_json::json!({ "agent": agent, "message": message }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("chat failed: HTTP {}", resp.status()));
    }
    use futures_util::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut collected: Vec<Value> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        buf.extend_from_slice(&chunk);
        // Split on \n\n (SSE block boundaries).
        while let Some(pos) = buf.windows(2).position(|w| w == b"\n\n") {
            let block: Vec<u8> = buf.drain(..=pos + 1).collect();
            let text = String::from_utf8_lossy(&block);
            for line in text.lines() {
                if let Some(data) = line.strip_prefix("data:") {
                    let data = data.trim();
                    if data.is_empty() || data == "{}" {
                        continue;
                    }
                    if let Ok(v) = serde_json::from_str::<Value>(data) {
                        if let Some(msgs) = v.get("messages").and_then(Value::as_array) {
                            if !msgs.is_empty() {
                                collected.extend(msgs.iter().cloned());
                                // Stream live activity to the frontend so the UI
                                // shows tool calls/thinking/text as they happen.
                                let _ = app.emit(
                                    "pa://chat-event",
                                    serde_json::json!({ "type": "messages", "messages": msgs }),
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(serde_json::json!({ "messages": collected }))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[tauri::command]
async fn set_connection(
    state: State<'_, AppState>,
    base: String,
    token: String,
) -> Result<(), String> {
    let mut conn = state.conn.lock().unwrap();
    conn.base = base;
    conn.token = token;
    Ok(())
}

#[tauri::command]
async fn get_connection(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.conn.lock().unwrap();
    Ok(serde_json::json!({ "base": conn.base, "token": conn.token }))
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            conn: Mutex::new(Conn::new(
                std::env::var("PA_DESKTOP_BASE").unwrap_or_else(|_| DEFAULT_BASE.to_string()),
                std::env::var("PA_DESKTOP_TOKEN").unwrap_or_default(),
            )),
            local_server: Mutex::new(LocalServerState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            bridge_capabilities,
            bridge_agents,
            bridge_new_session,
            bridge_messages,
            bridge_state,
            bridge_models,
            bridge_queue,
            bridge_set,
            bridge_rename,
            bridge_heartbeat,
            bridge_chat,
            memory_get,
            memory_append,
            memory_write,
            skill_save,
            skill_delete,
            local_ls,
            local_read,
            local_write,
            local_mkdir,
            local_rm,
            local_exec,
            local_server_start,
            local_server_status,
            local_server_stop,
            set_connection,
            get_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pa-desktop");
}
