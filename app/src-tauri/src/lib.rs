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

// ---------- memory ----------
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
            set_connection,
            get_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pa-desktop");
}
