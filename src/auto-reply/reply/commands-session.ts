import { resolveFastModeState } from "../../agents/fast-mode.js";
import { parseDurationMs } from "../../cli/parse-duration.js";
import { isRestartEnabled } from "../../config/commands.js";
import {
  formatThreadBindingDurationLabel,
  getThreadBindingManager,
  resolveThreadBindingIdleTimeoutMs,
  resolveThreadBindingInactivityExpiresAt,
  resolveThreadBindingMaxAgeExpiresAt,
  resolveThreadBindingMaxAgeMs,
  setThreadBindingIdleTimeoutBySessionKey,
  setThreadBindingMaxAgeBySessionKey,
} from "../../discord/monitor/thread-bindings.js";
import { logVerbose } from "../../globals.js";
import { getSessionBindingService } from "../../infra/outbound/session-binding-service.js";
import type { SessionBindingRecord } from "../../infra/outbound/session-binding-service.js";
import { scheduleGatewaySigusr1Restart, triggerOpenClawRestart } from "../../infra/restart.js";
import { loadCostUsageSummary, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import {
  localizeFastModeLabel,
  localizeGroupActivation,
  localizeSendPolicyLabel,
  localizeUsageModeLabel,
} from "../../shared/system-command-display.js";
import {
  setTelegramThreadBindingIdleTimeoutBySessionKey,
  setTelegramThreadBindingMaxAgeBySessionKey,
} from "../../telegram/thread-bindings.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import { formatTokenCount, formatUsd } from "../../utils/usage-format.js";
import { parseActivationCommand } from "../group-activation.js";
import { parseSendPolicyCommand } from "../send-policy.js";
import { normalizeFastMode, normalizeUsageDisplay, resolveResponseUsageMode } from "../thinking.js";
import { isDiscordSurface, isTelegramSurface, resolveChannelAccountId } from "./channel-context.js";
import { handleAbortTrigger, handleStopCommand } from "./commands-session-abort.js";
import { persistSessionEntry } from "./commands-session-store.js";
import type { CommandHandler } from "./commands-types.js";
import { resolveTelegramConversationId } from "./telegram-context.js";

const SESSION_COMMAND_PREFIX = "/session";
const SESSION_DURATION_OFF_VALUES = new Set(["off", "disable", "disabled", "none", "0"]);
const SESSION_ACTION_IDLE = "idle";
const SESSION_ACTION_MAX_AGE = "max-age";

function resolveSessionCommandUsage() {
  return "🦞 用法 /session idle <时长|off> | /session max-age <时长|off> 例如 /session idle 24h";
}

function parseSessionDurationMs(raw: string): number {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error("missing duration");
  }
  if (SESSION_DURATION_OFF_VALUES.has(normalized)) {
    return 0;
  }
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const hours = Number(normalized);
    if (!Number.isFinite(hours) || hours < 0) {
      throw new Error("invalid duration");
    }
    return Math.round(hours * 60 * 60 * 1000);
  }
  return parseDurationMs(normalized, { defaultUnit: "h" });
}

function formatSessionExpiry(expiresAt: number) {
  return new Date(expiresAt).toISOString();
}

function formatBindingCountLabel(count: number): string {
  return `${count} 个绑定`;
}

function resolveTelegramBindingDurationMs(
  binding: SessionBindingRecord,
  key: "idleTimeoutMs" | "maxAgeMs",
  fallbackMs: number,
): number {
  const raw = binding.metadata?.[key];
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallbackMs;
  }
  return Math.max(0, Math.floor(raw));
}

function resolveTelegramBindingLastActivityAt(binding: SessionBindingRecord): number {
  const raw = binding.metadata?.lastActivityAt;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return binding.boundAt;
  }
  return Math.max(Math.floor(raw), binding.boundAt);
}

function resolveTelegramBindingBoundBy(binding: SessionBindingRecord): string {
  const raw = binding.metadata?.boundBy;
  return typeof raw === "string" ? raw.trim() : "";
}

