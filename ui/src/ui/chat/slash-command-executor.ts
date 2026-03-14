/**
 * Client-side execution engine for slash commands.
 * Calls gateway RPC methods and returns formatted results.
 */

import type { ModelCatalogEntry } from "../../../../src/agents/model-catalog.js";
import { resolveThinkingDefault } from "../../../../src/agents/model-selection.js";
import {
  formatThinkingLevels,
  normalizeThinkLevel,
  normalizeVerboseLevel,
} from "../../../../src/auto-reply/thinking.js";
import type { HealthSummary } from "../../../../src/commands/health.js";
import type { OpenClawConfig } from "../../../../src/config/config.js";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_MAIN_KEY,
  isSubagentSessionKey,
  parseAgentSessionKey,
} from "../../../../src/routing/session-key.js";
import {
  formatEnglishOptions,
  localizeFastModeLabel,
  localizeThinkingLevelLabel,
  localizeVerboseLevelLabel,
} from "../../../../src/shared/system-command-display.js";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { AgentsListResult, GatewaySessionRow, SessionsListResult } from "../types.ts";
import { SLASH_COMMANDS } from "./slash-commands.ts";

function localizeThinkingOptions(provider?: string, model?: string): string {
  return formatEnglishOptions(formatThinkingLevels(provider, model));
}

export type SlashCommandResult = {
  /** Markdown-formatted result to display in chat. */
  content: string;
  /** Side-effect action the caller should perform after displaying the result. */
  action?:
    | "refresh"
    | "export"
    | "new-session"
    | "reset"
    | "stop"
    | "clear"
    | "toggle-focus"
    | "navigate-usage";
};

export async function executeSlashCommand(
  client: GatewayBrowserClient,
  sessionKey: string,
  commandName: string,
  args: string,
): Promise<SlashCommandResult> {
  switch (commandName) {
    case "help":
      return executeHelp();
    case "status":
      return await executeStatus(client);
    case "new":
      return { content: "🦞 正在开始新会话", action: "new-session" };
    case "reset":
      return { content: "🦞 正在重置当前会话", action: "reset" };
    case "stop":
      return { content: "🦞 正在中断当前任务", action: "stop" };
    case "clear":
      return { content: "🦞 聊天记录已清空", action: "clear" };
    case "focus":
      return { content: "🦞 已切换专注模式", action: "toggle-focus" };
    case "compact":
      return await executeCompact(client, sessionKey);
    case "model":
      return await executeModel(client, sessionKey, args);
    case "think":
      return await executeThink(client, sessionKey, args);
    case "fast":
      return await executeFast(client, sessionKey, args);
    case "verbose":
      return await executeVerbose(client, sessionKey, args);
    case "export":
      return { content: "🦞 正在导出会话", action: "export" };
    case "usage":
      return await executeUsage(client, sessionKey);
    case "agents":
      return await executeAgents(client);
    case "kill":
      return await executeKill(client, sessionKey, args);
    default:
      return { content: `🦞 未知命令 \`/${commandName}\`` };
  }
}

// ── Command Implementations ──

function executeHelp(): SlashCommandResult {
  const lines = ["🦞 **可用命令**\n"];
  let currentCategory = "";

  for (const cmd of SLASH_COMMANDS) {
    const cat = cmd.category ?? "session";
    if (cat !== currentCategory) {
      currentCategory = cat;
      lines.push(`**${localizeCategory(cat)}**`);
    }
    const argStr = cmd.args ? ` ${cmd.args}` : "";
    const local = cmd.executeLocal ? "" : " 代理执行";
    lines.push(`\`/${cmd.name}${argStr}\` ${cmd.description}${local}`);
  }

  lines.push("\n输入 `/` 可打开命令菜单");
  return { content: lines.join("\n") };
}

