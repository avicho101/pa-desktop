import { useEffect, useState } from "react";

export interface ActivityItem {
  type: "tool" | "thinking" | "text";
  name?: string; // tool name
  args?: string; // tool arg summary
  text?: string; // thinking or text content
}

/**
 * Collapsible streaming activity box — the modern desktop-agent pattern
 * (Claude Desktop / Cursor / Codex): a slim header row with a spinner, the
 * current operation, and a chevron; expands to stream each tool call / thinking
 * block live; collapses to a single line. Pinned above the composer while a
 * run is in flight, then stays (collapsed) with the tool trail for the run.
 */
export default function ActivityPanel({
  items,
  showThinking = true,
  done = false,
  collapsed: initialCollapsed,
}: {
  items: ActivityItem[];
  showThinking?: boolean;
  done?: boolean;
  collapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(
    initialCollapsed ?? (localStorage.getItem("pa_activity_collapsed") === "1")
  );

  useEffect(() => {
    localStorage.setItem("pa_activity_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Auto-expand when a run starts (new tools streaming), unless user collapsed
  useEffect(() => {
    if (localStorage.getItem("pa_activity_collapsed") === "1") return;
    if (items.some((i) => i.type === "tool")) setCollapsed(false);
  }, [items]);

  // Auto-collapse when the run finishes so it doesn't crowd the chat
  useEffect(() => {
    if (done) setCollapsed(true);
  }, [done]);

  const lastTool = [...items].reverse().find((i) => i.type === "tool");
  const toolCount = items.filter((i) => i.type === "tool").length;

  return (
    <div className={`activity ${collapsed ? "collapsed" : ""}`}>
      <div className="activity-head" onClick={() => setCollapsed((c) => !c)}>
        <span className={done ? "activity-dot" : "spinner"} />
        <span className="activity-label">
          {toolCount > 0
            ? `${lastTool?.name ?? "Working"}${collapsed && toolCount > 1 ? ` · +${toolCount - 1} more` : ""}`
            : done
            ? "Completed"
            : "Working…"}
        </span>
        <span className="activity-chev">{collapsed ? "▸" : "▾"}</span>
      </div>
      {!collapsed && items.length > 0 && (
        <div className="activity-body">
          {items.map((it, i) => {
            if (it.type === "tool") {
              return (
                <div className="activity-tool" key={i}>
                  <span className="activity-gear">⚙</span>
                  <span className="activity-tool-name">{it.name}</span>
                  {it.args && <span className="activity-args">{it.args}</span>}
                </div>
              );
            }
            if (showThinking && it.type === "thinking" && it.text) {
              return (
                <div className="activity-thinking" key={i}>
                  🧠 {it.text}
                </div>
              );
            }
            return null;
          })}
        </div>
      )}
    </div>
  );
}
