import fs from "node:fs";
import { resolveContextTokensForModel } from "../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveModelAuthMode } from "../agents/model-auth.js";
import {
  buildModelAliasIndex,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "../agents/model-selection.js";
import { resolveSandboxRuntimeStatus } from "../agents/sandbox.js";
import type { SkillCommandSpec } from "../agents/skills.js";
import { derivePromptTokens, normalizeUsage, type UsageLike } from "../agents/usage.js";
import { resolveChannelModelOverride } from "../channels/model-overrides.js";
import { isCommandFlagEnabled } from "../config/commands.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  resolveMainSessionKey,
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
  type SessionEntry,
  type SessionScope,
} from "../config/sessions.js";
import { resolveCommitHash } from "../infra/git-commit.js";
import type { MediaUnderstandingDecision } from "../media-understanding/types.js";
import { listPluginCommands } from "../plugins/commands.js";
import { resolveAgentIdFromSessionKey } from "../routing/session-key.js";
import {
  localizeGroupActivation,
  localizeQueueDropLabel,
  localizeQueueModeLabel,
  localizeRuntimeLabel,
  localizeThinkingLevelLabel,
  localizeToggleValue,
} from "../shared/system-command-display.js";
import {
  getTtsMaxLength,
  getTtsProvider,
  isSummarizationEnabled,
  resolveTtsAutoMode,
  resolveTtsConfig,
  resolveTtsPrefsPath,
} from "../tts/tts.js";
import {
  estimateUsageCost,
  formatTokenCount as formatTokenCountShared,
  formatUsd,
  resolveModelCostConfig,
} from "../utils/usage-format.js";
import { VERSION } from "../version.js";
import {
  listChatCommands,
  listChatCommandsForConfig,
  type ChatCommandDefinition,
} from "./commands-registry.js";
import type { CommandCategory } from "./commands-registry.types.js";
import { resolveActiveFallbackState } from "./fallback-state.js";
import { formatProviderModelRef, resolveSelectedAndActiveModel } from "./model-runtime.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel, VerboseLevel } from "./thinking.js";

type AgentDefaults = NonNullable<NonNullable<OpenClawConfig["agents"]>["defaults"]>;
type AgentConfig = Partial<AgentDefaults> & {
  model?: AgentDefaults["model"] | string;
};

export const formatTokenCount = formatTokenCountShared;

type QueueStatus = {
  mode?: string;
  depth?: number;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: string;
  showDetails?: boolean;
};

type StatusArgs = {
  config?: OpenClawConfig;
  agent: AgentConfig;
  agentId?: string;
  sessionEntry?: SessionEntry;
  sessionKey?: string;
  parentSessionKey?: string;
  sessionScope?: SessionScope;
  sessionStorePath?: string;
  groupActivation?: "mention" | "always";
  resolvedThink?: ThinkLevel;
  resolvedFast?: boolean;
  resolvedVerbose?: VerboseLevel;
  resolvedReasoning?: ReasoningLevel;
  resolvedElevated?: ElevatedLevel;
  modelAuth?: string;
  activeModelAuth?: string;
  usageLine?: string;
  timeLine?: string;
  queue?: QueueStatus;
  mediaDecisions?: ReadonlyArray<MediaUnderstandingDecision>;
  subagentsLine?: string;
  includeTranscriptUsage?: boolean;
  now?: number;
};

type NormalizedAuthMode = "api-key" | "oauth" | "token" | "aws-sdk" | "mixed" | "unknown";

function normalizeAuthMode(value?: string): NormalizedAuthMode | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "api-key" || normalized.startsWith("api-key ")) {
    return "api-key";
  }
  if (normalized === "oauth" || normalized.startsWith("oauth ")) {
    return "oauth";
  }
  if (normalized === "token" || normalized.startsWith("token ")) {
    return "token";
  }
  if (normalized === "aws-sdk" || normalized.startsWith("aws-sdk ")) {
    return "aws-sdk";
  }
  if (normalized === "mixed" || normalized.startsWith("mixed ")) {
    return "mixed";
  }
  if (normalized === "unknown") {
    return "unknown";
  }
  return undefined;
}

function localizeAuthLabel(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = normalizeAuthMode(trimmed);
  const label = (() => {
    switch (normalized) {
      case "api-key":
        return "密钥";
      case "oauth":
        return "OAuth";
      case "token":
        return "令牌";
      case "aws-sdk":
        return "AWS SDK";
      case "mixed":
        return "混合";
      case "unknown":
        return "未知";
      default:
        return undefined;
    }
  })();
  if (!label) {
    return trimmed;
  }
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return label;
  }
  return `${label}${trimmed.slice(spaceIndex)}`;
}