type UpdatedLifecycleBinding = {
  boundAt: number;
  lastActivityAt: number;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
};

function resolveUpdatedBindingExpiry(params: {
  action: typeof SESSION_ACTION_IDLE | typeof SESSION_ACTION_MAX_AGE;
  bindings: UpdatedLifecycleBinding[];
}): number | undefined {
  const expiries = params.bindings
    .map((binding) => {
      if (params.action === SESSION_ACTION_IDLE) {
        const idleTimeoutMs =
          typeof binding.idleTimeoutMs === "number" && Number.isFinite(binding.idleTimeoutMs)
            ? Math.max(0, Math.floor(binding.idleTimeoutMs))
            : 0;
        if (idleTimeoutMs <= 0) {
          return undefined;
        }
        return Math.max(binding.lastActivityAt, binding.boundAt) + idleTimeoutMs;
      }

      const maxAgeMs =
        typeof binding.maxAgeMs === "number" && Number.isFinite(binding.maxAgeMs)
          ? Math.max(0, Math.floor(binding.maxAgeMs))
          : 0;
      if (maxAgeMs <= 0) {
        return undefined;
      }
      return binding.boundAt + maxAgeMs;
    })
    .filter((expiresAt): expiresAt is number => typeof expiresAt === "number");

  if (expiries.length === 0) {
    return undefined;
  }
  return Math.min(...expiries);
}

export const handleActivationCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const activationCommand = parseActivationCommand(params.command.commandBodyNormalized);
  if (!activationCommand.hasCommand) {
    return null;
  }
  const normalizedSurface = normalizeMessageChannel(params.command.channel);
  const isChineseSurface =
    normalizedSurface === "telegram" || normalizedSurface === INTERNAL_MESSAGE_CHANNEL;
  if (!params.isGroup) {
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface
          ? "🦞 群组激活仅适用于群聊"
          : "⚙️ Group activation only applies to group chats.",
      },
    };
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /activation from unauthorized sender in group: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!activationCommand.mode) {
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface
          ? "🦞 用法 /activation mention|always"
          : "⚙️ Usage: /activation mention|always",
      },
    };
  }
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.groupActivation = activationCommand.mode;
    params.sessionEntry.groupActivationNeedsSystemIntro = true;
    await persistSessionEntry(params);
  }
  return {
    shouldContinue: false,
    reply: {
      text: isChineseSurface
        ? `🦞 已将群组激活模式设为 ${localizeGroupActivation(activationCommand.mode)}`
        : `⚙️ Group activation set to ${activationCommand.mode}.`,
    },
  };
};

export const handleSendPolicyCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const sendPolicyCommand = parseSendPolicyCommand(params.command.commandBodyNormalized);
  if (!sendPolicyCommand.hasCommand) {
    return null;
  }
  const normalizedSurface = normalizeMessageChannel(params.command.channel);
  const isChineseSurface =
    normalizedSurface === "telegram" || normalizedSurface === INTERNAL_MESSAGE_CHANNEL;
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /send from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!sendPolicyCommand.mode) {
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface ? "🦞 用法 /send on|off|inherit" : "⚙️ Usage: /send on|off|inherit",
      },
    };
  }
  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    if (sendPolicyCommand.mode === "inherit") {
      delete params.sessionEntry.sendPolicy;
    } else {
      params.sessionEntry.sendPolicy = sendPolicyCommand.mode;
    }
    await persistSessionEntry(params);
  }
  const label =
    sendPolicyCommand.mode === "inherit"
      ? "inherit"
      : sendPolicyCommand.mode === "allow"
        ? "on"
        : "off";
  return {
    shouldContinue: false,
    reply: {
      text: isChineseSurface
        ? `🦞 已将发送策略设为 ${localizeSendPolicyLabel(label)}`
        : `⚙️ Send policy set to ${label}.`,
    },
  };
};

