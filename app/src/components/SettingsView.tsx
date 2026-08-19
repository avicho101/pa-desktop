import { useEffect, useState } from "react";
import { api, Agent, Capabilities, SessionState } from "../api";

interface Props {
  agent: Agent | null;
  onConnChange: () => void;
}

const DEFAULT_CAPS: Capabilities = {
  capabilities: [],
  thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
  serviceTiers: ["auto", "default", "flex", "scale", "priority"],
  transports: ["sse", "websocket", "http", "stdio", "acp"],
  queueModes: ["all", "one-at-a-time"],
};

function descOf(key: string): string {
  switch (key) {
    case "thinking":
      return "Reasoning effort for the model. From off (no chain-of-thought) to max (deepest reasoning).";
    case "serviceTier":
      return "API service tier for providers that support it (auto lets the model decide).";
    case "transport":
      return "Streaming transport used to talk to the model provider.";
    case "steeringMode":
      return "How queued steering messages are consumed: all at once, or one-at-a-time.";
    case "followUpMode":
      return "How follow-up messages are queued while the agent is busy.";
    case "autoCompaction":
      return "Automatically compact the conversation when context fills up.";
    case "autoRetry":
      return "Automatically retry transient provider/network failures.";
    case "rlmDepth":
      return "Max depth for recursive agentic sub-tasks (RLM children).";
    default:
      return "";
  }
}

