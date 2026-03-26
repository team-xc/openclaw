import { requireActivePluginRegistry } from "../plugins/runtime.js";
import type { ChannelMeta } from "./plugins/types.js";
import type { ChannelId } from "./plugins/types.js";

// Channel docking: add new core channels here (order + meta + aliases), then
// register the plugin in its extension entrypoint and keep protocol IDs in sync.
export const CHAT_CHANNEL_ORDER = ["telegram"] as const;

export type ChatChannelId = (typeof CHAT_CHANNEL_ORDER)[number];

export const CHANNEL_IDS: readonly ChatChannelId[] = [...CHAT_CHANNEL_ORDER];

export type ChatChannelMeta = ChannelMeta;

const CHAT_CHANNEL_META: Record<ChatChannelId, ChannelMeta> = {
  telegram: {
    id: "telegram",
    label: "Telegram",
    selectionLabel: "Telegram (Bot API)",
    detailLabel: "Telegram Bot",
    docsPath: "/channels/telegram",
    docsLabel: "telegram",
    blurb: "register a bot with @BotFather and use it as your private OpenClaw channel.",
    systemImage: "paperplane",
  },
};

export const CHAT_CHANNEL_ALIASES: Record<string, ChatChannelId> = {};

function buildFallbackChannelMeta(id: string): ChatChannelMeta {
  return {
    id,
    label: id,
    selectionLabel: id,
    detailLabel: id,
    docsPath: `/channels/${id}`,
    docsLabel: id,
    blurb: `${id} channel`,
  };
}

const normalizeChannelKey = (raw?: string | null): string | undefined => {
  const normalized = raw?.trim().toLowerCase();
  return normalized || undefined;
};

export function isChatChannelId(id: string): id is ChatChannelId {
  return CHAT_CHANNEL_ORDER.some((channelId) => channelId === id);
}

export function listChatChannels(): ChatChannelMeta[] {
  return CHAT_CHANNEL_ORDER.map((id) => CHAT_CHANNEL_META[id]);
}

export function listChatChannelAliases(): string[] {
  return Object.keys(CHAT_CHANNEL_ALIASES);
}

export function getChatChannelMeta(id: string): ChatChannelMeta {
  const normalized = normalizeChannelKey(id) ?? id;
  return isChatChannelId(normalized)
    ? CHAT_CHANNEL_META[normalized]
    : buildFallbackChannelMeta(normalized);
}

export function normalizeChatChannelId(raw?: string | null): ChatChannelId | null {
  const normalized = normalizeChannelKey(raw);
  if (!normalized) {
    return null;
  }
  const resolved = CHAT_CHANNEL_ALIASES[normalized] ?? normalized;
  return isChatChannelId(resolved) ? resolved : null;
}

// Channel docking: prefer this helper in shared code. Importing from
// `src/channels/plugins/*` can eagerly load channel implementations.
export function normalizeChannelId(raw?: string | null): ChatChannelId | null {
  return normalizeChatChannelId(raw);
}

// Normalizes registered channel plugins (bundled or external).
//
// Keep this light: we do not import channel plugins here (those are "heavy" and can pull in
// monitors, web login, etc). The plugin registry must be initialized first.
export function normalizeAnyChannelId(raw?: string | null): ChannelId | null {
  const key = normalizeChannelKey(raw);
  if (!key) {
    return null;
  }

  const registry = requireActivePluginRegistry();
  const hit = registry.channels.find((entry) => {
    const id = String(entry.plugin.id ?? "")
      .trim()
      .toLowerCase();
    if (id && id === key) {
      return true;
    }
    return (entry.plugin.meta.aliases ?? []).some((alias) => alias.trim().toLowerCase() === key);
  });
  return hit?.plugin.id ?? null;
}

export function formatChannelPrimerLine(meta: ChatChannelMeta): string {
  return `${meta.label}: ${meta.blurb}`;
}

export function formatChannelSelectionLine(
  meta: ChatChannelMeta,
  docsLink: (path: string, label?: string) => string,
): string {
  const docsPrefix = meta.selectionDocsPrefix ?? "Docs:";
  const docsLabel = meta.docsLabel ?? meta.id;
  const docs = meta.selectionDocsOmitLabel
    ? docsLink(meta.docsPath)
    : docsLink(meta.docsPath, docsLabel);
  const extras = (meta.selectionExtras ?? []).filter(Boolean).join(" ");
  return `${meta.label} — ${meta.blurb} ${docsPrefix ? `${docsPrefix} ` : ""}${docs}${extras ? ` ${extras}` : ""}`;
}