function localizeFallbackReason(reason?: string): string | undefined {
  const trimmed = reason?.trim();
  if (!trimmed) {
    return undefined;
  }
  const moreAttemptsMatch = trimmed.match(/^(.*)\s+\(\+(\d+)\s+more attempts\)$/i);
  const baseReason = (moreAttemptsMatch?.[1] ?? trimmed).trim();
  const localizedBase = (() => {
    switch (baseReason.toLowerCase()) {
      case "selected model unavailable":
        return "所选模型不可用";
      case "rate limit":
        return "速率限制";
      case "quota exceeded":
        return "超出配额";
      case "unauthorized":
        return "未授权";
      case "forbidden":
        return "已拒绝";
      case "not found":
        return "未找到";
      case "timeout":
        return "超时";
      case "service unavailable":
        return "服务不可用";
      case "bad gateway":
        return "网关错误";
      case "gateway timeout":
        return "网关超时";
      case "payment required":
        return "需要付费";
      case "context overflow":
        return "上下文超限";
      case "model overloaded":
        return "模型过载";
      case "internal server error":
        return "内部服务错误";
      case "error":
        return "错误";
      default:
        return baseReason;
    }
  })();
  if (!moreAttemptsMatch) {
    return localizedBase;
  }
  return `${localizedBase} 另有 ${moreAttemptsMatch[2]} 次尝试`;
}

function resolveRuntimeLabel(
  args: Pick<StatusArgs, "config" | "agent" | "sessionKey" | "sessionScope">,
): string {
  const sessionKey = args.sessionKey?.trim();
  if (args.config && sessionKey) {
    const runtimeStatus = resolveSandboxRuntimeStatus({
      cfg: args.config,
      sessionKey,
    });
    const sandboxMode = runtimeStatus.mode ?? "off";
    if (sandboxMode === "off") {
      return "direct";
    }
    const runtime = runtimeStatus.sandboxed ? "docker" : sessionKey ? "direct" : "unknown";
    return `${runtime}/${sandboxMode}`;
  }

  const sandboxMode = args.agent?.sandbox?.mode ?? "off";
  if (sandboxMode === "off") {
    return "direct";
  }
  const sandboxed = (() => {
    if (!sessionKey) {
      return false;
    }
    if (sandboxMode === "all") {
      return true;
    }
    if (args.config) {
      return resolveSandboxRuntimeStatus({
        cfg: args.config,
        sessionKey,
      }).sandboxed;
    }
    const sessionScope = args.sessionScope ?? "per-sender";
    const mainKey = resolveMainSessionKey({
      session: { scope: sessionScope },
    });
    return sessionKey !== mainKey.trim();
  })();
  const runtime = sandboxed ? "docker" : sessionKey ? "direct" : "unknown";
  return `${runtime}/${sandboxMode}`;
}

const formatTokens = (total: number | null | undefined, contextTokens: number | null) => {
  const ctx = contextTokens ?? null;
  if (total == null) {
    const ctxLabel = ctx ? formatTokenCount(ctx) : "?";
    return `?/${ctxLabel}`;
  }
  const pct = ctx ? Math.min(999, Math.round((total / ctx) * 100)) : null;
  const totalLabel = formatTokenCount(total);
  const ctxLabel = ctx ? formatTokenCount(ctx) : "?";
  return `${totalLabel}/${ctxLabel}${pct !== null ? ` (${pct}%)` : ""}`;
};

export const formatContextUsageShort = (
  total: number | null | undefined,
  contextTokens: number | null | undefined,
) => `上下文 ${formatTokens(total, contextTokens ?? null)}`;

