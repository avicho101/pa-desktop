import { useEffect, useState } from "react";
import { api, Agent } from "./api";
import ChatView from "./components/ChatView";
import SettingsView from "./components/SettingsView";
import MemoryView from "./components/MemoryView";
import LocalControlView from "./components/LocalControlView";
import ModelPicker from "./components/ModelPicker";

type View = "chat" | "settings" | "memory" | "local";

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<View>("chat");
  const [connOk, setConnOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(
    (localStorage.getItem("pa_theme") as "dark" | "light") || "dark"
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("pa_theme", theme);
  }, [theme]);

  async function refreshAgents(select?: string) {
    try {
      const r = await api.agents();
      setAgents(r.agents);
      if (select) setActiveId(select);
      else if (!activeId && r.agents.length > 0) setActiveId(r.agents[0].id);
      setConnOk(true);
      setError(null);
    } catch (e) {
      setConnOk(false);
      setError(String(e));
    }
  }

  useEffect(() => {
    refreshAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function newSession() {
    setBusy(true);
    try {
      const r = await api.newSession();
      setAgents(r.agents);
      const newest = r.agents[0];
      if (newest) setActiveId(newest.id);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const active = agents.find((a) => a.id === activeId) ?? null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            <div className="brand-logo">PA</div>
            <div>
              <div className="brand-name">pa-desktop</div>
              <div className="brand-sub">Prime Agent</div>
            </div>
          </div>
          <button className="new-chat" onClick={newSession} disabled={busy}>
            {busy ? <span className="spinner" /> : "+"} New chat
          </button>
        </div>

        <div className="session-list">
          <div className="session-list-title">Sessions</div>
          {agents.length === 0 && <div className="center-pad">No sessions yet</div>}
          {agents.map((a) => (
            <div
              key={a.id}
              className={`session-item ${a.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(a.id)}
            >
              <div className="session-item-name">{a.name || a.model || "Untitled"}</div>
              <div className="session-item-meta">
                <span
                  className={`status-dot ${
                    a.status === "working" || a.status === "busy" || a.status === "streaming"
                      ? "status-working"
                      : a.status === "error"
                      ? "status-error"
                      : a.status
                      ? "status-queued"
                      : "status-idle"
                  }`}
                />
                <span>{a.status || "idle"}</span>
                <span>{a.messages} msgs</span>
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-foot">
          <div className="conn-status">
            <span className={`dot ${connOk ? "dot-on" : "dot-off"}`} />
            {connOk ? "Connected to VPS daemon" : "Disconnected"}
          </div>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <div className="nav-tabs">
            <button
              className={`nav-tab ${view === "chat" ? "active" : ""}`}
              onClick={() => setView("chat")}
            >
              Chat
            </button>
            <button
              className={`nav-tab ${view === "memory" ? "active" : ""}`}
              onClick={() => setView("memory")}
            >
              Memory
            </button>
            <button
              className={`nav-tab ${view === "local" ? "active" : ""}`}
              onClick={() => setView("local")}
            >
              Local
            </button>
            <button
              className={`nav-tab ${view === "settings" ? "active" : ""}`}
              onClick={() => setView("settings")}
            >
              Settings
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {error && (
          <div className="banner error" style={{ margin: "12px 20px 0" }}>
            <span>⚠</span> {error}
          </div>
        )}

        {view === "chat" && (
          <ChatView
            agent={active}
            onModelClick={() => setShowModelPicker(true)}
            onRename={(id, name) => {
              setAgents((prev) =>
                prev.map((a) => (a.id === id ? { ...a, name } : a))
              );
            }}
            onRefresh={() => refreshAgents()}
          />
        )}
        {view === "memory" && <MemoryView />}
        {view === "local" && <LocalControlView />}
        {view === "settings" && (
          <SettingsView
            agent={active}
            onConnChange={() => {
              refreshAgents();
            }}
          />
        )}
      </main>

      {showModelPicker && active && (
        <ModelPicker
          agent={active}
          onClose={() => setShowModelPicker(false)}
          onChanged={() => refreshAgents(active.id)}
        />
      )}
    </div>
  );
}