export const handleUsageCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  const commandPrefix =
    normalized === "/usage" || normalized.startsWith("/usage ")
      ? "/usage"
      : normalized === "/quota" || normalized.startsWith("/quota ")
        ? "/quota"
        : null;
  if (!commandPrefix) {
    return null;
  }
  const normalizedSurface = normalizeMessageChannel(params.command.channel);
  const isChineseSurface =
    normalizedSurface === "telegram" || normalizedSurface === INTERNAL_MESSAGE_CHANNEL;
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring ${commandPrefix} from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rawArgs = normalized === commandPrefix ? "" : normalized.slice(commandPrefix.length).trim();
  const requested = rawArgs ? normalizeUsageDisplay(rawArgs) : undefined;
  if (rawArgs.toLowerCase().startsWith("cost")) {
    const sessionSummary = await loadSessionCostSummary({
      sessionId: params.sessionEntry?.sessionId,
      sessionEntry: params.sessionEntry,
      sessionFile: params.sessionEntry?.sessionFile,
      config: params.cfg,
      agentId: params.agentId,
    });
    const summary = await loadCostUsageSummary({ days: 30, config: params.cfg });

    const sessionCost = formatUsd(sessionSummary?.totalCost);
    const sessionTokens = sessionSummary?.totalTokens
      ? formatTokenCount(sessionSummary.totalTokens)
      : undefined;
    const sessionMissing = sessionSummary?.missingCostEntries ?? 0;
    const sessionSuffix = sessionMissing > 0 ? " 部分统计" : "";
    const sessionLine =
      sessionCost || sessionTokens
        ? `Session ${sessionCost ?? "n/a"}${sessionSuffix}${sessionTokens ? ` · ${sessionTokens} tokens` : ""}`
        : "Session n/a";
    const sessionLineZh =
      sessionCost || sessionTokens
        ? `会话 ${sessionCost ?? "无"}${sessionSuffix}${sessionTokens ? ` ${sessionTokens} 个令牌` : ""}`
        : "会话 无";

    const todayKey = new Date().toLocaleDateString("en-CA");
    const todayEntry = summary.daily.find((entry) => entry.date === todayKey);
    const todayCost = formatUsd(todayEntry?.totalCost);
    const todayMissing = todayEntry?.missingCostEntries ?? 0;
    const todaySuffix = todayMissing > 0 ? " 部分统计" : "";
    const todayLine = `Today ${todayCost ?? "n/a"}${todaySuffix}`;
    const todayLineZh = `今日 ${todayCost ?? "无"}${todaySuffix}`;

    const last30Cost = formatUsd(summary.totals.totalCost);
    const last30Missing = summary.totals.missingCostEntries;
    const last30Suffix = last30Missing > 0 ? " 部分统计" : "";
    const last30Line = `Last 30d ${last30Cost ?? "n/a"}${last30Suffix}`;
    const last30LineZh = `近 30 天 ${last30Cost ?? "无"}${last30Suffix}`;

    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface
          ? `🦞 用量费用\n${sessionLineZh}\n${todayLineZh}\n${last30LineZh}`
          : `💸 Usage cost\n${sessionLine}\n${todayLine}\n${last30Line}`,
      },
    };
  }

  if (rawArgs && !requested) {
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface
          ? "🦞 用法 /usage off|tokens|full|cost"
          : "⚙️ Usage: /usage off|tokens|full|cost",
      },
    };
  }

  const currentRaw =
    params.sessionEntry?.responseUsage ??
    (params.sessionKey ? params.sessionStore?.[params.sessionKey]?.responseUsage : undefined);
  const current = resolveResponseUsageMode(currentRaw);
  const next = requested ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");

  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    if (next === "off") {
      delete params.sessionEntry.responseUsage;
    } else {
      params.sessionEntry.responseUsage = next;
    }
    await persistSessionEntry(params);
  }

  return {
    shouldContinue: false,
    reply: {
      text: isChineseSurface
        ? `🦞 已将用量尾注设为 ${localizeUsageModeLabel(next)}`
        : `⚙️ Usage footer: ${next}.`,
    },
  };
};