async function executeStatus(client: GatewayBrowserClient): Promise<SlashCommandResult> {
  try {
    const health = await client.request<HealthSummary>("health", {});
    const status = health.ok ? "正常" : "降级";
    const agentCount = health.agents?.length ?? 0;
    const sessionCount = health.sessions?.count ?? 0;
    const lines = [
      `🦞 **系统状态** ${status}`,
      `**代理数量** ${agentCount}`,
      `**会话数量** ${sessionCount}`,
      `**默认代理** ${health.defaultAgentId || "未设置"}`,
    ];
    if (health.durationMs) {
      lines.push(`**响应时间** ${health.durationMs}ms`);
    }
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: `🦞 获取系统状态失败 ${String(err)}` };
  }
}

async function executeCompact(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SlashCommandResult> {
  try {
    await client.request("sessions.compact", { key: sessionKey });
    return { content: "🦞 上下文压缩完成", action: "refresh" };
  } catch (err) {
    return { content: `🦞 压缩上下文失败 ${String(err)}` };
  }
}

async function executeModel(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  if (!args) {
    try {
      const [sessions, models] = await Promise.all([
        client.request<SessionsListResult>("sessions.list", {}),
        client.request<{ models: ModelCatalogEntry[] }>("models.list", {}),
      ]);
      const session = resolveCurrentSession(sessions, sessionKey);
      const model = session?.model || sessions?.defaults?.model || "默认";
      const available = models?.models?.map((m: ModelCatalogEntry) => m.id) ?? [];
      const lines = [`🦞 **当前模型** \`${model}\``];
      if (available.length > 0) {
        lines.push(
          `**可选模型** ${available
            .slice(0, 10)
            .map((m: string) => `\`${m}\``)
            .join(", ")}${available.length > 10 ? ` +${available.length - 10} 个` : ""}`,
        );
      }
      return { content: lines.join("\n") };
    } catch (err) {
      return { content: `🦞 获取模型信息失败 ${String(err)}` };
    }
  }

  try {
    await client.request("sessions.patch", { key: sessionKey, model: args.trim() });
    return { content: `🦞 模型已切换为 \`${args.trim()}\``, action: "refresh" };
  } catch (err) {
    return { content: `🦞 设置模型失败 ${String(err)}` };
  }
}

async function executeThink(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawLevel = args.trim();
  if (!rawLevel) {
    try {
      const { session, models } = await loadThinkingCommandState(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `🦞 当前思考等级 ${localizeThinkingLevelLabel(resolveCurrentThinkingLevel(session, models))}`,
          localizeThinkingOptions(session?.modelProvider, session?.model),
          "可用等级",
        ),
      };
    } catch (err) {
      return { content: `🦞 获取思考等级失败 ${String(err)}` };
    }
  }

  const level = normalizeThinkLevel(rawLevel);
  if (!level) {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: `🦞 无法识别思考等级“${rawLevel}”\n可用等级 ${localizeThinkingOptions(session?.modelProvider, session?.model)}`,
      };
    } catch (err) {
      return { content: `🦞 校验思考等级失败 ${String(err)}` };
    }
  }

  try {
    await client.request("sessions.patch", { key: sessionKey, thinkingLevel: level });
    return {
      content: `🦞 已将思考等级设为 **${localizeThinkingLevelLabel(level)}**`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `🦞 设置思考等级失败 ${String(err)}` };
  }
}

async function executeVerbose(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawLevel = args.trim();
  if (!rawLevel) {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `🦞 当前详细级别 ${localizeVerboseLevelLabel(normalizeVerboseLevel(session?.verboseLevel) ?? "off")}`,
          formatEnglishOptions(["on", "full", "off"]),
          "可用等级",
        ),
      };
    } catch (err) {
      return { content: `🦞 获取详细级别失败 ${String(err)}` };
    }
  }

  const level = normalizeVerboseLevel(rawLevel);
  if (!level) {
    return {
      content: `🦞 无法识别详细级别“${rawLevel}”\n可用等级 ${formatEnglishOptions(["off", "on", "full"])}`,
    };
  }

  try {
    await client.request("sessions.patch", { key: sessionKey, verboseLevel: level });
    return {
      content: `🦞 已将详细模式设为 **${localizeVerboseLevelLabel(level)}**`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `🦞 设置详细模式失败 ${String(err)}` };
  }
}

