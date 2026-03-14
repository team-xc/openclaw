import {
  resolveAgentConfig,
  resolveAgentDir,
  resolveSessionAgentId,
} from "../../agents/agent-scope.js";
import { resolveFastModeState } from "../../agents/fast-mode.js";
import { resolveSandboxRuntimeStatus } from "../../agents/sandbox.js";
import type { OpenClawConfig } from "../../config/config.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";
import type { ExecAsk, ExecHost, ExecSecurity } from "../../infra/exec-approvals.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { applyVerboseOverride } from "../../sessions/level-overrides.js";
import { applyModelOverrideToSessionEntry } from "../../sessions/model-overrides.js";
import {
  formatEnglishOptions,
  localizeElevatedLevelLabel,
  localizeExecAskLabel,
  localizeExecHostLabel,
  localizeExecSecurityLabel,
  localizeFastModeLabel,
  localizeQueueDropLabel,
  localizeQueueModeLabel,
  localizeReasoningLevelLabel,
  localizeThinkingLevelLabel,
  localizeVerboseLevelLabel,
} from "../../shared/system-command-display.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import { formatThinkingLevels, formatXHighModelHint, supportsXHighThinking } from "../thinking.js";
import type { ReplyPayload } from "../types.js";
import {
  maybeHandleModelDirectiveInfo,
  resolveModelSelectionFromDirective,
} from "./directive-handling.model.js";
import type { HandleDirectiveOnlyParams } from "./directive-handling.params.js";
import { maybeHandleQueueDirective } from "./directive-handling.queue-validation.js";
import {
  formatDirectiveAck,
  formatElevatedRuntimeHint,
  formatElevatedUnavailableText,
  enqueueModeSwitchEvents,
} from "./directive-handling.shared.js";
import type { ElevatedLevel, ReasoningLevel, ThinkLevel } from "./directives.js";

function localizeThinkingOptions(provider?: string, model?: string): string {
  return formatEnglishOptions(formatThinkingLevels(provider, model));
}

function formatDurationZh(ms: number): string {
  if (ms % 1000 === 0) {
    return `${ms / 1000} 秒`;
  }
  return `${ms} 毫秒`;
}

function resolveExecDefaults(params: {
  cfg: OpenClawConfig;
  sessionEntry?: SessionEntry;
  agentId?: string;
}): { host: ExecHost; security: ExecSecurity; ask: ExecAsk; node?: string } {
  const globalExec = params.cfg.tools?.exec;
  const agentExec = params.agentId
    ? resolveAgentConfig(params.cfg, params.agentId)?.tools?.exec
    : undefined;
  return {
    host:
      (params.sessionEntry?.execHost as ExecHost | undefined) ??
      (agentExec?.host as ExecHost | undefined) ??
      (globalExec?.host as ExecHost | undefined) ??
      "sandbox",
    security:
      (params.sessionEntry?.execSecurity as ExecSecurity | undefined) ??
      (agentExec?.security as ExecSecurity | undefined) ??
      (globalExec?.security as ExecSecurity | undefined) ??
      "deny",
    ask:
      (params.sessionEntry?.execAsk as ExecAsk | undefined) ??
      (agentExec?.ask as ExecAsk | undefined) ??
      (globalExec?.ask as ExecAsk | undefined) ??
      "on-miss",
    node: params.sessionEntry?.execNode ?? agentExec?.node ?? globalExec?.node,
  };
}