export const handleFastCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/fast" && !normalized.startsWith("/fast ")) {
    return null;
  }
  const normalizedSurface = normalizeMessageChannel(params.command.channel);
  const isChineseSurface =
    normalizedSurface === "telegram" || normalizedSurface === INTERNAL_MESSAGE_CHANNEL;
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /fast from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rawArgs = normalized === "/fast" ? "" : normalized.slice("/fast".length).trim();
  const rawMode = rawArgs.toLowerCase();
  if (!rawMode || rawMode === "status") {
    const state = resolveFastModeState({
      cfg: params.cfg,
      provider: params.provider,
      model: params.model,
      sessionEntry: params.sessionEntry,
    });
    const suffix =
      state.source === "config" ? " (config)" : state.source === "default" ? " (default)" : "";
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface
          ? `🦞 当前快速模式 ${localizeFastModeLabel(state.enabled ? "on" : "off")}${
              state.source === "config" ? " 配置" : state.source === "default" ? " 默认" : ""
            }`
          : `⚙️ Current fast mode: ${state.enabled ? "on" : "off"}${suffix}.`,
      },
    };
  }

  const nextMode = normalizeFastMode(rawMode);
  if (nextMode === undefined) {
    return {
      shouldContinue: false,
      reply: {
        text: isChineseSurface ? "🦞 用法 /fast status|on|off" : "⚙️ Usage: /fast status|on|off",
      },
    };
  }

  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    params.sessionEntry.fastMode = nextMode;
    await persistSessionEntry(params);
  }

  return {
    shouldContinue: false,
    reply: {
      text: isChineseSurface
        ? `🦞 快速模式已${nextMode ? "开启" : "关闭"}`
        : `⚙️ Fast mode ${nextMode ? "enabled" : "disabled"}.`,
    },
  };
};

