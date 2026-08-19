import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as memory from "./memory.mjs";

const HARNESS_PATH =
  process.env.PA_DESKTOP_HARNESS ||
  "/home/ubuntu/prime-agent/packages/coding-agent/dist/index.js";
const { DaemonClient, defaultDaemonSocketPath } = await import(HARNESS_PATH);

// ---------- config ----------
const HOST = process.env.HOST || detectHost();
const PORT = Number(process.env.PORT || 8788);
const TOKEN = process.env.PA_DESKTOP_TOKEN || ""; // empty => tailnet-only trust
const PROBE_SESSION_NAME = process.env.PA_DESKTOP_PROBE || "pa-desktop-probe";

function detectHost() {
  try {
    return execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" })
      .trim().split("\n")[0];
  } catch { return "127.0.0.1"; }
}

// ---------- daemon client (embedded harness) ----------
let client = null;
async function getClient() {
  if (client && client.isConnected) return client;
  client = new DaemonClient(defaultDaemonSocketPath());
  await client.connect(4000);
  await client.waitForHello(4000);
  return client;
}
async function dreq(cmd, timeoutMs = 120000) {
  const c = await getClient();
  try {
    const r = await c.request(cmd, timeoutMs);
    if (!r.success) throw new Error(`daemon:${cmd.type}: ${r.error}`);
    return r.data;
  } catch (err) {
    if (!c.isConnected || /closed/.test(String(err.message))) {
      client = null;
      const r = await (await getClient()).request(cmd, timeoutMs);
      if (!r.success) throw new Error(`daemon:${cmd.type}: ${r.error}`);
      return r.data;
    }
    throw err;
  }
}

