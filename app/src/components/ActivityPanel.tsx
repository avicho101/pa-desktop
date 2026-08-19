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
 * run is in flight.
 */
export default function ActivityPanel({
  items,
  collapsed: initialCollapsed,
}: {
  items: ActivityItem[];
  collapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(
    initialCollapsed ?? (localStorage.getItem("pa_activity_collapsed") === "1")
  );

  useEffect(() => {
    localStorage.setItem("pa_activity_collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

  // Auto-expand when a new tool starts if the user hasn't explicitly collapsed
  useEffect(() => {
    if (localStorage.getItem("pa_activity_collapsed") === "1") return;
    if (items.some((i) => i.type === "tool")) setCollapsed(false);
  }, [items]);

  const lastTool = [...items].reverse().find((i) => i.type === "tool");
  const toolCount = items.filter((i) => i.type === "tool").length;

  return (
    <div className={`activity ${collapsed ? "collapsed" : ""}`}>
      <div className="activity-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="spinner" />
        <span className="activity-label">
          {toolCount > 0
            ? `${lastTool?.name ?? "Working"}${collapsed && toolCount > 1 ? ` · +${toolCount - 1} more` : ""}`
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
            if (it.type === "thinking" && it.text) {
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