function formatTimeAgoZh(durationMs: number | null | undefined): string {
  if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "未知";
  }

  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 1) {
    return "刚刚";
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} 小时前`;
  }
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

function localizeMediaCapabilityLabel(capability: string): string {
  switch (capability.trim().toLowerCase()) {
    case "image":
      return "图片";
    case "audio":
      return "音频";
    case "video":
      return "视频";
    default:
      return capability;
  }
}

function localizeTtsAutoModeLabel(mode: string): string {
  switch (mode.trim().toLowerCase()) {
    case "always":
      return "始终";
    case "inbound":
      return "收到时";
    case "tagged":
      return "标签触发";
    case "off":
      return "关闭";
    default:
      return mode;
  }
}

const formatQueueDetails = (queue?: QueueStatus) => {
  if (!queue) {
    return "";
  }
  const depth = typeof queue.depth === "number" ? `深度 ${queue.depth}` : null;
  if (!queue.showDetails) {
    return depth ? ` ${depth}` : "";
  }
  const detailParts: string[] = [];
  if (depth) {
    detailParts.push(depth);
  }
  if (typeof queue.debounceMs === "number") {
    const ms = Math.max(0, Math.round(queue.debounceMs));
    const label =
      ms >= 1000 ? `${ms % 1000 === 0 ? ms / 1000 : (ms / 1000).toFixed(1)} 秒` : `${ms} 毫秒`;
    detailParts.push(`防抖 ${label}`);
  }
  if (typeof queue.cap === "number") {
    detailParts.push(`上限 ${queue.cap}`);
  }
  if (queue.dropPolicy) {
    detailParts.push(`丢弃 ${localizeQueueDropLabel(queue.dropPolicy)}`);
  }
  return detailParts.length ? ` ${detailParts.join(" ")}` : "";
};

const readUsageFromSessionLog = (
  sessionId?: string,
  sessionEntry?: SessionEntry,
  agentId?: string,
  sessionKey?: string,
  storePath?: string,
):
  | {
      input: number;
      output: number;
      promptTokens: number;
      total: number;
      model?: string;
    }
  | undefined => {
  // Transcripts are stored at the session file path (fallback: ~/.openclaw/sessions/<SessionId>.jsonl)
  if (!sessionId) {
    return undefined;
  }
  let logPath: string;
  try {
    const resolvedAgentId =
      agentId ?? (sessionKey ? resolveAgentIdFromSessionKey(sessionKey) : undefined);
    logPath = resolveSessionFilePath(
      sessionId,
      sessionEntry,
      resolveSessionFilePathOptions({ agentId: resolvedAgentId, storePath }),
    );
  } catch {
    return undefined;
  }
  if (!fs.existsSync(logPath)) {
    return undefined;
  }

  try {
    // Read the tail only; we only need the most recent usage entries.
    const TAIL_BYTES = 8192;
    const stat = fs.statSync(logPath);
    const offset = Math.max(0, stat.size - TAIL_BYTES);
    const buf = Buffer.alloc(Math.min(TAIL_BYTES, stat.size));
    const fd = fs.openSync(logPath, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, offset);
    } finally {
      fs.closeSync(fd);
    }
    const tail = buf.toString("utf-8");
    const lines = (offset > 0 ? tail.slice(tail.indexOf("\n") + 1) : tail).split(/\n+/);

    let input = 0;
    let output = 0;
    let promptTokens = 0;
    let model: string | undefined;
    let lastUsage: ReturnType<typeof normalizeUsage> | undefined;

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as {
          message?: {
            usage?: UsageLike;
            model?: string;
          };
          usage?: UsageLike;
          model?: string;
        };
        const usageRaw = parsed.message?.usage ?? parsed.usage;
        const usage = normalizeUsage(usageRaw);
        if (usage) {
          lastUsage = usage;
        }
        model = parsed.message?.model ?? parsed.model ?? model;
      } catch {
        // ignore bad lines (including a truncated first tail line)
      }
    }

    if (!lastUsage) {
      return undefined;
    }
    input = lastUsage.input ?? 0;
    output = lastUsage.output ?? 0;
    promptTokens = derivePromptTokens(lastUsage) ?? lastUsage.total ?? input + output;
    const total = lastUsage.total ?? promptTokens + output;
    if (promptTokens === 0 && total === 0) {
      return undefined;
    }
    return { input, output, promptTokens, total, model };
  } catch {
    return undefined;
  }
};

const formatUsagePair = (input?: number | null, output?: number | null) => {
  if (input == null && output == null) {
    return null;
  }
  const inputLabel = typeof input === "number" ? formatTokenCount(input) : "?";
  const outputLabel = typeof output === "number" ? formatTokenCount(output) : "?";
  return `用量 ${inputLabel} 输入 / ${outputLabel} 输出`;
};

const formatCacheLine = (
  input?: number | null,
  cacheRead?: number | null,
  cacheWrite?: number | null,
) => {
  if (!cacheRead && !cacheWrite) {
    return null;
  }
  if (
    (typeof cacheRead !== "number" || cacheRead <= 0) &&
    (typeof cacheWrite !== "number" || cacheWrite <= 0)
  ) {
    return null;
  }

  const cachedLabel = typeof cacheRead === "number" ? formatTokenCount(cacheRead) : "0";
  const newLabel = typeof cacheWrite === "number" ? formatTokenCount(cacheWrite) : "0";

  const totalInput =
    (typeof cacheRead === "number" ? cacheRead : 0) +
    (typeof cacheWrite === "number" ? cacheWrite : 0) +
    (typeof input === "number" ? input : 0);
  const hitRate =
    totalInput > 0 && typeof cacheRead === "number"
      ? Math.round((cacheRead / totalInput) * 100)
      : 0;

  return `缓存 命中率 ${hitRate}% 已缓存 ${cachedLabel} 新增 ${newLabel}`;
};

const formatMediaUnderstandingLine = (decisions?: ReadonlyArray<MediaUnderstandingDecision>) => {
  if (!decisions || decisions.length === 0) {
    return null;
  }
  const parts = decisions
    .map((decision) => {
      const capabilityLabel = localizeMediaCapabilityLabel(decision.capability);
      const count = decision.attachments.length;
      const countLabel = count > 1 ? ` ${count} 个` : "";
      if (decision.outcome === "success") {
        const chosen = decision.attachments.find((entry) => entry.chosen)?.chosen;
        const provider = chosen?.provider?.trim();
        const model = chosen?.model?.trim();
        const modelLabel = provider ? (model ? `${provider}/${model}` : provider) : null;
        return `${capabilityLabel}${countLabel} 成功${modelLabel ? ` ${modelLabel}` : ""}`;
      }
      if (decision.outcome === "no-attachment") {
        return `${capabilityLabel} 无`;
      }
      if (decision.outcome === "disabled") {
        return `${capabilityLabel} 关闭`;
      }
      if (decision.outcome === "scope-deny") {
        return `${capabilityLabel} 拒绝`;
      }
      if (decision.outcome === "skipped") {
        const reason = decision.attachments
          .flatMap((entry) => entry.attempts.map((attempt) => attempt.reason).filter(Boolean))
          .find(Boolean);
        const shortReason = reason ? reason.split(":")[0]?.trim() : undefined;
        return `${capabilityLabel} 跳过${shortReason ? ` ${shortReason}` : ""}`;
      }
      return null;
    })
    .filter((part): part is string => part != null);
  if (parts.length === 0) {
    return null;
  }
  if (parts.every((part) => part.endsWith(" 无"))) {
    return null;
  }
  return `媒体 ${parts.join(" ")}`;
};

const formatVoiceModeLine = (
  config?: OpenClawConfig,
  sessionEntry?: SessionEntry,
): string | null => {
  if (!config) {
    return null;
  }
  const ttsConfig = resolveTtsConfig(config);
  const prefsPath = resolveTtsPrefsPath(ttsConfig);
  const autoMode = resolveTtsAutoMode({
    config: ttsConfig,
    prefsPath,
    sessionAuto: sessionEntry?.ttsAuto,
  });
  if (autoMode === "off") {
    return null;
  }
  const provider = getTtsProvider(ttsConfig, prefsPath);
  const maxLength = getTtsMaxLength(prefsPath);
  const summarize = isSummarizationEnabled(prefsPath) ? "开启" : "关闭";
  return `语音 ${localizeTtsAutoModeLabel(autoMode)} 提供方 ${provider} 上限 ${maxLength} 摘要 ${summarize}`;
};

export function buildStatusMessage(args: StatusArgs): string {
  const now = args.now ?? Date.now();
  const entry = args.sessionEntry;
  const selectionConfig = {
    agents: {
      defaults: args.agent ?? {},
    },
  } as OpenClawConfig;
  const contextConfig = args.config
    ? ({
        ...args.config,
        agents: {
          ...args.config.agents,
          defaults: {
            ...args.config.agents?.defaults,
            ...args.agent,
          },
        },
      } as OpenClawConfig)
    : ({
        agents: {
          defaults: args.agent ?? {},
        },
      } as OpenClawConfig);
  const resolved = resolveConfiguredModelRef({
    cfg: selectionConfig,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const selectedProvider = entry?.providerOverride ?? resolved.provider ?? DEFAULT_PROVIDER;
  const selectedModel = entry?.modelOverride ?? resolved.model ?? DEFAULT_MODEL;
  const modelRefs = resolveSelectedAndActiveModel({
    selectedProvider,
    selectedModel,
    sessionEntry: entry,
  });
  let activeProvider = modelRefs.active.provider;
  let activeModel = modelRefs.active.model;
  let contextTokens =
    resolveContextTokensForModel({
      cfg: contextConfig,
      provider: activeProvider,
      model: activeModel,
      contextTokensOverride: entry?.contextTokens ?? args.agent?.contextTokens,
      fallbackContextTokens: DEFAULT_CONTEXT_TOKENS,
    }) ?? DEFAULT_CONTEXT_TOKENS;

  let inputTokens = entry?.inputTokens;
  let outputTokens = entry?.outputTokens;
  let cacheRead = entry?.cacheRead;
  let cacheWrite = entry?.cacheWrite;
  let totalTokens = entry?.totalTokens ?? (entry?.inputTokens ?? 0) + (entry?.outputTokens ?? 0);

  // Prefer prompt-size tokens from the session transcript when it looks larger
  // (cached prompt tokens are often missing from agent meta/store).
  if (args.includeTranscriptUsage) {
    const logUsage = readUsageFromSessionLog(
      entry?.sessionId,
      entry,
      args.agentId,
      args.sessionKey,
      args.sessionStorePath,
    );
    if (logUsage) {
      const candidate = logUsage.promptTokens || logUsage.total;
      if (!totalTokens || totalTokens === 0 || candidate > totalTokens) {
        totalTokens = candidate;
      }
      if (!entry?.model && logUsage.model) {
        const slashIndex = logUsage.model.indexOf("/");
        if (slashIndex > 0) {
          const provider = logUsage.model.slice(0, slashIndex).trim();
          const model = logUsage.model.slice(slashIndex + 1).trim();
          if (provider && model) {
            activeProvider = provider;
            activeModel = model;
          }
        } else {
          activeModel = logUsage.model;
        }
      }
      if (!contextTokens && logUsage.model) {
        contextTokens =
          resolveContextTokensForModel({
            cfg: contextConfig,
            model: logUsage.model,
            fallbackContextTokens: contextTokens ?? undefined,
          }) ?? contextTokens;
      }
      if (!inputTokens || inputTokens === 0) {
        inputTokens = logUsage.input;
      }
      if (!outputTokens || outputTokens === 0) {
        outputTokens = logUsage.output;
      }
    }
  }

  const thinkLevel =
    args.resolvedThink ?? args.sessionEntry?.thinkingLevel ?? args.agent?.thinkingDefault ?? "off";
  const verboseLevel =
    args.resolvedVerbose ?? args.sessionEntry?.verboseLevel ?? args.agent?.verboseDefault ?? "off";
  const fastMode = args.resolvedFast ?? args.sessionEntry?.fastMode ?? false;
  const reasoningLevel = args.resolvedReasoning ?? args.sessionEntry?.reasoningLevel ?? "off";
  const elevatedLevel =
    args.resolvedElevated ??
    args.sessionEntry?.elevatedLevel ??
    args.agent?.elevatedDefault ??
    "on";

  const runtime = { label: resolveRuntimeLabel(args) };

  const updatedAt = entry?.updatedAt;
  const updatedLabel =
    typeof updatedAt === "number"
      ? (() => {
          const age = formatTimeAgoZh(now - updatedAt);
          return age === "刚刚" ? "刚刚更新" : `${age}更新`;
        })()
      : "暂无活动";
  const sessionLine = [`会话 ${args.sessionKey ?? "未知"}`, updatedLabel].filter(Boolean).join(" ");

  const isGroupSession =
    entry?.chatType === "group" ||
    entry?.chatType === "channel" ||
    Boolean(args.sessionKey?.includes(":group:")) ||
    Boolean(args.sessionKey?.includes(":channel:"));
  const groupActivationValue = isGroupSession
    ? (args.groupActivation ?? entry?.groupActivation ?? "mention")
    : undefined;

  const contextLine = [
    `上下文 ${formatTokens(totalTokens, contextTokens ?? null)}`,
    `压缩次数 ${entry?.compactionCount ?? 0}`,
  ]
    .filter(Boolean)
    .join(" ");

  const queueMode = args.queue?.mode ?? "unknown";
  const queueDetails = formatQueueDetails(args.queue);
  const verboseLabel =
    verboseLevel === "full" ? "verbose:full" : verboseLevel === "on" ? "verbose" : null;
  const elevatedLabel =
    elevatedLevel && elevatedLevel !== "off"
      ? elevatedLevel === "on"
        ? "elevated"
        : `elevated:${elevatedLevel}`
      : null;
  const optionParts = [
    `运行时 ${localizeRuntimeLabel(runtime.label)}`,
    `思考 ${localizeThinkingLevelLabel(thinkLevel)}`,
    fastMode ? "快速 开启" : null,
    verboseLabel
      ? `详细 ${verboseLevel === "full" ? "完整" : verboseLevel === "on" ? "开启" : verboseLevel}`
      : null,
    reasoningLevel !== "off" ? `推理 ${localizeToggleValue(reasoningLevel)}` : null,
    elevatedLabel ? `高级 ${localizeToggleValue(elevatedLevel)}` : null,
  ];
  const optionsLine = optionParts.filter(Boolean).join(" ");
  const activationParts = [
    groupActivationValue ? `激活 ${localizeGroupActivation(groupActivationValue)}` : null,
    `队列 ${localizeQueueModeLabel(queueMode)}${queueDetails}`,
  ];
  const activationLine = activationParts.filter(Boolean).join(" ");

  const selectedAuthMode =
    normalizeAuthMode(args.modelAuth) ?? resolveModelAuthMode(selectedProvider, args.config);
  const selectedAuthLabelValue =
    args.modelAuth ??
    (selectedAuthMode && selectedAuthMode !== "unknown" ? selectedAuthMode : undefined);
  const activeAuthMode =
    normalizeAuthMode(args.activeModelAuth) ?? resolveModelAuthMode(activeProvider, args.config);
  const activeAuthLabelValue =
    args.activeModelAuth ??
    (activeAuthMode && activeAuthMode !== "unknown" ? activeAuthMode : undefined);
  const selectedModelLabel = modelRefs.selected.label || "未知";
  const activeModelLabel = formatProviderModelRef(activeProvider, activeModel) || "未知";
  const fallbackState = resolveActiveFallbackState({
    selectedModelRef: selectedModelLabel,
    activeModelRef: activeModelLabel,
    state: entry,
  });
  const effectiveCostAuthMode = fallbackState.active
    ? activeAuthMode
    : (selectedAuthMode ?? activeAuthMode);
  const showCost = effectiveCostAuthMode === "api-key" || effectiveCostAuthMode === "mixed";
  const costConfig = showCost
    ? resolveModelCostConfig({
        provider: activeProvider,
        model: activeModel,
        config: args.config,
      })
    : undefined;
  const hasUsage = typeof inputTokens === "number" || typeof outputTokens === "number";
  const cost =
    showCost && hasUsage
      ? estimateUsageCost({
          usage: {
            input: inputTokens ?? undefined,
            output: outputTokens ?? undefined,
          },
          cost: costConfig,
        })
      : undefined;
  const costLabel = showCost && hasUsage ? formatUsd(cost) : undefined;

  const selectedAuthLabel = selectedAuthLabelValue
    ? ` 认证 ${localizeAuthLabel(selectedAuthLabelValue) ?? selectedAuthLabelValue}`
    : "";
  const channelModelNote = (() => {
    if (!args.config || !entry) {
      return undefined;
    }
    if (entry.modelOverride?.trim() || entry.providerOverride?.trim()) {
      return undefined;
    }
    const channelOverride = resolveChannelModelOverride({
      cfg: args.config,
      channel: entry.channel ?? entry.origin?.provider,
      groupId: entry.groupId,
      groupChannel: entry.groupChannel,
      groupSubject: entry.subject,
      parentSessionKey: args.parentSessionKey,
    });
    if (!channelOverride) {
      return undefined;
    }
    const aliasIndex = buildModelAliasIndex({
      cfg: args.config,
      defaultProvider: DEFAULT_PROVIDER,
    });
    const resolvedOverride = resolveModelRefFromString({
      raw: channelOverride.model,
      defaultProvider: DEFAULT_PROVIDER,
      aliasIndex,
    });
    if (!resolvedOverride) {
      return undefined;
    }
    if (
      resolvedOverride.ref.provider !== selectedProvider ||
      resolvedOverride.ref.model !== selectedModel
    ) {
      return undefined;
    }
    return "频道覆盖";
  })();
  const modelNote = channelModelNote ? ` ${channelModelNote}` : "";
  const modelLine = `模型 ${selectedModelLabel}${selectedAuthLabel}${modelNote}`;
  const showFallbackAuth = activeAuthLabelValue && activeAuthLabelValue !== selectedAuthLabelValue;
  const fallbackLine = fallbackState.active
    ? `回退 ${activeModelLabel}${
        showFallbackAuth
          ? ` 认证 ${localizeAuthLabel(activeAuthLabelValue) ?? activeAuthLabelValue}`
          : ""
      } 原因 ${localizeFallbackReason(fallbackState.reason) ?? "所选模型不可用"}`
    : null;
  const commit = resolveCommitHash({ moduleUrl: import.meta.url });
  const versionLine = `🦞 OpenClaw ${VERSION}${commit ? ` ${commit}` : ""}`;
  const usagePair = formatUsagePair(inputTokens, outputTokens);
  const cacheLine = formatCacheLine(inputTokens, cacheRead, cacheWrite);
  const costLine = costLabel ? `费用 ${costLabel}` : null;
  const usageCostLine =
    usagePair && costLine ? `${usagePair} ${costLine}` : (usagePair ?? costLine);
  const mediaLine = formatMediaUnderstandingLine(args.mediaDecisions);
  const voiceLine = formatVoiceModeLine(args.config, args.sessionEntry);

  return [
    versionLine,
    args.timeLine,
    modelLine,
    fallbackLine,
    usageCostLine,
    cacheLine,
    contextLine,
    mediaLine,
    args.usageLine,
    sessionLine,
    args.subagentsLine,
    optionsLine,
    voiceLine,
    activationLine,
  ]
    .filter(Boolean)
    .join("\n");
}

const CATEGORY_LABELS: Record<CommandCategory, string> = {
  session: "会话",
  options: "选项",
  status: "状态",
  management: "管理",
  media: "媒体",
  tools: "工具",
  docks: "停靠",
};

const CATEGORY_ORDER: CommandCategory[] = [
  "session",
  "options",
  "status",
  "management",
  "media",
  "tools",
  "docks",
];

function groupCommandsByCategory(
  commands: ChatCommandDefinition[],
): Map<CommandCategory, ChatCommandDefinition[]> {
  const grouped = new Map<CommandCategory, ChatCommandDefinition[]>();
  for (const category of CATEGORY_ORDER) {
    grouped.set(category, []);
  }
  for (const command of commands) {
    const category = command.category ?? "tools";
    const list = grouped.get(category) ?? [];
    list.push(command);
    grouped.set(category, list);
  }
  return grouped;
}

export function buildHelpMessage(cfg?: OpenClawConfig): string {
  const lines = ["🦞 帮助", ""];

  lines.push("会话");
  lines.push("  /new  |  /reset  |  /compact [instructions]  |  /stop");
  lines.push("");

  const optionParts = ["/think <level>", "/model <id>", "/fast on|off", "/verbose on|off"];
  if (isCommandFlagEnabled(cfg, "config")) {
    optionParts.push("/config");
  }
  if (isCommandFlagEnabled(cfg, "debug")) {
    optionParts.push("/debug");
  }
  lines.push("选项");
  lines.push(`  ${optionParts.join("  |  ")}`);
  lines.push("");

  lines.push("状态");
  lines.push("  /status  |  /whoami  |  /context");
  lines.push("");

  lines.push("技能");
  lines.push("  /skill <name> [input]");

  lines.push("");
  lines.push("更多 输入 /commands 查看完整列表");

  return lines.join("\n");
}

const COMMANDS_PER_PAGE = 8;

const COMMAND_DESCRIPTION_ZH: Record<string, string> = {
  acp: "管理 ACP 会话和运行选项",
  activation: "设置群聊激活方式",
  agents: "查看代理列表",
  allowlist: "查看或修改白名单",
  approve: "提交执行审批",
  clear: "清空聊天记录",
  commands: "查看完整命令列表",
  compact: "压缩会话上下文",
  config: "查看或修改配置",
  context: "查看上下文状态",
  debug: "查看调试信息",
  "dock-telegram": "切换到 Telegram 回复",
  dock_telegram: "切换到 Telegram 回复",
  elevated: "切换高级模式",
  export: "导出会话到 Markdown",
  "export-session": "导出当前会话到 HTML 文件含完整系统提示",
  exec: "设置当前会话的执行默认值",
  fast: "切换快速模式",
  focus: "切换专注模式",
  help: "查看帮助",
  id: "查看当前身份",
  kill: "中断子代理",
  model: "查看或设置模型",
  models: "查看模型提供方或模型列表",
  new: "开始新会话",
  queue: "调整队列设置",
  reasoning: "切换推理可见性",
  reset: "重置当前会话",
  restart: "重启 OpenClaw",
  send: "设置发送策略",
  skill: "运行技能",
  status: "查看系统状态",
  stop: "中断当前任务",
  subagents: "查看 中断 日志 启动或引导子代理",
  think: "设置思考等级",
  tts: "控制文本转语音",
  unfocus: "移除当前线程或会话绑定",
  usage: "查看用量",
  verbose: "切换详细模式",
  whoami: "查看当前身份",
};

export type CommandsMessageOptions = {
  page?: number;
  surface?: string;
};

export type CommandsMessageResult = {
  text: string;
  totalPages: number;
  currentPage: number;
  hasNext: boolean;
  hasPrev: boolean;
};

function formatCommandEntry(command: ChatCommandDefinition): string {
  const primary = command.nativeName
    ? `/${command.nativeName}`
    : command.textAliases[0]?.trim() || `/${command.key}`;
  const descriptionKey = primary.replace(/^\//u, "").trim().toLowerCase();
  const seen = new Set<string>();
  const aliases = command.textAliases
    .map((alias) => alias.trim())
    .filter(Boolean)
    .filter((alias) => alias.toLowerCase() !== primary.toLowerCase())
    .filter((alias) => {
      const key = alias.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  const aliasLabel = aliases.length ? ` ${aliases.join(" ")}` : "";
  const scopeLabel = command.scope === "text" ? " 文本" : "";
  const description =
    COMMAND_DESCRIPTION_ZH[descriptionKey] ??
    COMMAND_DESCRIPTION_ZH[command.key] ??
    command.description;
  return `${primary}${aliasLabel}${scopeLabel} ${description}`;
}

type CommandsListItem = {
  label: string;
  text: string;
};

function buildCommandItems(
  commands: ChatCommandDefinition[],
  pluginCommands: ReturnType<typeof listPluginCommands>,
): CommandsListItem[] {
  const grouped = groupCommandsByCategory(commands);
  const items: CommandsListItem[] = [];

  for (const category of CATEGORY_ORDER) {
    const categoryCommands = grouped.get(category) ?? [];
    if (categoryCommands.length === 0) {
      continue;
    }
    const label = CATEGORY_LABELS[category];
    for (const command of categoryCommands) {
      items.push({ label, text: formatCommandEntry(command) });
    }
  }

  for (const command of pluginCommands) {
    const pluginLabel = command.pluginId ? ` ${command.pluginId}` : "";
    items.push({
      label: "插件",
      text: `/${command.name}${pluginLabel} ${command.description}`,
    });
  }

  return items;
}

function formatCommandList(items: CommandsListItem[]): string {
  const lines: string[] = [];
  let currentLabel: string | null = null;

  for (const item of items) {
    if (item.label !== currentLabel) {
      if (lines.length > 0) {
        lines.push("");
      }
      lines.push(item.label);
      currentLabel = item.label;
    }
    lines.push(`  ${item.text}`);
  }

  return lines.join("\n");
}

export function buildCommandsMessage(
  cfg?: OpenClawConfig,
  skillCommands?: SkillCommandSpec[],
  options?: CommandsMessageOptions,
): string {
  const result = buildCommandsMessagePaginated(cfg, skillCommands, options);
  return result.text;
}

export function buildCommandsMessagePaginated(
  cfg?: OpenClawConfig,
  skillCommands?: SkillCommandSpec[],
  options?: CommandsMessageOptions,
): CommandsMessageResult {
  const page = Math.max(1, options?.page ?? 1);
  const surface = options?.surface?.toLowerCase();
  const isTelegram = surface === "telegram";

  const commands = cfg
    ? listChatCommandsForConfig(cfg, { skillCommands })
    : listChatCommands({ skillCommands });
  const pluginCommands = listPluginCommands();
  const items = buildCommandItems(commands, pluginCommands);

  if (!isTelegram) {
    const lines = ["🦞 命令列表", ""];
    lines.push(formatCommandList(items));
    return {
      text: lines.join("\n").trim(),
      totalPages: 1,
      currentPage: 1,
      hasNext: false,
      hasPrev: false,
    };
  }

  const totalCommands = items.length;
  const totalPages = Math.max(1, Math.ceil(totalCommands / COMMANDS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * COMMANDS_PER_PAGE;
  const endIndex = startIndex + COMMANDS_PER_PAGE;
  const pageItems = items.slice(startIndex, endIndex);

  const lines = [`🦞 命令 ${currentPage}/${totalPages}`, ""];
  lines.push(formatCommandList(pageItems));

  return {
    text: lines.join("\n").trim(),
    totalPages,
    currentPage,
    hasNext: currentPage < totalPages,
    hasPrev: currentPage > 1,
  };
}