async function executeFast(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const rawMode = args.trim().toLowerCase();

  if (!rawMode || rawMode === "status") {
    try {
      const session = await loadCurrentSession(client, sessionKey);
      return {
        content: formatDirectiveOptions(
          `🦞 当前快速模式 ${localizeFastModeLabel(resolveCurrentFastMode(session))}`,
          formatEnglishOptions(["status", "on", "off"]),
          "可用值",
        ),
      };
    } catch (err) {
      return { content: `🦞 获取快速模式失败 ${String(err)}` };
    }
  }

  if (rawMode !== "on" && rawMode !== "off") {
    return {
      content: `🦞 无法识别快速模式“${args.trim()}”\n可用值 ${formatEnglishOptions(["status", "on", "off"])}`,
    };
  }

  try {
    await client.request("sessions.patch", { key: sessionKey, fastMode: rawMode === "on" });
    return {
      content: `🦞 快速模式已${rawMode === "on" ? "开启" : "关闭"}`,
      action: "refresh",
    };
  } catch (err) {
    return { content: `🦞 设置快速模式失败 ${String(err)}` };
  }
}

async function executeUsage(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SlashCommandResult> {
  try {
    const sessions = await client.request<SessionsListResult>("sessions.list", {});
    const session = resolveCurrentSession(sessions, sessionKey);
    if (!session) {
      return { content: "🦞 当前没有活动会话" };
    }
    const input = session.inputTokens ?? 0;
    const output = session.outputTokens ?? 0;
    const total = session.totalTokens ?? input + output;
    const ctx = session.contextTokens ?? 0;
    const pct = ctx > 0 ? Math.round((input / ctx) * 100) : null;

    const lines = [
      "🦞 **会话用量**",
      `输入 **${fmtTokens(input)}** 个令牌`,
      `输出 **${fmtTokens(output)}** 个令牌`,
      `总计 **${fmtTokens(total)}** 个令牌`,
    ];
    if (pct !== null) {
      lines.push(`上下文 **${pct}%** / ${fmtTokens(ctx)}`);
    }
    if (session.model) {
      lines.push(`模型 \`${session.model}\``);
    }
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: `🦞 获取用量失败 ${String(err)}` };
  }
}

async function executeAgents(client: GatewayBrowserClient): Promise<SlashCommandResult> {
  try {
    const result = await client.request<AgentsListResult>("agents.list", {});
    const agents = result?.agents ?? [];
    if (agents.length === 0) {
      return { content: "🦞 当前没有已配置的代理" };
    }
    const lines = [`🦞 **代理列表** ${agents.length}\n`];
    for (const agent of agents) {
      const isDefault = agent.id === result?.defaultId;
      const name = agent.identity?.name || agent.name || agent.id;
      const marker = isDefault ? " 默认" : "";
      lines.push(`- \`${agent.id}\` — ${name}${marker}`);
    }
    return { content: lines.join("\n") };
  } catch (err) {
    return { content: `🦞 获取代理列表失败 ${String(err)}` };
  }
}

