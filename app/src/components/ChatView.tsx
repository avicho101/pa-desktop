import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Agent, Msg } from "../api";

interface Props {
  agent: Agent | null;
  onModelClick: () => void;
  onRename: (id: string, name: string) => void;
  onRefresh: () => void;
}

export default function ChatView({ agent, onModelClick, onRename, onRefresh }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const messagesRef = useRef<Msg[]>([]);
  // keep ref in sync so send() can snapshot the pre-prompt transcript
  messagesRef.current = messages;
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"high" | "full">(
    (localStorage.getItem("pa_view") as "high" | "full") || "high"
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!agent) {
      setMessages([]);
      return;
    }
    setLoading(true);
    api
      .messages(agent.id)
      .then((r) => setMessages(r.messages))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [agent?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !agent || sending) return;
    setInput("");
    setSending(true);
    // snapshot of the transcript BEFORE this prompt, so live events and the final
    // result both anchor to the same base (history preserved)
    const base = messagesRef.current;
    const userMsg: Msg = { role: "user", text };
    setMessages([...base, userMsg]);
    // live activity: stream assistant messages (tool calls, thinking, text) as
    // they happen, replacing the typing dots in real time.
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<{ type: string; messages?: Msg[] }>("pa://chat-event", (ev) => {
        if (ev.payload.type !== "messages" || !ev.payload.messages) return;
        // payload is the full running tail INCLUDING the user message -> render
        // base + tail (no separate userMsg, avoids duplication)
        setMessages([...base, ...ev.payload.messages!]);
      });
      const r = await api.chat(agent.id, text);
      setMessages([...base, ...r.messages]);
      onRefresh();
    } catch (e) {
      setMessages([...base, userMsg, { role: "assistant", text: `⚠ Error: ${String(e)}` }]);
    } finally {
      unlisten?.();
      setSending(false);
    }
  }, [input, agent, sending, onRefresh]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="topbar">
        <div className="topbar-title">
          <h2>{agent?.name || agent?.id || "No session"}</h2>
          <span>{agent ? `${agent.status} · ${agent.messages} messages` : "Select or create a session"}</span>
        </div>
        <div className="topbar-actions">
          <button
            className={`view-toggle ${viewMode}`}
            title="Toggle highlights / full view"
            onClick={() => {
              const next = viewMode === "full" ? "high" : "full";
              setViewMode(next);
              localStorage.setItem("pa_view", next);
            }}
          >
            ◉ {viewMode === "full" ? "Full" : "High"}
          </button>
          {agent && (
            <>
              <button className="model-chip" onClick={onModelClick} title="Choose model">
                <span className="model-dot" />
                {agent.model || "Choose model"}
                <span className="chev">▾</span>
              </button>
              <button
                className="icon-btn"
                title="Rename session"
                onClick={() => {
                  const name = prompt("Session name:", agent.name);
                  if (name) {
                    api
                      .rename(agent.id, name)
                      .then(() => onRename(agent.id, name))
                      .catch((e) => alert(`Rename failed: ${e}`));
                  }
                }}
              >
                ✎
              </button>
            </>
          )}
        </div>
      </div>

      <div className="chat-area">
        {!agent && (
          <div className="chat-empty">
            <div className="big">💬</div>
            <h3>Start a conversation</h3>
            <p>Pick a session on the left, or create a new chat.</p>
          </div>
        )}
        {agent && loading && <div className="center-pad">Loading messages…</div>}
        {agent && !loading && messages.length === 0 && !sending && (
          <div className="chat-empty">
            <div className="big">✨</div>
            <h3>{agent.name || "New session"}</h3>
            <p>Send a message to {agent.model || "the agent"}.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} m={m} full={viewMode === "full"} />
        ))}
        {sending && (
          <div className="msg-group">
            <div className="msg-row">
              <div className="msg-avatar assistant">PA</div>
              <div className="msg-body">
                <div className="msg-role">pa-desktop</div>
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={onKey}
            placeholder={agent ? `Message ${agent.name || "agent"}…` : "Select a session to start"}
            disabled={!agent || sending}
            rows={1}
          />
          <button className="send-btn" onClick={send} disabled={!agent || sending || !input.trim()}>
            ↑
          </button>
        </div>
        <div className="composer-hint">
          Enter to send · Shift+Enter for newline{agent?.model ? ` · ${agent.model}` : ""}
        </div>
      </div>
    </div>
  );
}

function Message({ m, full }: { m: Msg; full: boolean }) {
  const isUser = m.role === "user";
  const label = isUser ? "You" : "pa-desktop";
  return (
    <div className="msg-group">
      <div className="msg-row">
        <div className={`msg-avatar ${isUser ? "user" : "assistant"}`}>
          {isUser ? "U" : "PA"}
        </div>
        <div className="msg-body">
          <div className="msg-role">{label}</div>
          {full && m.thinking && <div className="thinking">{m.thinking}</div>}
          {(m.tools ?? []).length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {(m.tools ?? []).map((t, i) => {
                const argKeys =
                  full && t.arguments && typeof t.arguments === "object"
                    ? Object.keys(t.arguments as object).join(", ")
                    : null;
                return (
                  <div className="tool-row" key={i}>
                    <span>⚙</span>
                    <span className="tool-name">{t.name}</span>
                    {argKeys !== null && <span className="tool-args">{argKeys}</span>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="msg-text">{renderText(m.text)}</div>
        </div>
      </div>
    </div>
  );
}

// Very light markdown: fenced code blocks + inline code. (Full MD would need a
// dependency; keep the shell minimal like Unsloth.)
function renderText(text: string) {
  const blocks = text.split(/```/);
  const out: React.ReactNode[] = [];
  blocks.forEach((part, i) => {
    if (i % 2 === 1) {
      // code block
      const [lang, ...rest] = part.split("\n");
      const code = rest.join("\n");
      out.push(
        <pre key={i}>
          <code>{code}</code>
          {lang.trim() && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{lang.trim()}</div>}
        </pre>
      );
    } else {
      out.push(<span key={i}>{inlineCode(part)}</span>);
    }
  });
  return out;
}

function inlineCode(text: string): React.ReactNode {
  const parts = text.split(/`/);
  const out: React.ReactNode[] = [];
  parts.forEach((p, i) => {
    if (i % 2 === 1) {
      out.push(
        <code key={i} style={{ fontFamily: "var(--mono)" }}>
          {p}
        </code>
      );
    } else {
      out.push(<span key={i}>{p}</span>);
    }
  });
  return out;
}
