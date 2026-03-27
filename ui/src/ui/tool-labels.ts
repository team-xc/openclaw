import { t } from "../i18n/index.ts";

/**
 * Map raw tool names to human-friendly labels for the chat UI.
 * Unknown tools are title-cased with underscores replaced by spaces.
 */

export const TOOL_LABEL_KEYS: Record<string, string> = {
  exec: "chat.toolNames.runCommand",
  bash: "chat.toolNames.runCommand",
  read: "chat.toolNames.readFile",
  write: "chat.toolNames.writeFile",
  edit: "chat.toolNames.editFile",
  apply_patch: "chat.toolNames.applyPatch",
  web_search: "chat.toolNames.webSearch",
  web_fetch: "chat.toolNames.fetchPage",
  browser: "chat.toolNames.browser",
  message: "chat.toolNames.sendMessage",
  image: "chat.toolNames.generateImage",
  canvas: "chat.toolNames.canvas",
  cron: "chat.toolNames.cron",
  gateway: "chat.toolNames.gateway",
  nodes: "chat.toolNames.nodes",
  memory_search: "chat.toolNames.searchMemory",
  memory_get: "chat.toolNames.getMemory",
  session_status: "chat.toolNames.sessionStatus",
  sessions_list: "chat.toolNames.listSessions",
  sessions_history: "chat.toolNames.sessionHistory",
  sessions_send: "chat.toolNames.sendToSession",
  sessions_spawn: "chat.toolNames.spawnSession",
  agents_list: "chat.toolNames.listAgents",
};

export function friendlyToolName(raw: string): string {
  const key = TOOL_LABEL_KEYS[raw];
  if (key) {
    return t(key);
  }
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