async function executeKill(
  client: GatewayBrowserClient,
  sessionKey: string,
  args: string,
): Promise<SlashCommandResult> {
  const target = args.trim();
  if (!target) {
    return { content: "🦞 用法 `/kill <id|all>`" };
  }
  try {
    const sessions = await client.request<SessionsListResult>("sessions.list", {});
    const matched = resolveKillTargets(sessions?.sessions ?? [], sessionKey, target);
    if (matched.length === 0) {
      return {
        content:
          target.toLowerCase() === "all"
            ? "🦞 未找到活动中的子代理会话"
            : `🦞 未找到匹配 \`${target}\` 的子代理会话`,
      };
    }

    const results = await Promise.allSettled(
      matched.map((key) =>
        client.request<{ aborted?: boolean }>("chat.abort", { sessionKey: key }),
      ),
    );
    const rejected = results.filter((entry) => entry.status === "rejected");
    const successCount = results.filter(
      (entry) =>
        entry.status === "fulfilled" && (entry.value as { aborted?: boolean })?.aborted !== false,
    ).length;
    if (successCount === 0) {
      if (rejected.length === 0) {
        return {
          content:
            target.toLowerCase() === "all"
              ? "🦞 没有可中断的活动任务"
              : `🦞 没有匹配 \`${target}\` 的活动任务`,
        };
      }
      throw rejected[0]?.reason ?? new Error("中断请求失败");
    }

    if (target.toLowerCase() === "all") {
      return {
        content:
          successCount === matched.length
            ? `🦞 已中断 ${successCount} 个子代理会话`
            : `🦞 已中断 ${matched.length} 个子代理会话中的 ${successCount} 个`,
      };
    }

    return {
      content:
        successCount === matched.length
          ? `🦞 已中断匹配 \`${target}\` 的 ${successCount} 个子代理会话`
          : `🦞 已中断匹配 \`${target}\` 的 ${matched.length} 个子代理会话中的 ${successCount} 个`,
    };
  } catch (err) {
    return { content: `🦞 中断任务失败 ${String(err)}` };
  }
}

function resolveKillTargets(
  sessions: GatewaySessionRow[],
  currentSessionKey: string,
  target: string,
): string[] {
  const normalizedTarget = target.trim().toLowerCase();
  if (!normalizedTarget) {
    return [];
  }

  const keys = new Set<string>();
  const normalizedCurrentSessionKey = currentSessionKey.trim().toLowerCase();
  const currentParsed = parseAgentSessionKey(normalizedCurrentSessionKey);
  const currentAgentId =
    currentParsed?.agentId ??
    (normalizedCurrentSessionKey === DEFAULT_MAIN_KEY ? DEFAULT_AGENT_ID : undefined);
  const sessionIndex = buildSessionIndex(sessions);
  for (const session of sessions) {
    const key = session?.key?.trim();
    if (!key || !isSubagentSessionKey(key)) {
      continue;
    }
    const normalizedKey = key.toLowerCase();
    const parsed = parseAgentSessionKey(normalizedKey);
    const belongsToCurrentSession = isWithinCurrentSessionSubtree(
      normalizedKey,
      normalizedCurrentSessionKey,
      sessionIndex,
      currentAgentId,
      parsed?.agentId,
    );
    const isMatch =
      (normalizedTarget === "all" && belongsToCurrentSession) ||
      (belongsToCurrentSession && normalizedKey === normalizedTarget) ||
      (belongsToCurrentSession &&
        ((parsed?.agentId ?? "") === normalizedTarget ||
          normalizedKey.endsWith(`:subagent:${normalizedTarget}`) ||
          normalizedKey === `subagent:${normalizedTarget}`));
    if (isMatch) {
      keys.add(key);
    }
  }
  return [...keys];
}

function isWithinCurrentSessionSubtree(
  candidateSessionKey: string,
  currentSessionKey: string,
  sessionIndex: Map<string, GatewaySessionRow>,
  currentAgentId: string | undefined,
  candidateAgentId: string | undefined,
): boolean {
  if (!currentAgentId || candidateAgentId !== currentAgentId) {
    return false;
  }

  const currentAliases = resolveEquivalentSessionKeys(currentSessionKey, currentAgentId);
  const seen = new Set<string>();
  let parentSessionKey = normalizeSessionKey(sessionIndex.get(candidateSessionKey)?.spawnedBy);
  while (parentSessionKey && !seen.has(parentSessionKey)) {
    if (currentAliases.has(parentSessionKey)) {
      return true;
    }
    seen.add(parentSessionKey);
    parentSessionKey = normalizeSessionKey(sessionIndex.get(parentSessionKey)?.spawnedBy);
  }

  // Older gateways may not include spawnedBy on session rows yet; keep prefix
  // matching for nested subagent sessions as a compatibility fallback.
  return isSubagentSessionKey(currentSessionKey)
    ? candidateSessionKey.startsWith(`${currentSessionKey}:subagent:`)
    : false;
}

