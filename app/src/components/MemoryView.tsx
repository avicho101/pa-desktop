import { useEffect, useState } from "react";
import { api, Skill } from "../api";

export default function MemoryView() {
  const [memory, setMemory] = useState("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // new skill form
  const [skName, setSkName] = useState("");
  const [skDesc, setSkDesc] = useState("");
  const [skContent, setSkContent] = useState("");

  useEffect(() => {
    api
      .memoryGet()
      .then((r) => {
        setMemory(r.memory);
        setSkills(r.skills);
      })
      .catch((e) => setMsg({ type: "error", text: String(e) }))
      .finally(() => setLoading(false));
  }, []);

  async function refresh() {
    const r = await api.memoryGet();
    setMemory(r.memory);
    setSkills(r.skills);
  }

  async function saveMemory() {
    setSaving(true);
    setMsg(null);
    try {
      await api.memoryWrite(memory);
      setMsg({ type: "ok", text: "Memory saved" });
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function appendFact() {
    const f = prompt("New fact to remember:");
    if (!f) return;
    setMsg(null);
    try {
      await api.memoryAppend(f);
      setMsg({ type: "ok", text: "Fact added" });
      await refresh();
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    }
  }

  async function saveSkill() {
    if (!skName.trim() || !skContent.trim()) {
      setMsg({ type: "error", text: "Name + content required" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.skillSave(skName.trim(), skDesc.trim(), skContent);
      setMsg({ type: "ok", text: "Skill saved — auto-loads into every session" });
      setSkName("");
      setSkDesc("");
      setSkContent("");
      await refresh();
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function delSkill(name: string) {
    if (!confirm(`Delete skill ${name}?`)) return;
    setMsg(null);
    try {
      await api.skillDelete(name);
      setMsg({ type: "ok", text: `Deleted ${name}` });
      await refresh();
    } catch (e) {
      setMsg({ type: "error", text: String(e) });
    }
  }

  return (
    <div className="settings">
      <h2>Memory & Skills</h2>
      <p className="settings-sub">
        Persistent store under <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>~/.prime/agent/</code>. The agent
        appends facts across sessions and auto-loads every skill.
      </p>

      {msg && (
        <div className={`banner ${msg.type}`}>
          {msg.type === "ok" ? "✓" : "⚠"} {msg.text}
        </div>
      )}

      <div className="settings-sec">
        <div className="settings-sec-title">Long-term memory</div>
        <textarea
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          placeholder="Loading…"
          style={{
            width: "100%", height: 200, background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: 8, color: "var(--text)", fontFamily: "var(--mono)", fontSize: 12.5,
            padding: 12, resize: "vertical", outline: "none",
          }}
          spellCheck={false}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
          <button className="btn primary" onClick={saveMemory} disabled={saving}>
            {saving ? "Saving…" : "Save memory"}
          </button>
          <button className="btn" onClick={appendFact}>+ Add fact</button>
        </div>
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">
          Skills <span style={{ color: "var(--text-faint)", textTransform: "none" }}>(auto-loaded into the agent)</span>
        </div>
        {loading && <div className="center-pad">Loading…</div>}
        {!loading && skills.length === 0 && (
          <div className="center-pad">No skills yet.</div>
        )}
        {skills.map((s) => (
          <div className="setting-row" key={s.name}>
            <div className="setting-label">
              <span className="name">{s.name}</span>
              <span className="desc">{s.description}</span>
            </div>
            <button className="btn danger" onClick={() => delSkill(s.name)}>
              Delete
            </button>
          </div>
        ))}
      </div>

      <div className="settings-sec">
        <div className="settings-sec-title">New skill</div>
        <div className="conn-form">
          <div className="conn-field">
            <label>Name</label>
            <input type="text" value={skName} onChange={(e) => setSkName(e.target.value)} placeholder="my-procedure" />
          </div>
          <div className="conn-field">
            <label>Description</label>
            <input type="text" value={skDesc} onChange={(e) => setSkDesc(e.target.value)} placeholder="What it does" />
          </div>
          <div className="conn-field">
            <label>Instructions (markdown)</label>
            <textarea
              value={skContent}
              onChange={(e) => setSkContent(e.target.value)}
              placeholder="Steps / procedure the agent should follow…"
              style={{ height: 130, fontFamily: "var(--mono)", fontSize: 12.5 }}
            />
          </div>
          <div>
            <button className="btn primary" onClick={saveSkill} disabled={saving}>
              {saving ? "Saving…" : "Save skill"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