// ---------- helpers ----------
const ok = (res, data) => sendJson(res, 200, { ok: true, ...data });
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS,DELETE",
  });
  res.end(body);
}
function bad(res, msg) { sendJson(res, 400, { ok: false, error: msg }); }
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function authOk(req) {
  if (!TOKEN) return true;
  const h = req.headers.authorization || "";
  return h === `Bearer ${TOKEN}` || h === `Token ${TOKEN}`;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 8_000_000) { d = ""; reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// ---------- message normalization (drop thinking blocks) ----------
function blockText(b) {
  if (!b) return "";
  if (typeof b.text === "string") return b.text;
  if (typeof b.thinking === "string") return "";
  if (b.type === "toolCall") {
    // arguments is an object -> show it as a compact tool summary
    return b.arguments && typeof b.arguments === "object"
      ? `${b.name || "tool"}(${Object.keys(b.arguments).join(", ")})`
      : String(b.arguments ?? "");
  }
  return "";
}
function normalizeMessages(messages) {
  return (messages || []).map((m) => {
    const content = m.content;
    if (typeof content === "string") return { role: m.role, text: content, timestamp: m.timestamp };
    const blocks = Array.isArray(content) ? content : [];
    const text = blocks.filter((b) => b && b.type !== "thinking" && b.type !== "image")
      .map(blockText).filter(Boolean).join("\n");
    const thinking = blocks.filter((b) => b && b.type === "thinking")
      .map((b) => b.thinking ?? b.text ?? "").join("\n");
    const tools = blocks.filter((b) => b && b.type === "toolCall");
    return {
      role: m.role,
      text,
      thinking: thinking || undefined,
      tools: tools.map((t) => ({ name: t.name, arguments: t.arguments })),
      timestamp: m.timestamp,
    };
  });
}

// ---------- routing ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  const p = url.pathname;
  try {
    if (req.method === "OPTIONS") return sendJson(res, 204, {});
    if (!authOk(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });

    // ---- root: full chat app (plain HTML served fresh per request) ----
    if (req.method === "GET" && p === "/") {
      const html = readFileSync(new URL("./web/chat.html", import.meta.url), "utf8");
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return;
    }

    // ---- status / capabilities ----
    if (req.method === "GET" && p === "/api/capabilities") {
      return ok(res, {
        protocol: "1",
        daemon: "prime-agent",
        capabilities: [
          "list", "create", "attach", "prompt_and_wait", "get_messages",
          "set_model", "get_model_catalog", "set_thinking_level",
          "set_service_tier", "set_transport", "set_steering_mode",
          "set_follow_up_mode", "set_auto_compaction", "set_auto_retry",
          "set_rlm_max_depth", "get_state", "abort", "set_session_name",
          "heartbeat", "cron", "kill", "get_queue",
        ],
        thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        serviceTiers: ["auto", "default", "flex", "scale", "priority", null],
        transports: ["sse", "websocket", "http", "stdio", "acp"],
        queueModes: ["all", "one-at-a-time"],
      });
    }

    // ---- agents list ----
    if (req.method === "GET" && p === "/api/agents") {
      const d = await dreq({ type: "list", all: true, includeClientOwned: true }, 30000);
      const sessions = d?.sessions || [];
      return ok(res, {
        agents: sessions.map((s) => ({
          id: s.activeSessionId ?? s.id,
          name: s.name || "",
          model: s.model?.name || s.model?.id || "",
          status: s.status ?? s.activity ?? "",
          messages: s.messageCount ?? 0,
        })),
      });
    }

    // ---- new session ----
    if (req.method === "POST" && p === "/api/new-session") {
      await dreq({ type: "create" }, 30000);
      const d = await dreq({ type: "list", all: true, includeClientOwned: true }, 30000);
      const sessions = d?.sessions || [];
      return ok(res, {
        agents: sessions.map((s) => ({
          id: s.activeSessionId ?? s.id, name: s.name || "",
          model: s.model?.name || s.model?.id || "",
          status: s.status ?? s.activity ?? "", messages: s.messageCount ?? 0,
        })),
      });
    }

    // ---- messages for an agent ----
    if (req.method === "GET" && p === "/api/messages") {
      const agent = url.searchParams.get("agent");
      if (!agent) return bad(res, "agent required");
      const d = await dreq({ type: "get_messages", activeSessionId: agent }, 30000);
      return ok(res, { messages: normalizeMessages(d?.messages) });
    }

    // ---- agent state (model, thinking, tier, transport, modes, toggles) ----
    if (req.method === "GET" && p === "/api/state") {
      const agent = url.searchParams.get("agent");
      if (!agent) return bad(res, "agent required");
      const d = await dreq({ type: "get_state", activeSessionId: agent }, 30000);
      return ok(res, { state: d });
    }

    // ---- set commands (unified) ----
    if (req.method === "POST" && p === "/api/set") {
      const body = await readBody(req);
      if (!body.agent) return bad(res, "agent required");
      const a = body.agent;
      let data;
      switch (body.key) {
        case "model":
          data = await dreq({ type: "set_model", activeSessionId: a, provider: body.provider, modelId: body.modelId }, 30000);
          break;
        case "thinking":
          data = await dreq({ type: "set_thinking_level", activeSessionId: a, level: body.value }, 30000);
          break;
        case "serviceTier":
          data = await dreq({ type: "set_service_tier", activeSessionId: a, serviceTier: body.value }, 30000);
          break;
        case "transport":
          data = await dreq({ type: "set_transport", activeSessionId: a, transport: body.value }, 30000);
          break;
        case "steeringMode":
          data = await dreq({ type: "set_steering_mode", activeSessionId: a, mode: body.value }, 30000);
          break;
        case "followUpMode":
          data = await dreq({ type: "set_follow_up_mode", activeSessionId: a, mode: body.value }, 30000);
          break;
        case "autoCompaction":
          data = await dreq({ type: "set_auto_compaction", activeSessionId: a, enabled: !!body.value }, 30000);
          break;
        case "autoRetry":
          data = await dreq({ type: "set_auto_retry", activeSessionId: a, enabled: !!body.value }, 30000);
          break;
        case "rlmMaxDepth":
          data = await dreq({ type: "set_rlm_max_depth", activeSessionId: a, maxDepth: Number(body.value), global: !!body.global }, 30000);
          break;
        case "sessionName":
          data = await dreq({ type: "set_session_name", activeSessionId: a, name: body.value }, 30000);
          break;
        case "abort":
          data = await dreq({ type: "abort", activeSessionId: a }, 30000);
          break;
        case "kill":
          data = await dreq({ type: "kill", activeSessionId: a }, 30000);
          break;
        default:
          return bad(res, `unknown set key: ${body.key}`);
      }
      return ok(res, { data });
    }

    // ---- model catalog ----
    if (req.method === "GET" && p === "/api/models") {
      const agent = url.searchParams.get("agent");
      if (!agent) return bad(res, "agent required");
      try {
        const d = await dreq({ type: "get_model_catalog", activeSessionId: agent }, 60000);
        return ok(res, { catalog: d });
      } catch (e) {
        const d2 = await dreq({ type: "get_available_models", activeSessionId: agent }, 60000);
        return ok(res, { catalog: d2 });
      }
    }

    // ---- queue ----
    if (req.method === "GET" && p === "/api/queue") {
      const agent = url.searchParams.get("agent");
      if (!agent) return bad(res, "agent required");
      const d = await dreq({ type: "get_queue", activeSessionId: agent }, 30000);
      return ok(res, { queue: d });
    }

    // ---- chat (prompt_and_wait, then stream transcript via SSE) ----
    if (req.method === "POST" && (p === "/api/chat" || p === "/api/chat-stream")) {
      const body = await readBody(req);
      if (!body.agent) return bad(res, "agent required");
      if (!body.message) return bad(res, "message required");
      const streaming = p === "/api/chat-stream";
      const before = await dreq({ type: "get_messages", activeSessionId: body.agent }, 30000);
      const beforeCount = before?.messages?.length ?? 0;

      if (streaming) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*",
          "X-Accel-Buffering": "no",
        });
        sse(res, "start", {});
        const run = async () => {
          // Keepalive: prompt_and_wait blocks for minutes with no SSE output,
          // and mobile proxies/browsers drop idle connections -> "Load failed".
          // Emit a comment heartbeat so the socket stays alive.
          const heartbeat = setInterval(() => {
            try { res.write(": ping\n\n"); } catch {}
          }, 10000);
          // Live activity: poll get_messages during the wait and stream the full
          // running tail (messages since the user's prompt) as it grows, so the
          // UI shows the agent working instead of dots. Sending the whole tail
          // each time is idempotent for the frontend (replace, not append).
          const poller = setInterval(async () => {
            try {
              const live = await dreq({ type: "get_messages", activeSessionId: body.agent }, 30000);
              const all = normalizeMessages(live?.messages) || [];
              if (all.length > beforeCount) {
                sse(res, "messages", { messages: all.slice(beforeCount) });
              }
            } catch {}
          }, 1200);
          try {
            await dreq({
              type: "prompt_and_wait", activeSessionId: body.agent,
              message: body.message, queueIfBusy: true, streamingBehavior: "followUp",
            }, 600000);
            clearInterval(poller);
            const after = await dreq({ type: "get_messages", activeSessionId: body.agent }, 30000);
            const newMsgs = normalizeMessages(after?.messages).slice(beforeCount);
            sse(res, "messages", { messages: newMsgs });
            sse(res, "done", {});
          } finally {
            clearInterval(heartbeat);
            clearInterval(poller);
          }
          res.end();
        };
        run().catch((e) => { sse(res, "error", { error: String(e.message) }); res.end(); });
        return;
      }

      await dreq({
        type: "prompt_and_wait", activeSessionId: body.agent,
        message: body.message, queueIfBusy: true, streamingBehavior: "followUp",
      }, 600000);
      const after = await dreq({ type: "get_messages", activeSessionId: body.agent }, 30000);
      const newMsgs = normalizeMessages(after?.messages).slice(beforeCount);
      return ok(res, { messages: newMsgs });
    }

    // ---- rename ----
    if (req.method === "POST" && p === "/api/rename") {
      const body = await readBody(req);
      if (!body.agent || body.name == null) return bad(res, "agent+name required");
      const d = await dreq({ type: "rename", activeSessionId: body.agent, name: body.name }, 30000);
      return ok(res, { data: d });
    }

    // ---- heartbeat ----
    if (req.method === "POST" && p === "/api/heartbeat") {
      const body = await readBody(req);
      if (!body.agent) return bad(res, "agent required");
      const d = await dreq({
        type: "heartbeat_set", activeSessionId: body.agent,
        schedule: body.schedule || "0 9 * * *", prompt: body.prompt || "",
        deliveryMode: body.deliveryMode || "telegram",
        promoteOwnedSession: !!body.promote,
      }, 30000);
      return ok(res, { data: d });
    }

    // ---- GET /api/heartbeats ----
    if (req.method === "GET" && p === "/api/heartbeats") {
      const d = await dreq({ type: "heartbeats_list" }, 30000);
      return ok(res, { heartbeats: d?.heartbeats ?? d });
    }

    // ---- memory: snapshot / read ----
    if (req.method === "GET" && p === "/api/memory") {
      return ok(res, memory.snapshot());
    }

    // ---- memory: append fact ----
    if (req.method === "POST" && p === "/api/memory/append") {
      const body = await readBody(req);
      if (!body.fact) return bad(res, "fact required");
      const line = memory.appendMemory(body.fact);
      return ok(res, { line });
    }

    // ---- memory: overwrite full MEMORY.md ----
    if (req.method === "POST" && p === "/api/memory/write") {
      const body = await readBody(req);
      if (body.text == null) return bad(res, "text required");
      memory.writeMemory(body.text);
      return ok(res, { ok: true });
    }

    // ---- skills: list ----
    if (req.method === "GET" && p === "/api/skills") {
      return ok(res, { skills: memory.listSkills() });
    }

    // ---- skills: save ----
    if (req.method === "POST" && p === "/api/skills/save") {
      const body = await readBody(req);
      if (!body.name) return bad(res, "name required");
      const r = memory.saveSkill(body.name, body.description || "", body.content || "");
      return ok(res, r);
    }

    // ---- skills: delete ----
    if (req.method === "POST" && p === "/api/skills/delete") {
      const body = await readBody(req);
      if (!body.name) return bad(res, "name required");
      return ok(res, { deleted: memory.deleteSkill(body.name) });
    }

    return sendJson(res, 404, { ok: false, error: `no route ${req.method} ${p}` });
  } catch (e) {
    console.error(`[bridge:${p}]`, e);
    if (!res.headersSent) return sendJson(res, 500, { ok: false, error: String(e.message || e) });
    try { sse(res, "error", { error: String(e.message || e) }); res.end(); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  memory.ensureBootstrap();
  console.log(`pa-desktop bridge listening on http://${HOST}:${PORT}`);
  console.log(`  harness: ${process.env.PA_DESKTOP_HARNESS || "default (~/prime-agent)"}`);
  console.log(`  auth: ${TOKEN ? "token-protected" : "tailnet-only (no token)"}`);
});

process.on("SIGTERM", () => { client?.close?.(); process.exit(0); });
process.on("SIGINT", () => { client?.close?.(); process.exit(0); });
