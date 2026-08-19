import { invoke } from "@tauri-apps/api/core";

// Thin typed wrapper around the Tauri backend commands (which proxy to the
// pa-desktop bridge -> prime-agent daemon).

export interface Agent {
  id: string;
  name: string;
  model: string;
  status: string;
  messages: number;
}

export interface CatalogModel {
  id: string;
  name?: string;
  provider?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number };
}

export interface Msg {
  role: string;
  text: string;
  thinking?: string;
  tools?: { name: string; arguments?: unknown }[];
  timestamp?: number;
}

export interface SessionState {
  id?: string;
  sessionName?: string;
  model?: { id?: string; name?: string; provider?: string; reasoning?: boolean };
  thinkingLevel?: string;
  serviceTier?: string;
  transport?: string;
  steeringMode?: string;
  followUpMode?: string;
  autoCompaction?: boolean;
  autoRetry?: boolean;
  rlmDepth?: number;
  activity?: string;
  messageCount?: number;
  lifecycle?: string;
  taskState?: string;
}

export interface Capabilities {
  capabilities: string[];
  thinkingLevels: string[];
  serviceTiers: string[];
  transports: string[];
  queueModes: string[];
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export const api = {
  capabilities: () => call<Capabilities>("bridge_capabilities"),
  agents: () => call<{ agents: Agent[] }>("bridge_agents"),
  newSession: () => call<{ agents: Agent[] }>("bridge_new_session"),
  messages: (agent: string) => call<{ messages: Msg[] }>("bridge_messages", { agent }),
  state: (agent: string) => call<{ state: SessionState }>("bridge_state", { agent }),
  models: (agent: string) => call<{ catalog: { models: CatalogModel[] } }>("bridge_models", { agent }),
  set: (agent: string, key: string, value: unknown) =>
    call<{ data?: unknown }>("bridge_set", { agent, key, value }),
  rename: (agent: string, name: string) =>
    call<{ data?: unknown }>("bridge_rename", { agent, name }),
  heartbeat: (agent: string, schedule: string, prompt: string) =>
    call<{ data?: unknown }>("bridge_heartbeat", { agent, schedule, prompt }),
  chat: (agent: string, message: string) =>
    call<{ messages: Msg[] }>("bridge_chat", { agent, message }),
  memoryGet: () => call<{ memory: string; skills: Skill[] }>("memory_get"),
  memoryAppend: (fact: string) => call<{ line?: string }>("memory_append", { fact }),
  memoryWrite: (text: string) => call<{ ok?: boolean }>("memory_write", { text }),
  skillSave: (name: string, description: string, content: string) =>
    call<{ name?: string }>("skill_save", { name, description, content }),
  skillDelete: (name: string) => call<{ deleted?: boolean }>("skill_delete", { name }),
  setConnection: (base: string, token: string) =>
    call<null>("set_connection", { base, token }),
  getConnection: () => call<{ base: string; token: string }>("get_connection"),
};

export interface Skill {
  name: string;
  description: string;
  content: string;
}