export const handleSessionCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const normalized = params.command.commandBodyNormalized;
  if (!/^\/session(?:\s|$)/.test(normalized)) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /session from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  const rest = normalized.slice(SESSION_COMMAND_PREFIX.length).trim();
  const tokens = rest.split(/\s+/).filter(Boolean);
  const action = tokens[0]?.toLowerCase();
  if (action !== SESSION_ACTION_IDLE && action !== SESSION_ACTION_MAX_AGE) {
    return {
      shouldContinue: false,
      reply: { text: resolveSessionCommandUsage() },
    };
  }

  const onDiscord = isDiscordSurface(params);
  const onTelegram = isTelegramSurface(params);
  if (!onDiscord && !onTelegram) {
    return {
      shouldContinue: false,
      reply: {
        text: "🦞 /session idle 和 /session max-age 目前仅支持 Discord 和 Telegram 的已聚焦会话",
      },
    };
  }

  const accountId = resolveChannelAccountId(params);
  const sessionBindingService = getSessionBindingService();
  const threadId =
    params.ctx.MessageThreadId != null ? String(params.ctx.MessageThreadId).trim() : "";
  const telegramConversationId = onTelegram ? resolveTelegramConversationId(params) : undefined;

  const discordManager = onDiscord ? getThreadBindingManager(accountId) : null;
  if (onDiscord && !discordManager) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Discord thread bindings are unavailable for this account." },
    };
  }

  const discordBinding =
    onDiscord && threadId ? discordManager?.getByThreadId(threadId) : undefined;
  const telegramBinding =
    onTelegram && telegramConversationId
      ? sessionBindingService.resolveByConversation({
          channel: "telegram",
          accountId,
          conversationId: telegramConversationId,
        })
      : null;
  if (onDiscord && !discordBinding) {
    if (onDiscord && !threadId) {
      return {
        shouldContinue: false,
        reply: {
          text: "🦞 /session idle 和 /session max-age 必须在已聚焦的 Discord 线程中执行",
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: "🦞 当前线程未聚焦" },
    };
  }
  if (onTelegram && !telegramBinding) {
    if (!telegramConversationId) {
      return {
        shouldContinue: false,
        reply: {
          text: "🦞 Telegram 上的 /session idle 和 /session max-age 在群组中需要 topic 上下文，或在私聊中使用",
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: "🦞 当前会话未聚焦" },
    };
  }

  const idleTimeoutMs = onDiscord
    ? resolveThreadBindingIdleTimeoutMs({
        record: discordBinding!,
        defaultIdleTimeoutMs: discordManager!.getIdleTimeoutMs(),
      })
    : resolveTelegramBindingDurationMs(telegramBinding!, "idleTimeoutMs", 24 * 60 * 60 * 1000);
  const idleExpiresAt = onDiscord
    ? resolveThreadBindingInactivityExpiresAt({
        record: discordBinding!,
        defaultIdleTimeoutMs: discordManager!.getIdleTimeoutMs(),
      })
    : idleTimeoutMs > 0
      ? resolveTelegramBindingLastActivityAt(telegramBinding!) + idleTimeoutMs
      : undefined;
  const maxAgeMs = onDiscord
    ? resolveThreadBindingMaxAgeMs({
        record: discordBinding!,
        defaultMaxAgeMs: discordManager!.getMaxAgeMs(),
      })
    : resolveTelegramBindingDurationMs(telegramBinding!, "maxAgeMs", 0);
  const maxAgeExpiresAt = onDiscord
    ? resolveThreadBindingMaxAgeExpiresAt({
        record: discordBinding!,
        defaultMaxAgeMs: discordManager!.getMaxAgeMs(),
      })
    : maxAgeMs > 0
      ? telegramBinding!.boundAt + maxAgeMs
      : undefined;

  const durationArgRaw = tokens.slice(1).join("");
  if (!durationArgRaw) {
    if (action === SESSION_ACTION_IDLE) {
      if (
        typeof idleExpiresAt === "number" &&
        Number.isFinite(idleExpiresAt) &&
        idleExpiresAt > Date.now()
      ) {
        return {
          shouldContinue: false,
          reply: {
            text: `🦞 空闲超时已启用 ${formatThreadBindingDurationLabel(idleTimeoutMs)} 下次自动取消聚焦时间 ${formatSessionExpiry(idleExpiresAt)}`,
          },
        };
      }
      return {
        shouldContinue: false,
        reply: { text: "🦞 当前聚焦会话的空闲超时已关闭" },
      };
    }

    if (
      typeof maxAgeExpiresAt === "number" &&
      Number.isFinite(maxAgeExpiresAt) &&
      maxAgeExpiresAt > Date.now()
    ) {
      return {
        shouldContinue: false,
        reply: {
          text: `🦞 最大时长已启用 ${formatThreadBindingDurationLabel(maxAgeMs)} 硬性自动取消聚焦时间 ${formatSessionExpiry(maxAgeExpiresAt)}`,
        },
      };
    }
    return {
      shouldContinue: false,
      reply: { text: "🦞 当前聚焦会话的最大时长已关闭" },
    };
  }

  const senderId = params.command.senderId?.trim() || "";
  const boundBy = onDiscord
    ? discordBinding!.boundBy
    : resolveTelegramBindingBoundBy(telegramBinding!);
  if (boundBy && boundBy !== "system" && senderId && senderId !== boundBy) {
    return {
      shouldContinue: false,
      reply: {
        text: onDiscord
          ? `🦞 只有 ${boundBy} 可以修改这个线程的会话生命周期设置`
          : `🦞 只有 ${boundBy} 可以修改这个会话的生命周期设置`,
      },
    };
  }

  let durationMs: number;
  try {
    durationMs = parseSessionDurationMs(durationArgRaw);
  } catch {
    return {
      shouldContinue: false,
      reply: { text: resolveSessionCommandUsage() },
    };
  }

  const updatedBindings = (() => {
    if (onDiscord) {
      return action === SESSION_ACTION_IDLE
        ? setThreadBindingIdleTimeoutBySessionKey({
            targetSessionKey: discordBinding!.targetSessionKey,
            accountId,
            idleTimeoutMs: durationMs,
          })
        : setThreadBindingMaxAgeBySessionKey({
            targetSessionKey: discordBinding!.targetSessionKey,
            accountId,
            maxAgeMs: durationMs,
          });
    }
    return action === SESSION_ACTION_IDLE
      ? setTelegramThreadBindingIdleTimeoutBySessionKey({
          targetSessionKey: telegramBinding!.targetSessionKey,
          accountId,
          idleTimeoutMs: durationMs,
        })
      : setTelegramThreadBindingMaxAgeBySessionKey({
          targetSessionKey: telegramBinding!.targetSessionKey,
          accountId,
          maxAgeMs: durationMs,
        });
  })();
  if (updatedBindings.length === 0) {
    return {
      shouldContinue: false,
      reply: {
        text:
          action === SESSION_ACTION_IDLE
            ? "🦞 更新当前绑定的空闲超时失败"
            : "🦞 更新当前绑定的最大时长失败",
      },
    };
  }

  if (durationMs <= 0) {
    return {
      shouldContinue: false,
      reply: {
        text:
          action === SESSION_ACTION_IDLE
            ? `🦞 已为 ${formatBindingCountLabel(updatedBindings.length)}关闭空闲超时`
            : `🦞 已为 ${formatBindingCountLabel(updatedBindings.length)}关闭最大时长`,
      },
    };
  }

  const nextExpiry = resolveUpdatedBindingExpiry({
    action,
    bindings: updatedBindings,
  });
  const expiryLabel =
    typeof nextExpiry === "number" && Number.isFinite(nextExpiry)
      ? formatSessionExpiry(nextExpiry)
      : "无";

  return {
    shouldContinue: false,
    reply: {
      text:
        action === SESSION_ACTION_IDLE
          ? `🦞 已为 ${formatBindingCountLabel(updatedBindings.length)}设置空闲超时为 ${formatThreadBindingDurationLabel(durationMs)} 下次自动取消聚焦时间 ${expiryLabel}`
          : `🦞 已为 ${formatBindingCountLabel(updatedBindings.length)}设置最大时长为 ${formatThreadBindingDurationLabel(durationMs)} 硬性自动取消聚焦时间 ${expiryLabel}`,
    },
  };
};
export const handleRestartCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  if (params.command.commandBodyNormalized !== "/restart") {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /restart from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (!isRestartEnabled(params.cfg)) {
    return {
      shouldContinue: false,
      reply: {
        text: "🦞 /restart 已禁用 commands.restart=false",
      },
    };
  }
  const hasSigusr1Listener = process.listenerCount("SIGUSR1") > 0;
  if (hasSigusr1Listener) {
    scheduleGatewaySigusr1Restart({ reason: "/restart" });
    return {
      shouldContinue: false,
      reply: {
        text: "🦞 正在进程内重启 OpenClaw SIGUSR1 几秒后恢复",
      },
    };
  }
  const restartMethod = triggerOpenClawRestart();
  if (!restartMethod.ok) {
    const detail = restartMethod.detail ? ` 详情 ${restartMethod.detail}` : "";
    return {
      shouldContinue: false,
      reply: {
        text: `🦞 重启失败 ${restartMethod.method}${detail}`,
      },
    };
  }
  return {
    shouldContinue: false,
    reply: {
      text: `🦞 正在通过 ${restartMethod.method} 重启 OpenClaw 请等几秒恢复在线`,
    },
  };
};

export { handleAbortTrigger, handleStopCommand };
