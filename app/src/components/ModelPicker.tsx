import { useEffect, useMemo, useState } from "react";
import { api, Agent, CatalogModel } from "../api";

interface Props {
  agent: Agent;
  onClose: () => void;
  onChanged: () => void;
}

export default function ModelPicker({ agent, onClose, onChanged }: Props) {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [current, setCurrent] = useState<string>(agent.model || "");
  const [applying, setApplying] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .models(agent.id)
      .then((r) => {
        if (alive) setModels(r.catalog?.models ?? []);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [agent.id]);

  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const map = new Map<string, CatalogModel[]>();
    for (const m of models) {
      if (q && !`${m.name} ${m.id} ${m.provider}`.toLowerCase().includes(q)) continue;
      const prov = m.provider || m.api || "models";
      if (!map.has(prov)) map.set(prov, []);
      map.get(prov)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, search]);

  async function apply(m: CatalogModel) {
    setApplying(true);
    setErr(null);
    try {
      await api.set(agent.id, "model", {
        provider: m.provider || m.api || "openrouter",
        modelId: m.id,
      });
      setCurrent(m.name || m.id);
      onChanged();
    } catch (e) {
      setErr(String(e));
    } finally {
      setApplying(false);
    }
  }

  function fmtCtx(m: CatalogModel) {
    const cw = m.contextWindow;
    if (!cw) return null;
    if (cw >= 1_000_000) return `${(cw / 1_000_000).toFixed(0)}M`;
    if (cw >= 1000) return `${Math.round(cw / 1000)}k`;
    return String(cw);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Choose model</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <input
            className="search-box"
            placeholder="Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {err && <div className="banner error">⚠ {err}</div>}
          {loading && <div className="center-pad"><span className="spinner" /> Loading models…</div>}
          {!loading && grouped.length === 0 && (
            <div className="empty-models">No models available for this session.</div>
          )}
          {grouped.map(([prov, list]) => (
            <div className="model-group" key={prov}>
              <div className="model-group-label">{prov}</div>
              {list.map((m) => {
                const sel = current === (m.name || m.id) || (m.id && current.includes(m.id));
                return (
                  <div
                    key={m.id + prov}
                    className={`model-item ${sel ? "selected" : ""}`}
                    onClick={() => !applying && apply(m)}
                  >
                    <div className="model-item-info">
                      <div className="model-item-name">{m.name || m.id}</div>
                      <div className="model-item-meta">
                        {m.reasoning && <span className="badge reasoning">reasoning</span>}
                        {(m.cost?.input === 0 && m.cost?.output === 0) || m.id.includes(":free") ? (
                          <span className="badge free">free</span>
                        ) : (
                          m.cost?.input != null && (
                            <span className="badge ctx">
                              ${m.cost.input.toFixed(2)}/1M in
                            </span>
                          )
                        )}
                        {m.input?.length ? (
                          <span className="badge ctx">{m.input.join("/")}</span>
                        ) : null}
                        {fmtCtx(m) && <span className="badge ctx">{fmtCtx(m)} ctx</span>}
                      </div>
                    </div>
                    {sel ? <span className="checkmark">✓</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ height: 8 }} />
          <button className="btn" style={{ width: "100%" }} onClick={onClose} disabled={applying}>
            {applying ? "Applying…" : "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