export async function handleDirectiveOnly(
  params: HandleDirectiveOnlyParams,
): Promise<ReplyPayload | undefined> {
  const {
    directives,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    elevatedEnabled,
    elevatedAllowed,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelKeys,
    allowedModelCatalog,
    resetModelOverride,
    provider,
    model,
    initialModelLabel,
    formatModelSwitchEvent,
    currentThinkLevel,
    currentFastMode,
    currentVerboseLevel,
    currentReasoningLevel,
    currentElevatedLevel,
  } = params;
  const activeAgentId = resolveSessionAgentId({
    sessionKey: params.sessionKey,
    config: params.cfg,
  });
  const agentDir = resolveAgentDir(params.cfg, activeAgentId);
  const runtimeIsSandboxed = resolveSandboxRuntimeStatus({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
  }).sandboxed;
  const shouldHintDirectRuntime = directives.hasElevatedDirective && !runtimeIsSandboxed;
  const normalizedSurface = normalizeMessageChannel(params.surface);
  const isChineseSurface =
    normalizedSurface === "telegram" || normalizedSurface === INTERNAL_MESSAGE_CHANNEL;

  const modelInfo = await maybeHandleModelDirectiveInfo({
    directives,
    cfg: params.cfg,
    agentDir,
    activeAgentId,
    provider,
    model,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelCatalog,
    resetModelOverride,
    surface: params.surface,
    sessionEntry,
  });
  if (modelInfo) {
    return modelInfo;
  }

  const modelResolution = resolveModelSelectionFromDirective({
    directives,
    cfg: params.cfg,
    agentDir,
    defaultProvider,
    defaultModel,
    aliasIndex,
    allowedModelKeys,
    allowedModelCatalog,
    provider,
  });
  if (modelResolution.errorText) {
    return { text: modelResolution.errorText };
  }
  const modelSelection = modelResolution.modelSelection;
  const profileOverride = modelResolution.profileOverride;

  const resolvedProvider = modelSelection?.provider ?? provider;
  const resolvedModel = modelSelection?.model ?? model;
  const fastModeState = resolveFastModeState({
    cfg: params.cfg,
    provider: resolvedProvider,
    model: resolvedModel,
    sessionEntry,
  });
  const effectiveFastMode = directives.fastMode ?? currentFastMode ?? fastModeState.enabled;
  const effectiveFastModeSource =
    directives.fastMode !== undefined ? "session" : fastModeState.source;

  if (directives.hasThinkDirective && !directives.thinkLevel) {
    // If no argument was provided, show the current level
    if (!directives.rawThinkLevel) {
      const level = currentThinkLevel ?? "off";
      return {
        text: isChineseSurface
          ? `🦞 当前思考等级 ${localizeThinkingLevelLabel(level)}\n可用等级 ${localizeThinkingOptions(resolvedProvider, resolvedModel)}`
          : `Current thinking level: ${level}.\nOptions: ${formatThinkingLevels(resolvedProvider, resolvedModel)}.`,
      };
    }
    return {
      text: isChineseSurface
        ? `🦞 无法识别思考等级“${directives.rawThinkLevel}”\n可用等级 ${localizeThinkingOptions(resolvedProvider, resolvedModel)}`
        : `Unrecognized thinking level "${directives.rawThinkLevel}". Valid levels: ${formatThinkingLevels(resolvedProvider, resolvedModel)}.`,
    };
  }
  if (directives.hasVerboseDirective && !directives.verboseLevel) {
    if (!directives.rawVerboseLevel) {
      const level = currentVerboseLevel ?? "off";
      return {
        text: isChineseSurface
          ? `🦞 当前详细级别 ${localizeVerboseLevelLabel(level)}\n可用等级 ${formatEnglishOptions(["on", "full", "off"])}`
          : `Current verbose level: ${level}.\nOptions: on, full, off.`,
      };
    }
    return {
      text: isChineseSurface
        ? `🦞 无法识别详细级别“${directives.rawVerboseLevel}”\n可用等级 ${formatEnglishOptions(["off", "on", "full"])}`
        : `Unrecognized verbose level "${directives.rawVerboseLevel}". Valid levels: off, on, full.`,
    };
  }
  if (directives.hasFastDirective && directives.fastMode === undefined) {
    if (!directives.rawFastMode) {
      const sourceSuffix =
        effectiveFastModeSource === "config"
          ? " (config)"
          : effectiveFastModeSource === "default"
            ? " (default)"
            : "";
      return {
        text: isChineseSurface
          ? `🦞 当前快速模式 ${localizeFastModeLabel(effectiveFastMode ? "on" : "off")}${
              effectiveFastModeSource === "config"
                ? " 配置"
                : effectiveFastModeSource === "default"
                  ? " 默认"
                  : ""
            }\n可用值 ${formatEnglishOptions(["on", "off"])}`
          : `Current fast mode: ${effectiveFastMode ? "on" : "off"}${sourceSuffix}.\nOptions: on, off.`,
      };
    }
    return {
      text: isChineseSurface
        ? `🦞 无法识别快速模式“${directives.rawFastMode}”\n可用值 ${formatEnglishOptions(["on", "off"])}`
        : `Unrecognized fast mode "${directives.rawFastMode}". Valid levels: on, off.`,
    };
  }
  if (directives.hasReasoningDirective && !directives.reasoningLevel) {
    if (!directives.rawReasoningLevel) {
      const level = currentReasoningLevel ?? "off";
      return {
        text: isChineseSurface
          ? `🦞 当前推理可见性 ${localizeReasoningLevelLabel(level)}\n可用值 ${formatEnglishOptions(["on", "off", "stream"])}`
          : `Current reasoning level: ${level}.\nOptions: on, off, stream.`,
      };
    }
    return {
      text: isChineseSurface
        ? `🦞 无法识别推理可见性“${directives.rawReasoningLevel}”\n可用值 ${formatEnglishOptions(["on", "off", "stream"])}`
        : `Unrecognized reasoning level "${directives.rawReasoningLevel}". Valid levels: on, off, stream.`,
    };
  }
  if (directives.hasElevatedDirective && !directives.elevatedLevel) {
    if (!directives.rawElevatedLevel) {
      if (!elevatedEnabled || !elevatedAllowed) {
        return {
          text: formatElevatedUnavailableText({
            runtimeSandboxed: runtimeIsSandboxed,
            failures: params.elevatedFailures,
            sessionKey: params.sessionKey,
          }),
        };
      }
      const level = currentElevatedLevel ?? "off";
      return {
        text: isChineseSurface
          ? [
              `🦞 当前提权级别 ${localizeElevatedLevelLabel(level)}`,
              `可用值 ${formatEnglishOptions(["on", "off", "ask", "full"])}`,
              shouldHintDirectRuntime ? "当前为直连运行时 沙箱不适用" : null,
            ]
              .filter(Boolean)
              .join("\n")
          : [
              `Current elevated level: ${level}.`,
              "Options: on, off, ask, full.",
              shouldHintDirectRuntime ? formatElevatedRuntimeHint() : null,
            ]
              .filter(Boolean)
              .join("\n"),
      };
    }
    return {
      text: isChineseSurface
        ? `🦞 无法识别提权级别“${directives.rawElevatedLevel}”\n可用值 ${formatEnglishOptions(["off", "on", "ask", "full"])}`
        : `Unrecognized elevated level "${directives.rawElevatedLevel}". Valid levels: off, on, ask, full.`,
    };
  }
  if (directives.hasElevatedDirective && (!elevatedEnabled || !elevatedAllowed)) {
    return {
      text: formatElevatedUnavailableText({
        runtimeSandboxed: runtimeIsSandboxed,
        failures: params.elevatedFailures,
        sessionKey: params.sessionKey,
      }),
    };
  }
  if (directives.hasExecDirective) {
    if (directives.invalidExecHost) {
      return {
        text: isChineseSurface
          ? `🦞 无法识别执行主机“${directives.rawExecHost ?? ""}”\n可用值 ${formatEnglishOptions(["sandbox", "gateway", "node"])}`
          : `Unrecognized exec host "${directives.rawExecHost ?? ""}". Valid hosts: sandbox, gateway, node.`,
      };
    }
    if (directives.invalidExecSecurity) {
      return {
        text: isChineseSurface
          ? `🦞 无法识别执行安全策略“${directives.rawExecSecurity ?? ""}”\n可用值 ${formatEnglishOptions(["deny", "allowlist", "full"])}`
          : `Unrecognized exec security "${directives.rawExecSecurity ?? ""}". Valid: deny, allowlist, full.`,
      };
    }
    if (directives.invalidExecAsk) {
      return {
        text: isChineseSurface
          ? `🦞 无法识别执行询问策略“${directives.rawExecAsk ?? ""}”\n可用值 ${formatEnglishOptions(["off", "on-miss", "always"])}`
          : `Unrecognized exec ask "${directives.rawExecAsk ?? ""}". Valid: off, on-miss, always.`,
      };
    }
    if (directives.invalidExecNode) {
      return {
        text: isChineseSurface ? "🦞 执行节点需要填写具体值" : "Exec node requires a value.",
      };
    }
    if (!directives.hasExecOptions) {
      const execDefaults = resolveExecDefaults({
        cfg: params.cfg,
        sessionEntry,
        agentId: activeAgentId,
      });
      const nodeLabel = execDefaults.node ? `node=${execDefaults.node}` : "node=(unset)";
      const nodeLabelZh = execDefaults.node ? `节点=${execDefaults.node}` : "节点=未设置";
      return {
        text: isChineseSurface
          ? `🦞 当前执行默认值 主机=${localizeExecHostLabel(execDefaults.host)} 安全策略=${localizeExecSecurityLabel(execDefaults.security)} 询问策略=${localizeExecAskLabel(execDefaults.ask)} ${nodeLabelZh}\n可用参数 host=sandbox|gateway|node security=deny|allowlist|full ask=off|on-miss|always node=<id>`
          : `Current exec defaults: host=${execDefaults.host}, security=${execDefaults.security}, ask=${execDefaults.ask}, ${nodeLabel}.\nOptions: host=sandbox|gateway|node, security=deny|allowlist|full, ask=off|on-miss|always, node=<id>.`,
      };
    }
  }

  const queueAck = maybeHandleQueueDirective({
    directives,
    cfg: params.cfg,
    channel: provider,
    sessionEntry,
  });
  if (queueAck) {
    return queueAck;
  }

  if (
    directives.hasThinkDirective &&
    directives.thinkLevel === "xhigh" &&
    !supportsXHighThinking(resolvedProvider, resolvedModel)
  ) {
    return {
      text: isChineseSurface
        ? `🦞 思考等级“xhigh”仅支持 ${formatXHighModelHint()}`
        : `Thinking level "xhigh" is only supported for ${formatXHighModelHint()}.`,
    };
  }

  const nextThinkLevel = directives.hasThinkDirective
    ? directives.thinkLevel
    : ((sessionEntry?.thinkingLevel as ThinkLevel | undefined) ?? currentThinkLevel);
  const shouldDowngradeXHigh =
    !directives.hasThinkDirective &&
    nextThinkLevel === "xhigh" &&
    !supportsXHighThinking(resolvedProvider, resolvedModel);

  const prevElevatedLevel =
    currentElevatedLevel ??
    (sessionEntry.elevatedLevel as ElevatedLevel | undefined) ??
    (elevatedAllowed ? ("on" as ElevatedLevel) : ("off" as ElevatedLevel));
  const prevReasoningLevel =
    currentReasoningLevel ?? (sessionEntry.reasoningLevel as ReasoningLevel | undefined) ?? "off";
  let elevatedChanged =
    directives.hasElevatedDirective &&
    directives.elevatedLevel !== undefined &&
    elevatedEnabled &&
    elevatedAllowed;
  const fastModeChanged =
    directives.hasFastDirective &&
    directives.fastMode !== undefined &&
    directives.fastMode !== currentFastMode;
  let reasoningChanged =
    directives.hasReasoningDirective && directives.reasoningLevel !== undefined;
  if (directives.hasThinkDirective && directives.thinkLevel) {
    sessionEntry.thinkingLevel = directives.thinkLevel;
  }
  if (directives.hasFastDirective && directives.fastMode !== undefined) {
    sessionEntry.fastMode = directives.fastMode;
  }
  if (shouldDowngradeXHigh) {
    sessionEntry.thinkingLevel = "high";
  }
  if (directives.hasVerboseDirective && directives.verboseLevel) {
    applyVerboseOverride(sessionEntry, directives.verboseLevel);
  }
  if (directives.hasReasoningDirective && directives.reasoningLevel) {
    if (directives.reasoningLevel === "off") {
      // Persist explicit off so it overrides model-capability defaults.
      sessionEntry.reasoningLevel = "off";
    } else {
      sessionEntry.reasoningLevel = directives.reasoningLevel;
    }
    reasoningChanged =
      directives.reasoningLevel !== prevReasoningLevel && directives.reasoningLevel !== undefined;
  }
  if (directives.hasElevatedDirective && directives.elevatedLevel) {
    // Unlike other toggles, elevated defaults can be "on".
    // Persist "off" explicitly so `/elevated off` actually overrides defaults.
    sessionEntry.elevatedLevel = directives.elevatedLevel;
    elevatedChanged =
      elevatedChanged ||
      (directives.elevatedLevel !== prevElevatedLevel && directives.elevatedLevel !== undefined);
  }
  if (directives.hasExecDirective && directives.hasExecOptions) {
    if (directives.execHost) {
      sessionEntry.execHost = directives.execHost;
    }
    if (directives.execSecurity) {
      sessionEntry.execSecurity = directives.execSecurity;
    }
    if (directives.execAsk) {
      sessionEntry.execAsk = directives.execAsk;
    }
    if (directives.execNode) {
      sessionEntry.execNode = directives.execNode;
    }
  }
  if (modelSelection) {
    applyModelOverrideToSessionEntry({
      entry: sessionEntry,
      selection: modelSelection,
      profileOverride,
    });
  }
  if (directives.hasQueueDirective && directives.queueReset) {
    delete sessionEntry.queueMode;
    delete sessionEntry.queueDebounceMs;
    delete sessionEntry.queueCap;
    delete sessionEntry.queueDrop;
  } else if (directives.hasQueueDirective) {
    if (directives.queueMode) {
      sessionEntry.queueMode = directives.queueMode;
    }
    if (typeof directives.debounceMs === "number") {
      sessionEntry.queueDebounceMs = directives.debounceMs;
    }
    if (typeof directives.cap === "number") {
      sessionEntry.queueCap = directives.cap;
    }
    if (directives.dropPolicy) {
      sessionEntry.queueDrop = directives.dropPolicy;
    }
  }
  sessionEntry.updatedAt = Date.now();
  sessionStore[sessionKey] = sessionEntry;
  if (storePath) {
    await updateSessionStore(storePath, (store) => {
      store[sessionKey] = sessionEntry;
    });
  }
  if (modelSelection) {
    const nextLabel = `${modelSelection.provider}/${modelSelection.model}`;
    if (nextLabel !== initialModelLabel) {
      enqueueSystemEvent(formatModelSwitchEvent(nextLabel, modelSelection.alias), {
        sessionKey,
        contextKey: `model:${nextLabel}`,
      });
    }
  }
  enqueueModeSwitchEvents({
    enqueueSystemEvent,
    sessionEntry,
    sessionKey,
    elevatedChanged,
    reasoningChanged,
  });

  const parts: string[] = [];
  if (directives.hasThinkDirective && directives.thinkLevel) {
    parts.push(
      directives.thinkLevel === "off"
        ? isChineseSurface
          ? "已关闭思考模式"
          : "Thinking disabled."
        : isChineseSurface
          ? `已将思考等级设为 ${localizeThinkingLevelLabel(directives.thinkLevel)}`
          : `Thinking level set to ${directives.thinkLevel}.`,
    );
  }
  if (directives.hasFastDirective && directives.fastMode !== undefined) {
    parts.push(
      directives.fastMode
        ? isChineseSurface
          ? "快速模式已开启"
          : formatDirectiveAck("Fast mode enabled.")
        : isChineseSurface
          ? "快速模式已关闭"
          : formatDirectiveAck("Fast mode disabled."),
    );
  }
  if (directives.hasVerboseDirective && directives.verboseLevel) {
    parts.push(
      directives.verboseLevel === "off"
        ? isChineseSurface
          ? "详细日志已关闭"
          : formatDirectiveAck("Verbose logging disabled.")
        : directives.verboseLevel === "full"
          ? isChineseSurface
            ? `详细日志已设为 ${localizeVerboseLevelLabel("full")}`
            : formatDirectiveAck("Verbose logging set to full.")
          : isChineseSurface
            ? "详细日志已开启"
            : formatDirectiveAck("Verbose logging enabled."),
    );
  }
  if (directives.hasReasoningDirective && directives.reasoningLevel) {
    parts.push(
      directives.reasoningLevel === "off"
        ? isChineseSurface
          ? "推理可见性已关闭"
          : formatDirectiveAck("Reasoning visibility disabled.")
        : directives.reasoningLevel === "stream"
          ? isChineseSurface
            ? "推理流已开启 仅 Telegram"
            : formatDirectiveAck("Reasoning stream enabled (Telegram only).")
          : isChineseSurface
            ? "推理可见性已开启"
            : formatDirectiveAck("Reasoning visibility enabled."),
    );
  }
  if (directives.hasElevatedDirective && directives.elevatedLevel) {
    parts.push(
      directives.elevatedLevel === "off"
        ? isChineseSurface
          ? "提权模式已关闭"
          : formatDirectiveAck("Elevated mode disabled.")
        : directives.elevatedLevel === "full"
          ? isChineseSurface
            ? "提权模式已设为完整 自动批准"
            : formatDirectiveAck("Elevated mode set to full (auto-approve).")
          : isChineseSurface
            ? "提权模式已设为询问 仍可能需要批准"
            : formatDirectiveAck("Elevated mode set to ask (approvals may still apply)."),
    );
    if (shouldHintDirectRuntime) {
      parts.push(isChineseSurface ? "当前为直连运行时 沙箱不适用" : formatElevatedRuntimeHint());
    }
  }
  if (directives.hasExecDirective && directives.hasExecOptions) {
    const execParts: string[] = [];
    const execPartsZh: string[] = [];
    if (directives.execHost) {
      execParts.push(`host=${directives.execHost}`);
      execPartsZh.push(`主机=${localizeExecHostLabel(directives.execHost)}`);
    }
    if (directives.execSecurity) {
      execParts.push(`security=${directives.execSecurity}`);
      execPartsZh.push(`安全策略=${localizeExecSecurityLabel(directives.execSecurity)}`);
    }
    if (directives.execAsk) {
      execParts.push(`ask=${directives.execAsk}`);
      execPartsZh.push(`询问策略=${localizeExecAskLabel(directives.execAsk)}`);
    }
    if (directives.execNode) {
      execParts.push(`node=${directives.execNode}`);
      execPartsZh.push(`节点=${directives.execNode}`);
    }
    if (execParts.length > 0) {
      parts.push(
        isChineseSurface
          ? `执行默认值已设置 ${execPartsZh.join(" ")}`
          : formatDirectiveAck(`Exec defaults set (${execParts.join(", ")}).`),
      );
    }
  }
  if (shouldDowngradeXHigh) {
    parts.push(
      isChineseSurface
        ? `已将思考等级设为高 ${resolvedProvider}/${resolvedModel} 不支持 xhigh`
        : `Thinking level set to high (xhigh not supported for ${resolvedProvider}/${resolvedModel}).`,
    );
  }
  if (modelSelection) {
    const label = `${modelSelection.provider}/${modelSelection.model}`;
    const labelWithAlias = modelSelection.alias ? `${modelSelection.alias} (${label})` : label;
    parts.push(
      modelSelection.isDefault
        ? isChineseSurface
          ? `模型已重置为默认值 ${labelWithAlias}`
          : `Model reset to default (${labelWithAlias}).`
        : isChineseSurface
          ? `模型已切换为 ${labelWithAlias}`
          : `Model set to ${labelWithAlias}.`,
    );
    if (profileOverride) {
      parts.push(
        isChineseSurface
          ? `认证配置已切换为 ${profileOverride}`
          : `Auth profile set to ${profileOverride}.`,
      );
    }
  }
  if (directives.hasQueueDirective && directives.queueMode) {
    parts.push(
      isChineseSurface
        ? `队列模式已设为 ${localizeQueueModeLabel(directives.queueMode)}`
        : formatDirectiveAck(`Queue mode set to ${directives.queueMode}.`),
    );
  } else if (directives.hasQueueDirective && directives.queueReset) {
    parts.push(
      isChineseSurface
        ? "队列模式已重置为默认值"
        : formatDirectiveAck("Queue mode reset to default."),
    );
  }
  if (directives.hasQueueDirective && typeof directives.debounceMs === "number") {
    parts.push(
      isChineseSurface
        ? `队列防抖已设为 ${formatDurationZh(directives.debounceMs)}`
        : formatDirectiveAck(`Queue debounce set to ${directives.debounceMs}ms.`),
    );
  }
  if (directives.hasQueueDirective && typeof directives.cap === "number") {
    parts.push(
      isChineseSurface
        ? `队列上限已设为 ${directives.cap}`
        : formatDirectiveAck(`Queue cap set to ${directives.cap}.`),
    );
  }
  if (directives.hasQueueDirective && directives.dropPolicy) {
    parts.push(
      isChineseSurface
        ? `队列丢弃策略已设为 ${localizeQueueDropLabel(directives.dropPolicy)}`
        : formatDirectiveAck(`Queue drop set to ${directives.dropPolicy}.`),
    );
  }
  if (fastModeChanged) {
    enqueueSystemEvent(
      isChineseSurface
        ? `🦞 快速模式已${sessionEntry.fastMode ? "开启" : "关闭"}`
        : `Fast mode ${sessionEntry.fastMode ? "enabled" : "disabled"}.`,
      {
        sessionKey,
        contextKey: `fast:${sessionEntry.fastMode ? "on" : "off"}`,
      },
    );
  }
  const ack = parts.join(" ").trim();
  if (!ack && directives.hasStatusDirective) {
    return undefined;
  }
  if (!ack) {
    return { text: "OK." };
  }
  return { text: isChineseSurface ? `🦞 ${ack}` : ack };
}