export default function SettingsView({ agent, onConnChange }: Props) {
  const [caps, setCaps] = useState<Capabilities>(DEFAULT_CAPS);
  const [state, setState] = useState<SessionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // connection form
  const [connBase, setConnBase] = useState("");
  const [connToken, setConnToken] = useState("");
  const [connLoaded, setConnLoaded] = useState(false);

  useEffect(() => {
    api
      .capabilities()
      .then((c) => setCaps({ ...DEFAULT_CAPS, ...c }))
      .catch(() => {});
    api
      .getConnection()
      .then((c) => {
        setConnBase(c.base);
        setConnToken(c.token);
        setConnLoaded(true);
      })
      .catch(() => setConnLoaded(true));
  }, []);

  useEffect(() => {
    if (!agent) {
      setState(null);
      return;
    }
    setLoading(true);
    api
      .state(agent.id)
      .then((r) => setState(r.state ?? null))
      .catch((e) => setMsg({ type: "error", text: String(e) }))
      .finally(() => setLoading(false));
  }, [agent?.id]);

  async function save(key: string, value: unknown) {
    if (!agent) return;
    setSaving(key);
    setMsg(null);
    try {
      await api.set(agent.id, key, value);
      setMsg({ type: "ok", text: "Saved" });
      const r = await api.state(agent.id);
      setState(r.state ?? null);
    } catch (e) {
      setMsg({ type: "error", text: `Save failed: ${String(e)}` });
    } finally {
      setSaving(null);
    }
  }

  async function saveHeartbeat() {
    if (!agent) return;
    setSaving("heartbeat");
    setMsg(null);
    try {
      await api.heartbeat(agent.id, hbSchedule, hbPrompt);
      setMsg({ type: "ok", text: "Heartbeat saved" });
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    } finally {
      setSaving(null);
    }
  }

  async function saveConnection() {
    setSaving("conn");
    setMsg(null);
    try {
      await api.setConnection(connBase.trim(), connToken.trim());
      setMsg({ type: "ok", text: "Connection saved. Reconnecting…" });
      onConnChange();
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    } finally {
      setSaving(null);
    }
  }

  const [hbSchedule, setHbSchedule] = useState("0 9 * * *");
  const [hbPrompt, setHbPrompt] = useState("");

  if (!agent) {
    return (
      <div className="settings">
        <h2>Settings</h2>
        <p className="settings-sub">Select a session to configure it.</p>
      </div>
    );
  }

  const th = state?.thinkingLevel ?? "off";
  const st = state?.serviceTier ?? "auto";
  const tr = state?.transport ?? "sse";

  return (
    <div className="settings">
      <h2>Settings</h2>
      <p className="settings-sub">
        Session: <b>{state?.sessionName || agent.name || agent.id}</b>
      </p>

      {msg && (
        <div className={`banner ${msg.type}`}>
          {msg.type === "ok" ? "✓" : "⚠"} {msg.text}
        </div>
      )}
      {loading && <div className="center-pad"><span className="spinner" /> Loading state…</div>}

      <div className="settings-sec">
        <div className="settings-sec-title">Agent capabilities</div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Thinking level</span>
            <span className="desc">{descOf("thinking")}</span>
          </div>
          <select value={th} onChange={(e) => save("thinking", e.target.value)} disabled={saving === "thinking"}>
            {caps.thinkingLevels.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Service tier</span>
            <span className="desc">{descOf("serviceTier")}</span>
          </div>
          <select value={st === null ? "auto" : st} onChange={(e) => save("serviceTier", e.target.value)} disabled={saving === "serviceTier"}>
            {caps.serviceTiers.map((t) => (
              <option key={t} value={t === null ? "auto" : t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Transport</span>
            <span className="desc">{descOf("transport")}</span>
          </div>
          <select value={tr} onChange={(e) => save("transport", e.target.value)} disabled={saving === "transport"}>
            {caps.transports.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">Queueing</div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Steering mode</span>
            <span className="desc">{descOf("steeringMode")}</span>
          </div>
          <select
            value={state?.steeringMode ?? "all"}
            onChange={(e) => save("steeringMode", e.target.value)}
            disabled={saving === "steeringMode"}
          >
            {caps.queueModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Follow-up mode</span>
            <span className="desc">{descOf("followUpMode")}</span>
          </div>
          <select
            value={state?.followUpMode ?? "all"}
            onChange={(e) => save("followUpMode", e.target.value)}
            disabled={saving === "followUpMode"}
          >
            {caps.queueModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">Automation</div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Auto-compaction</span>
            <span className="desc">{descOf("autoCompaction")}</span>
          </div>
          <Toggle
            on={!!state?.autoCompaction}
            onChange={(v) => save("autoCompaction", v)}
            disabled={saving === "autoCompaction"}
          />
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Auto-retry</span>
            <span className="desc">{descOf("autoRetry")}</span>
          </div>
          <Toggle
            on={!!state?.autoRetry}
            onChange={(v) => save("autoRetry", v)}
            disabled={saving === "autoRetry"}
          />
        </div>

        <div className="setting-row">
          <div className="setting-label">
            <span className="name">RLM max depth</span>
            <span className="desc">{descOf("rlmDepth")} Current: {state?.rlmDepth ?? 0}</span>
          </div>
          <div className="range-row">
            <input
              type="range"
              min={0}
              max={8}
              value={state?.rlmDepth ?? 0}
              onChange={(e) => save("rlmDepth", Number(e.target.value))}
              disabled={saving === "rlmDepth"}
            />
            <span style={{ width: 20, textAlign: "center", fontSize: 13 }}>{state?.rlmDepth ?? 0}</span>
          </div>
        </div>
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">Heartbeat scheduler</div>
        <div className="setting-row">
          <div className="setting-label">
            <span className="name">Cron schedule</span>
            <span className="desc">Cron expression, e.g. 0 9 * * * (daily 09:00).</span>
          </div>
          <input
            type="text"
            value={hbSchedule}
            onChange={(e) => setHbSchedule(e.target.value)}
            style={{ minWidth: 120 }}
          />
        </div>
        <div className="setting-row" style={{ alignItems: "flex-start" }}>
          <div className="setting-label">
            <span className="name">Prompt</span>
            <span className="desc">What the agent should do on each tick.</span>
          </div>
          <input
            type="text"
            value={hbPrompt}
            onChange={(e) => setHbPrompt(e.target.value)}
            style={{ minWidth: 220 }}
            placeholder="Daily summary…"
          />
        </div>
        <div className="setting-row">
          <span />
          <button className="btn primary" onClick={saveHeartbeat} disabled={saving === "heartbeat"}>
            {saving === "heartbeat" ? "Saving…" : "Set heartbeat"}
          </button>
        </div>
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">Connection</div>
        {connLoaded && (
          <div className="conn-form">
            <div className="conn-field">
              <label>Bridge base URL (Tailscale)</label>
              <input type="text" value={connBase} onChange={(e) => setConnBase(e.target.value)} placeholder="http://100.77.132.68:8788" />
            </div>
            <div className="conn-field">
              <label>Token (optional)</label>
              <input type="password" value={connToken} onChange={(e) => setConnToken(e.target.value)} placeholder="leave empty for tailnet-only" />
            </div>
            <div>
              <button className="btn primary" onClick={saveConnection} disabled={saving === "conn"}>
                {saving === "conn" ? "Saving…" : "Save connection"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 24 }} />
    </div>
  );
}

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="slider" />
    </label>
  );
}