function buildSessionIndex(sessions: GatewaySessionRow[]): Map<string, GatewaySessionRow> {
  const index = new Map<string, GatewaySessionRow>();
  for (const session of sessions) {
    const normalizedKey = normalizeSessionKey(session?.key);
    if (!normalizedKey) {
      continue;
    }
    index.set(normalizedKey, session);
  }
  return index;
}

function normalizeSessionKey(key?: string | null): string | undefined {
  const normalized = key?.trim().toLowerCase();
  return normalized || undefined;
}

function resolveEquivalentSessionKeys(
  currentSessionKey: string,
  currentAgentId: string | undefined,
): Set<string> {
  const keys = new Set<string>([currentSessionKey]);
  if (currentAgentId === DEFAULT_AGENT_ID) {
    const canonicalDefaultMain = `agent:${DEFAULT_AGENT_ID}:main`;
    if (currentSessionKey === DEFAULT_MAIN_KEY) {
      keys.add(canonicalDefaultMain);
    } else if (currentSessionKey === canonicalDefaultMain) {
      keys.add(DEFAULT_MAIN_KEY);
    }
  }
  return keys;
}

function formatDirectiveOptions(text: string, options: string, label = "可用参数"): string {
  return `${text}\n${label} ${options}`;
}

function localizeCategory(category: string): string {
  switch (category) {
    case "session":
      return "会话";
    case "model":
      return "模型";
    case "tools":
      return "工具";
    case "agents":
      return "代理";
    default:
      return category;
  }
}

async function loadCurrentSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<GatewaySessionRow | undefined> {
  const sessions = await client.request<SessionsListResult>("sessions.list", {});
  return resolveCurrentSession(sessions, sessionKey);
}

function resolveCurrentSession(
  sessions: SessionsListResult | undefined,
  sessionKey: string,
): GatewaySessionRow | undefined {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const currentAgentId =
    parseAgentSessionKey(normalizedSessionKey ?? "")?.agentId ??
    (normalizedSessionKey === DEFAULT_MAIN_KEY ? DEFAULT_AGENT_ID : undefined);
  const aliases = normalizedSessionKey
    ? resolveEquivalentSessionKeys(normalizedSessionKey, currentAgentId)
    : new Set<string>();
  return sessions?.sessions?.find((session: GatewaySessionRow) => {
    const key = normalizeSessionKey(session.key);
    return key ? aliases.has(key) : false;
  });
}

async function loadThinkingCommandState(client: GatewayBrowserClient, sessionKey: string) {
  const [sessions, models] = await Promise.all([
    client.request<SessionsListResult>("sessions.list", {}),
    client.request<{ models: ModelCatalogEntry[] }>("models.list", {}),
  ]);
  return {
    session: resolveCurrentSession(sessions, sessionKey),
    models: models?.models ?? [],
  };
}

function resolveCurrentThinkingLevel(
  session: GatewaySessionRow | undefined,
  models: ModelCatalogEntry[],
): string {
  const persisted = normalizeThinkLevel(session?.thinkingLevel);
  if (persisted) {
    return persisted;
  }
  if (!session?.modelProvider || !session.model) {
    return "off";
  }
  return resolveThinkingDefault({
    cfg: {} as OpenClawConfig,
    provider: session.modelProvider,
    model: session.model,
    catalog: models,
  });
}

function resolveCurrentFastMode(session: GatewaySessionRow | undefined): "on" | "off" {
  return session?.fastMode === true ? "on" : "off";
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}
