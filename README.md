# pa-desktop

A **native desktop app for [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent)** (the coding/research agent by PrimeIntellect), built with **Tauri v2 + React**. Minimal, Unsloth-style UI with a rich model picker and a Settings panel wired to the agent's real capabilities.

![stack](https://img.shields.io/badge/Tauri-v2-8ab4ff) ![stack](https://img.shields.io/badge/React-18-61dafb) ![platform](https://img.shields.io/badge/Win%20%7C%20macOS%20%7C%20Linux-all-green)

---

## How it works

```
┌─────────────────────┐        HTTP + SSE         ┌──────────────────────────┐
│  pa-desktop (Tauri) │  ───────────────────────► │  pa-desktop-bridge (VPS) │
│  React UI           │  over Tailscale           │  embeds DaemonClient      │
└─────────────────────┘                            └───────────┬──────────────┘
                                                               │ unix socket
                                                ┌──────────────▼──────────────┐
                                                │  prime-agent daemon         │
                                                │  (runs your agents/sessions) │
                                                └─────────────────────────────┘
```

- **pa-desktop** (this repo) is the cross-platform native shell. Its Rust backend is a thin client that proxies to the bridge. It does **not** need prime-agent installed locally — it talks to your VPS over Tailscale.
- **pa-desktop-bridge** (`bridge/`) is a small Node HTTP server that embeds the real `DaemonClient` from the prime-agent harness and exposes the full daemon capability surface over HTTP + SSE. It binds to the **Tailscale IP only**, so it's never on the public internet.

This is the "fully forking the harness" approach: instead of re-implementing the wire protocol, the bridge reuses prime-agent's own `DaemonClient` (the same one the CLI uses), so session/agent control is 100% native to the harness.

---

## What you can do

### Chat
- Session list (left sidebar), create new sessions, rename.
- Chat with any agent; streaming responses over SSE; thinking blocks collapsed; tool calls shown inline.
- Live connection status to the VPS daemon.

### Model picker (Unsloth-style)
- Modal, searchable, **grouped by provider**.
- Badges: **reasoning**, **free**, **input cost /1M**, **modality** (text/image), **context window**.
- Select a model → issues `set_model` on the live session.

### Settings (wired to real daemon commands)
| Setting | Daemon command | Options |
|---|---|---|
| Thinking level | `set_thinking_level` | off, minimal, low, medium, high, xhigh, max |
| Service tier | `set_service_tier` | auto, default, flex, scale, priority |
| Transport | `set_transport` | sse, websocket, http, stdio, acp |
| Steering mode | `set_steering_mode` | all, one-at-a-time |
| Follow-up mode | `set_follow_up_mode` | all, one-at-a-time |
| Auto-compaction | `set_auto_compaction` | toggle |
| Auto-retry | `set_auto_retry` | toggle |
| RLM max depth | `set_rlm_max_depth` | slider 0–8 |
| Heartbeat scheduler | `heartbeat_set` | cron + prompt |
| Connection | `set_connection` | bridge URL + token |

---

## Layout

```
pa-desktop/
├── app/                    # Tauri v2 + React desktop app
│   ├── src/                #   React frontend
│   │   ├── App.tsx
│   │   ├── api.ts          #   typed Tauri IPC client
│   │   ├── styles.css      #   Unsloth-minimal dark theme
│   │   └── components/
│   │       ├── ChatView.tsx
│   │       ├── SettingsView.tsx
│   │       └── ModelPicker.tsx
│   └── src-tauri/          #   Rust backend (HTTP proxy + SSE chat)
│       ├── src/lib.rs
│       └── tauri.conf.json
├── bridge/                 # pa-desktop-bridge (runs on VPS)
│   └── server.mjs          #   embeds DaemonClient, HTTP+SSE server
├── scripts/gen_icons.py
├── build.sh / build.cmd    # build+verify helpers
└── README.md
```

---

## Quick start

### 1. Deploy the bridge on the VPS (one time)

```bash
cd bridge
npm install --no-audit --no-fund   # no runtime deps; just the harness client
node server.mjs
# or as a systemd service:
sudo cp pa-desktop-bridge.service /etc/systemd/system/
sudo systemctl enable --now pa-desktop-bridge
```

The bridge auto-detects the Tailscale IP and binds there (default port **8788**).
Set `PA_DESKTOP_TOKEN` to require a bearer token (default: tailnet-only trust).

### 2. Build & run the desktop app

Requires [Rust](https://rustup.rs) (stable) + [Node](https://nodejs.org) 20+.

```bash
cd app
npm install
npm run tauri dev      # dev mode
npm run tauri build    # production installer (.exe / .dmg / .deb/.rpm/.AppImage)
```

On Linux you may need Tauri system deps:
```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

### 3. Configure connection
In **Settings → Connection**, set the bridge URL (e.g. `http://100.77.132.68:8788`) and an optional token. This is stored in-app (env override: `PA_DESKTOP_BASE`, `PA_DESKTOP_TOKEN`).

---

## Verification

- `npm run build` (tsc + vite) — **0 errors**
- `cargo check` (in `app/src-tauri`) — **0 errors / 0 warnings**
- Bridge smoke test:
  ```bash
  curl http://<tailscale-ip>:8788/api/capabilities
  curl -X POST http://<tailscale-ip>:8788/api/chat-stream -d '{"agent":"<id>","message":"hi"}'
  ```

## Security

- The bridge binds to the **Tailscale IP only** (never `0.0.0.0`).
- Optional `PA_DESKTOP_TOKEN` bearer auth for an extra layer.
- The desktop app connects over your Tailnet; no public exposure.

## Roadmap
- [ ] Streaming token-level chat (currently streams full turn chunks)
- [ ] Attach to existing tmux/PC sessions in addition to new ones
- [ ] Agent/subagent tree view (`get_context_tree`)
- [ ] Cron job manager (`cron_list` / `cron_add`)
- [ ] Auto-detection + one-click bridge deploy from the app
