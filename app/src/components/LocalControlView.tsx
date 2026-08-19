import { useEffect, useRef, useState } from "react";
import { api, FsEntry } from "../api";

export default function LocalControlView() {
  // files
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [fsErr, setFsErr] = useState<string | null>(null);
  // editor
  const [editPath, setEditPath] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  // terminal
  const [term, setTerm] = useState<string>("");
  const [cmd, setCmd] = useState("");
  const [running, setRunning] = useState(false);
  const [termCwd, setTermCwd] = useState("/");
  const termEnd = useRef<HTMLDivElement>(null);
  // server
  const [srv, setSrv] = useState<{ running: boolean; port: number; token?: string }>({
    running: false, port: 8799,
  });
  const [srvToken, setSrvToken] = useState("");

  async function ls(path: string) {
    setFsErr(null);
    try {
      const r = await api.localLs(path);
      setCwd(r.path);
      setEntries(r.entries);
    } catch (e) {
      setFsErr(String(e));
    }
  }
  useEffect(() => {
    ls("/");
    api.localServerStatus().then((s) => setSrv(s)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    termEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [term]);

  async function openFile(p: string) {
    try {
      const r = await api.localRead(p);
      if (r.binary) {
        setFsErr(`${p} is binary`);
        return;
      }
      setEditPath(p);
      setEditContent(r.content);
    } catch (e) {
      setFsErr(String(e));
    }
  }

  async function saveFile() {
    if (!editPath) return;
    try {
      await api.localWrite(editPath, editContent);
      setFsErr(null);
      setEditPath(null);
      setEditContent("");
      ls(cwd);
    } catch (e) {
      setFsErr(String(e));
    }
  }

  async function run() {
    const c = cmd.trim();
    if (!c || running) return;
    setRunning(true);
    setTerm((t) => t + `\n$ ${c}\n`);
    setCmd("");
    try {
      const r = await api.localExec(c, termCwd);
      setTerm((t) => t + (r.output || "(no output)") + (r.code !== 0 ? `\n[exit ${r.code}]` : ""));
      if (c.startsWith("cd ")) {
        const d = c.slice(3).trim();
        setTermCwd(d);
      }
    } catch (e) {
      setTerm((t) => t + `\n⚠ ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  async function startServer() {
    try {
      const r = await api.localServerStart(8799, srvToken.trim() || undefined);
      setSrv({ ...r, token: r.token });
      setFsErr(null);
    } catch (e) {
      setFsErr(String(e));
    }
  }

  async function stopServer() {
    try {
      const r = await api.localServerStop();
      setSrv((s) => ({ ...s, running: r.running }));
    } catch (e) {
      setFsErr(String(e));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="topbar">
        <div className="topbar-title">
          <h2>Local control</h2>
          <span>Files &amp; shell on THIS machine</span>
        </div>
        <div className="topbar-actions" style={{ gap: 6 }}>
          {srv.running ? (
            <button className="btn primary" onClick={stopServer}>Server ON :{srv.port} · Stop</button>
          ) : (
            <>
              <input
                type="password"
                value={srvToken}
                onChange={(e) => setSrvToken(e.target.value)}
                placeholder="server token"
                style={{ minWidth: 110 }}
              />
              <button className="btn" onClick={startServer}>Enable agent control server</button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* ---- Files pane ---- */}
        <div style={{ width: "42%", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid var(--border-soft)" }}>
            <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }} onClick={() => ls("/")}>/</button>
            <button className="btn" style={{ fontSize: 11, padding: "4px 9px" }} onClick={() => ls(cwd.split("/").slice(0, -1).join("/") || "/")}>↑ up</button>
            <span style={{ fontSize: 12, fontFamily: "var(--mono)", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cwd}</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
            {fsErr && <div className="banner error">⚠ {fsErr}</div>}
            {entries.map((e) => (
              <div
                key={e.name}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 7,
                  cursor: "pointer", fontSize: 13,
                }}
                onClick={() => (e.isDir ? ls(`${cwd === "/" ? "" : cwd}/${e.name}`) : openFile(`${cwd === "/" ? "" : cwd}/${e.name}`))}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--bg-elev)")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                <span>{e.isDir ? "📁" : e.isFile ? "📄" : "🔗"}</span>
                <span style={{ color: e.isDir ? "var(--text)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Right: editor / terminal ---- */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          {editPath !== null ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ padding: "8px 14px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--accent)", borderBottom: "1px solid var(--border-soft)" }}>
                {editPath}
                <span style={{ float: "right", display: "flex", gap: 6 }}>
                  <button className="btn" style={{ fontSize: 11, padding: "3px 9px" }} onClick={saveFile}>Save</button>
                  <button className="btn" style={{ fontSize: 11, padding: "3px 9px" }} onClick={() => setEditPath(null)}>Close</button>
                </span>
              </div>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                spellCheck={false}
                style={{ flex: 1, background: "var(--bg)", color: "var(--text)", border: "none", outline: "none", fontFamily: "var(--mono)", fontSize: 12.5, padding: 12, resize: "none" }}
              />
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div style={{ padding: "8px 14px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--faint)", fontWeight: 700 }}>
                Terminal <span style={{ color: "var(--text-faint)", textTransform: "none" }}>(cwd: {termCwd})</span>
              </div>
              <pre
                style={{ flex: 1, margin: 0, overflowY: "auto", padding: "6px 14px", background: "var(--bg)", fontFamily: "var(--mono)", fontSize: 12.5, color: "var(--text-dim)", whiteSpace: "pre-wrap" }}
              >
                {term || "pa-desktop local shell — type a command below"}
                <div ref={termEnd} />
              </pre>
              <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-soft)" }}>
                <span style={{ color: "var(--green)", fontFamily: "var(--mono)", fontSize: 13 }}>$</span>
                <input
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && run()}
                  placeholder="e.g. ls -la, pwd, whoami, cd .., git status…"
                  disabled={running}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "var(--mono)", fontSize: 13 }}
                />
                <button className="send-btn" onClick={run} disabled={running || !cmd.trim()}>→</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
