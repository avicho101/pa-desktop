// memory.mjs — persistent memory + skills store for prime-agent.
// Lives under ~/.prime/agent/memory/:
//   MEMORY.md            long-term facts (agent appends across sessions)
//   skills/<name>/SKILL.md   reusable skills (auto-loaded by prime-agent)
// The pa-memory SKILL.md bootstrap tells every session it has memory.
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";

const agentDir = process.env.PA_AGENT_DIR || join(homedir(), ".prime", "agent");
const MEM_DIR = join(agentDir, "memory");
const MEM_FILE = join(MEM_DIR, "MEMORY.md");
// Daemon scans ~/.prime/agent/skills/ (resource-loader agentRoots). Skills MUST
// live there to auto-inject into the system prompt.
const SKILLS_DIR = join(agentDir, "skills");

function ensure() {
  mkdirSync(MEM_DIR, { recursive: true });
  mkdirSync(SKILLS_DIR, { recursive: true });
  if (!existsSync(MEM_FILE)) {
    writeFileSync(
      MEM_FILE,
      `# Agent Memory\n\nPersistent long-term memory for the pa-desktop / prime-agent assistant.\nThe agent appends durable facts here across sessions (user preferences, project facts, decisions).\n\n`,
      "utf8",
    );
  }
}

// ---- MEMORY.md ----
export function readMemory() {
  ensure();
  return existsSync(MEM_FILE) ? readFileSync(MEM_FILE, "utf8") : "";
}
export function appendMemory(fact, when = new Date().toISOString()) {
  ensure();
  const line = `- [${when}] ${fact.replace(/\n/g, " ")}\n`;
  writeFileSync(MEM_FILE, readMemory() + line, "utf8");
  return line;
}
export function writeMemory(fullText) {
  ensure();
  writeFileSync(MEM_FILE, fullText, "utf8");
}

// ---- skills ----
function slug(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "skill";
}

export function listSkills() {
  ensure();
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(SKILLS_DIR, entry.name);
    const sk = join(skillDir, "SKILL.md");
    if (!existsSync(sk)) continue;
    const text = readFileSync(sk, "utf8");
    const m = text.match(/^---\s*[\s\S]*?^description:\s*(.+)$[\s\S]*?^---/m);
    out.push({ name: entry.name, description: (m && m[1].trim()) || "", content: text });
  }
  return out;
}

export function saveSkill(name, description, content) {
  ensure();
  const s = slug(name);
  const dir = join(SKILLS_DIR, s);
  mkdirSync(dir, { recursive: true });
  const body = content.trim();
  const front =
    /^---\s*[\s\S]*?---/.test(body)
      ? body
      : `---\nname: ${name}\ndescription: ${(description || name).trim()}\n---\n\n${body}`;
  writeFileSync(join(dir, "SKILL.md"), front, "utf8");
  return { name: s, path: join(dir, "SKILL.md") };
}

export function deleteSkill(name) {
  ensure();
  const s = slug(name);
  const dir = join(SKILLS_DIR, s);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ---- bootstrap skill: tells every session it has memory ----
const BOOTSTRAP = `---
name: pa-memory
description: pa-desktop memory. Use to save and recall long-term facts and reusable skills. Call read_memory when you need remembered facts, save_memory to persist important new facts across sessions, and save_skill to store a reusable procedure.
---

# pa-desktop Memory (you have persistent memory)

You have a persistent memory store on this machine. Use it so facts and procedures survive across sessions.

## Where things live
- Long-term memory file: \`${MEM_FILE}\`
- Skills: \`${SKILLS_DIR}/<name>/SKILL.md\` (a reusable procedure, marked up with frontmatter:
  \`name\`, \`description\`; body is the procedure).

## Rules
1. At the start of a task, if relevant facts may already be known, read \`${MEM_FILE}\` and apply what you find.
2. When you learn a durable fact (a user preference, a decision, a project fact, an environment detail that will matter later), APPEND it to \`${MEM_FILE}\` as a bullet: \`- [date] fact\`. Do not duplicate an existing fact.
3. When you discover a reusable procedure (a non-trivial multi-step way of doing something), save it as a skill under \`${SKILLS_DIR}/\` so it can be reused.
4. Keep memory concise and high-signal. Prefer updating over accumulating clutter.
5. Tools: use your normal file tools (read/write/bash) on these paths — they are plain markdown files.
`;

export function ensureBootstrap() {
  ensure();
  const dir = join(SKILLS_DIR, "pa-memory");
  mkdirSync(dir, { recursive: true });
  const sk = join(dir, "SKILL.md");
  const cur = existsSync(sk) ? readFileSync(sk, "utf8") : "";
  if (!cur.includes("pa-desktop Memory")) {
    writeFileSync(sk, BOOTSTRAP, "utf8");
  }
}

// ---- snapshot for the UI ----
export function snapshot() {
  ensure();
  return {
    memoryFile: MEM_FILE,
    memory: readMemory(),
    skills: listSkills(),
  };
}
