import {
  findModelInCatalog,
  loadModelCatalog,
  modelSupportsVision,
} from "../agents/model-catalog.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { hasControlCommand } from "../auto-reply/command-detection.js";
import {
  recordPendingHistoryEntryIfEnabled,
  type HistoryEntry,
} from "../auto-reply/reply/history.js";
import {
  buildMentionRegexes,
  matchesMentionWithExplicit,
  stripMentions,
} from "../auto-reply/reply/mentions.js";
import type { MsgContext } from "../auto-reply/templating.js";
import { resolveControlCommandGate } from "../channels/command-gating.js";
import { formatLocationText, type NormalizedLocation } from "../channels/location.js";
import { logInboundDrop } from "../channels/logging.js";
import { resolveMentionGatingWithBypass } from "../channels/mention-gating.js";
import type { TypingCallbacks } from "../channels/typing.js";
import type { OpenClawConfig } from "../config/config.js";
import type {
  TelegramDirectConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "../config/types.js";
import { logVerbose } from "../globals.js";
import type { NormalizedAllowFrom } from "./bot-access.js";
import { isSenderAllowed } from "./bot-access.js";
import type {
  TelegramLogger,
  TelegramMediaRef,
  TelegramMessageContextOptions,
} from "./bot-message-context.types.js";
import {
  buildSenderLabel,
  buildTelegramGroupPeerId,
  expandTextLinks,
  extractTelegramLocation,
  getTelegramTextParts,
  hasBotMention,
  resolveTelegramMediaPlaceholder,
} from "./bot/helpers.js";
import type { TelegramContext } from "./bot/types.js";
import { isTelegramForumServiceMessage } from "./forum-service-message.js";

export type TelegramInboundBodyResult = {
  bodyText: string;
  rawBody: string;
  historyKey?: string;
  commandAuthorized: boolean;
  effectiveWasMentioned: boolean;
  explicitInvokeForTyping: boolean;
  earlyFeedbackEligible: boolean;
  canDetectMention: boolean;
  shouldBypassMention: boolean;
  stickerCacheHit: boolean;
  locationData?: NormalizedLocation;
};

async function resolveStickerVisionSupport(params: {
  cfg: OpenClawConfig;
  agentId?: string;
}): Promise<boolean> {
  try {
    const catalog = await loadModelCatalog({ config: params.cfg });
    const defaultModel = resolveDefaultModelForAgent({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    const entry = findModelInCatalog(catalog, defaultModel.provider, defaultModel.model);
    if (!entry) {
      return false;
    }
    return modelSupportsVision(entry);
  } catch {
    return false;
  }
}

function hasMeaningfulTelegramUserText(params: {
  rawText: string;
  cfg: OpenClawConfig;
  agentId?: string;
  botUsername?: string;
}): boolean {
  const stripped = stripMentions(
    params.rawText,
    {
      Provider: "telegram",
      Surface: "telegram",
      BotUsername: params.botUsername,
    },
    params.cfg,
    params.agentId,
  );
  const withoutBareMentions = stripped.replace(/(^|\s)@+(?=\s|$)/g, " ").trim();
  return withoutBareMentions.length > 0;
}

export async function resolveTelegramInboundBody(params: {
  cfg: OpenClawConfig;
  primaryCtx: TelegramContext;
  msg: TelegramContext["message"];
  allMedia: TelegramMediaRef[];
  replyMedia?: TelegramMediaRef[];
  isGroup: boolean;
  chatId: number | string;
  senderId: string;
  senderUsername: string;
  resolvedThreadId?: number;
  routeAgentId?: string;
  effectiveGroupAllow: NormalizedAllowFrom;
  effectiveDmAllow: NormalizedAllowFrom;
  groupConfig?: TelegramGroupConfig | TelegramDirectConfig;
  topicConfig?: TelegramTopicConfig;
  requireMention?: boolean;
  options?: TelegramMessageContextOptions;
  groupHistories: Map<string, HistoryEntry[]>;
  historyLimit: number;
  logger: TelegramLogger;
  audioPreflightTyping?: Pick<TypingCallbacks, "onReplyStart" | "onCleanup">;
}): Promise<TelegramInboundBodyResult | null> {
  const {
    cfg,
    primaryCtx,
    msg,
    allMedia,
    replyMedia = [],
    isGroup,
    chatId,
    senderId,
    senderUsername,
    resolvedThreadId,
    routeAgentId,
    effectiveGroupAllow,
    effectiveDmAllow,
    groupConfig,
    topicConfig,
    requireMention,
    options,
    groupHistories,
    historyLimit,
    logger,
    audioPreflightTyping,
  } = params;
  const botUsername = primaryCtx.me?.username?.toLowerCase();
  const mentionRegexes = buildMentionRegexes(cfg, routeAgentId);
  const messageTextParts = getTelegramTextParts(msg);
  const allowForCommands = isGroup ? effectiveGroupAllow : effectiveDmAllow;
  const senderAllowedForCommands = isSenderAllowed({
    allow: allowForCommands,
    senderId,
    senderUsername,
  });
  const useAccessGroups = cfg.commands?.useAccessGroups !== false;
  const hasControlCommandInMessage = hasControlCommand(messageTextParts.text, cfg, {
    botUsername,
  });
  const commandGate = resolveControlCommandGate({
    useAccessGroups,
    authorizers: [{ configured: allowForCommands.hasEntries, allowed: senderAllowedForCommands }],
    allowTextCommands: true,
    hasControlCommand: hasControlCommandInMessage,
  });
  const commandAuthorized = commandGate.commandAuthorized;
  const historyKey = isGroup ? buildTelegramGroupPeerId(chatId, resolvedThreadId) : undefined;

  let placeholder = resolveTelegramMediaPlaceholder(msg) ?? "";
  const cachedStickerDescription = allMedia[0]?.stickerMetadata?.cachedDescription;
  const stickerSupportsVision = msg.sticker
    ? await resolveStickerVisionSupport({ cfg, agentId: routeAgentId })
    : false;
  const stickerCacheHit = Boolean(cachedStickerDescription) && !stickerSupportsVision;
  if (stickerCacheHit) {
    const emoji = allMedia[0]?.stickerMetadata?.emoji;
    const setName = allMedia[0]?.stickerMetadata?.setName;
    const stickerContext = [emoji, setName ? `from "${setName}"` : null].filter(Boolean).join(" ");
    placeholder = `[Sticker${stickerContext ? ` ${stickerContext}` : ""}] ${cachedStickerDescription}`;
  }

  const locationData = extractTelegramLocation(msg);
  const locationText = locationData ? formatLocationText(locationData) : undefined;
  const rawText = expandTextLinks(messageTextParts.text, messageTextParts.entities).trim();
  const hasMeaningfulUserText =
    hasMeaningfulTelegramUserText({
      rawText,
      cfg,
      agentId: routeAgentId,
      botUsername: primaryCtx.me?.username,
    }) || Boolean(locationText);
  let rawBody = [rawText, locationText].filter(Boolean).join("\n").trim();
  if (!rawBody) {
    rawBody = placeholder;
  }
  if (!rawBody && allMedia.length === 0) {
    return null;
  }

  let bodyText = rawBody;
  const audioPreflightMedia = [...allMedia, ...replyMedia];
  const hasAudio = audioPreflightMedia.some((media) => media.contentType?.startsWith("audio/"));
  const disableAudioPreflight =
    (topicConfig?.disableAudioPreflight ??
      (groupConfig as TelegramGroupConfig | undefined)?.disableAudioPreflight) === true;
  const hasAnyMention = messageTextParts.entities.some((ent) => ent.type === "mention");
  const explicitlyMentioned = botUsername ? hasBotMention(msg, botUsername) : false;
  const botId = primaryCtx.me?.id;
  const replyFromId = msg.reply_to_message?.from?.id;
  const replyToBotMessage = botId != null && replyFromId === botId;
  const isReplyToServiceMessage =
    replyToBotMessage && isTelegramForumServiceMessage(msg.reply_to_message);
  const implicitMention = replyToBotMessage && !isReplyToServiceMessage;

  let preflightTranscript: string | undefined;
  const needsPreflightTranscription =
    isGroup &&
    requireMention &&
    hasAudio &&
    !hasMeaningfulUserText &&
    mentionRegexes.length > 0 &&
    !disableAudioPreflight;
  const shouldShowAudioPreflightTyping =
    options?.forceWasMentioned === true || explicitlyMentioned || implicitMention;

  if (needsPreflightTranscription) {
    let preflightTypingStarted = false;
    try {
      if (shouldShowAudioPreflightTyping) {
        await audioPreflightTyping?.onReplyStart?.();
        preflightTypingStarted = true;
      }
      const { transcribeFirstAudio } = await import("../media-understanding/audio-preflight.js");
      const tempCtx: MsgContext = {
        MediaPaths:
          audioPreflightMedia.length > 0
            ? audioPreflightMedia.map((media) => media.path)
            : undefined,
        MediaTypes:
          audioPreflightMedia.length > 0
            ? (audioPreflightMedia.map((media) => media.contentType).filter(Boolean) as string[])
            : undefined,
      };
      preflightTranscript = await transcribeFirstAudio({
        ctx: tempCtx,
        cfg,
        agentDir: undefined,
      });
    } catch (err) {
      logVerbose(`telegram: audio preflight transcription failed: ${String(err)}`);
    } finally {
      if (preflightTypingStarted) {
        audioPreflightTyping?.onCleanup?.();
      }
    }
  }

  if (hasAudio && bodyText === "<media:audio>" && preflightTranscript) {
    bodyText = preflightTranscript;
  }

  if (!bodyText && allMedia.length > 0) {
    if (hasAudio) {
      bodyText = preflightTranscript || "<media:audio>";
    } else {
      bodyText = `<media:image>${allMedia.length > 1 ? ` (${allMedia.length} images)` : ""}`;
    }
  }

  const computedWasMentioned = matchesMentionWithExplicit({
    text: messageTextParts.text,
    mentionRegexes,
    explicit: {
      hasAnyMention,
      isExplicitlyMentioned: explicitlyMentioned,
      canResolveExplicit: Boolean(botUsername),
    },
    transcript: preflightTranscript,
  });
  const wasMentioned = options?.forceWasMentioned === true ? true : computedWasMentioned;
  const repliesToOtherParticipant = Boolean(msg.reply_to_message) && !replyToBotMessage;
  const earlyFeedbackEligible =
    wasMentioned || (isGroup && !requireMention && !hasAnyMention && !repliesToOtherParticipant);

  if (isGroup && !requireMention && !wasMentioned && repliesToOtherParticipant) {
    logger.info({ chatId, reason: "reply-to-other" }, "skipping group message");
    recordPendingHistoryEntryIfEnabled({
      historyMap: groupHistories,
      historyKey: historyKey ?? "",
      limit: historyLimit,
      entry: historyKey
        ? {
            sender: buildSenderLabel(msg, senderId || chatId),
            body: rawBody,
            timestamp: msg.date ? msg.date * 1000 : undefined,
            messageId: typeof msg.message_id === "number" ? String(msg.message_id) : undefined,
          }
        : null,
    });
    return null;
  }

  if (isGroup && commandGate.shouldBlock) {
    logInboundDrop({
      log: logVerbose,
      channel: "telegram",
      reason: "control command (unauthorized)",
      target: senderId ?? "unknown",
    });
    return null;
  }

  const canDetectMention = Boolean(botUsername) || mentionRegexes.length > 0;
  const mentionGate = resolveMentionGatingWithBypass({
    isGroup,
    requireMention: Boolean(requireMention),
    canDetectMention,
    wasMentioned,
    implicitMention: isGroup && Boolean(requireMention) && implicitMention,
    hasAnyMention,
    allowTextCommands: true,
    hasControlCommand: hasControlCommandInMessage,
    commandAuthorized,
  });
  const effectiveWasMentioned = mentionGate.effectiveWasMentioned;
  if (isGroup && requireMention && canDetectMention && mentionGate.shouldSkip) {
    logger.info({ chatId, reason: "no-mention" }, "skipping group message");
    recordPendingHistoryEntryIfEnabled({
      historyMap: groupHistories,
      historyKey: historyKey ?? "",
      limit: historyLimit,
      entry: historyKey
        ? {
            sender: buildSenderLabel(msg, senderId || chatId),
            body: rawBody,
            timestamp: msg.date ? msg.date * 1000 : undefined,
            messageId: typeof msg.message_id === "number" ? String(msg.message_id) : undefined,
          }
        : null,
    });
    return null;
  }

  return {
    bodyText,
    rawBody,
    historyKey,
    commandAuthorized,
    effectiveWasMentioned,
    explicitInvokeForTyping: shouldShowAudioPreflightTyping,
    earlyFeedbackEligible,
    canDetectMention,
    shouldBypassMention: mentionGate.shouldBypassMention,
    stickerCacheHit,
    locationData: locationData ?? undefined,
  };
}
