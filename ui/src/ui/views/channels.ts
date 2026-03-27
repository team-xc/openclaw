import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type {
  ChannelAccountSnapshot,
  ChannelUiMetaEntry,
  ChannelsStatusSnapshot,
  TelegramStatus,
} from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import { channelEnabled, renderChannelAccountCount } from "./channels.shared.ts";
import { renderTelegramCard } from "./channels.telegram.ts";
import type { ChannelKey, ChannelsChannelData, ChannelsProps } from "./channels.types.ts";

type StatusValue = "yes" | "no" | "active" | "na";

function renderStatusValue(value: StatusValue) {
  switch (value) {
    case "yes":
      return t("common.yes");
    case "no":
      return t("common.no");
    case "active":
      return t("common.active");
    default:
      return t("common.na");
  }
}

export function renderChannels(props: ChannelsProps) {
  const channels = props.snapshot?.channels as Record<string, unknown> | null;
  const telegram = (channels?.telegram ?? undefined) as TelegramStatus | undefined;
  const channelOrder = resolveChannelOrder(props.snapshot);
  const orderedChannels = channelOrder
    .map((key, index) => ({
      key,
      enabled: channelEnabled(key, props),
      order: index,
    }))
    .toSorted((a, b) => {
      if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
      }
      return a.order - b.order;
    });

  return html`
    <section class="grid grid-cols-2">
      ${orderedChannels.map((channel) =>
        renderChannel(channel.key, props, {
          telegram,
          channelAccounts: props.snapshot?.channelAccounts ?? null,
        }),
      )}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${t("channels.health.title")}</div>
          <div class="card-sub">${t("channels.health.subtitle")}</div>
        </div>
        <div class="muted">${props.lastSuccessAt ? formatRelativeTimestamp(props.lastSuccessAt) : t("common.na")}</div>
      </div>
      ${
        props.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${props.lastError}
          </div>`
          : nothing
      }
      <pre class="code-block" style="margin-top: 12px;">
${props.snapshot ? JSON.stringify(props.snapshot, null, 2) : t("channels.health.empty")}
      </pre>
    </section>
  `;
}

function resolveChannelOrder(snapshot: ChannelsStatusSnapshot | null): ChannelKey[] {
  if (snapshot?.channelMeta?.length) {
    const telegramOnly = snapshot.channelMeta
      .map((entry) => entry.id)
      .filter((entry) => entry === "telegram");
    if (telegramOnly.length > 0) {
      return telegramOnly;
    }
  }
  return ["telegram"];
}

function renderChannel(key: ChannelKey, props: ChannelsProps, data: ChannelsChannelData) {
  const accountCountLabel = renderChannelAccountCount(key, data.channelAccounts);
  switch (key) {
    case "telegram":
      return renderTelegramCard({
        props,
        telegram: data.telegram,
        telegramAccounts: data.channelAccounts?.telegram ?? [],
        accountCountLabel,
      });
    default:
      return renderGenericChannelCard(key, props, data.channelAccounts ?? {});
  }
}

function renderGenericChannelCard(
  key: ChannelKey,
  props: ChannelsProps,
  channelAccounts: Record<string, ChannelAccountSnapshot[]>,
) {
  const label = resolveChannelLabel(props.snapshot, key);
  const status = props.snapshot?.channels?.[key] as Record<string, unknown> | undefined;
  const configured = typeof status?.configured === "boolean" ? status.configured : undefined;
  const running = typeof status?.running === "boolean" ? status.running : undefined;
  const connected = typeof status?.connected === "boolean" ? status.connected : undefined;
  const lastError = typeof status?.lastError === "string" ? status.lastError : undefined;
  const accounts = channelAccounts[key] ?? [];
  const accountCountLabel = renderChannelAccountCount(key, channelAccounts);

  return html`
    <div class="card">
      <div class="card-title">${label}</div>
      <div class="card-sub">${t("channels.card.subtitle")}</div>
      ${accountCountLabel}

      ${
        accounts.length > 0
          ? html`
            <div class="account-card-list">
              ${accounts.map((account) => renderGenericAccount(account))}
            </div>
          `
          : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">${t("channels.status.configured")}</span>
                <span>${configured == null ? t("common.na") : configured ? t("common.yes") : t("common.no")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.running")}</span>
                <span>${running == null ? t("common.na") : running ? t("common.yes") : t("common.no")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.connected")}</span>
                <span>${connected == null ? t("common.na") : connected ? t("common.yes") : t("common.no")}</span>
              </div>
            </div>
          `
      }

      ${
        lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${lastError}
          </div>`
          : nothing
      }

      ${renderChannelConfigSection({ channelId: key, props })}
    </div>
  `;
}

function resolveChannelMetaMap(
  snapshot: ChannelsStatusSnapshot | null,
): Record<string, ChannelUiMetaEntry> {
  if (!snapshot?.channelMeta?.length) {
    return {};
  }
  return Object.fromEntries(snapshot.channelMeta.map((entry) => [entry.id, entry]));
}

function resolveChannelLabel(snapshot: ChannelsStatusSnapshot | null, key: string): string {
  const meta = resolveChannelMetaMap(snapshot)[key];
  return meta?.label ?? snapshot?.channelLabels?.[key] ?? key;
}

const RECENT_ACTIVITY_THRESHOLD_MS = 10 * 60 * 1000;

function hasRecentActivity(account: ChannelAccountSnapshot): boolean {
  if (!account.lastInboundAt) {
    return false;
  }
  return Date.now() - account.lastInboundAt < RECENT_ACTIVITY_THRESHOLD_MS;
}

function deriveRunningStatus(account: ChannelAccountSnapshot): StatusValue {
  if (account.running) {
    return "yes";
  }
  if (hasRecentActivity(account)) {
    return "active";
  }
  return "no";
}

function deriveConnectedStatus(account: ChannelAccountSnapshot): StatusValue {
  if (account.connected === true) {
    return "yes";
  }
  if (account.connected === false) {
    return "no";
  }
  if (hasRecentActivity(account)) {
    return "active";
  }
  return "na";
}

function renderGenericAccount(account: ChannelAccountSnapshot) {
  const runningStatus = deriveRunningStatus(account);
  const connectedStatus = deriveConnectedStatus(account);

  return html`
    <div class="account-card">
      <div class="account-card-header">
        <div class="account-card-title">${account.name || account.accountId}</div>
        <div class="account-card-id">${account.accountId}</div>
      </div>
      <div class="status-list account-card-status">
        <div>
          <span class="label">${t("channels.status.running")}</span>
          <span>${renderStatusValue(runningStatus)}</span>
        </div>
        <div>
          <span class="label">${t("channels.status.configured")}</span>
          <span>${account.configured ? t("common.yes") : t("common.no")}</span>
        </div>
        <div>
          <span class="label">${t("channels.status.connected")}</span>
          <span>${renderStatusValue(connectedStatus)}</span>
        </div>
        <div>
          <span class="label">${t("channels.status.lastInbound")}</span>
          <span>${account.lastInboundAt ? formatRelativeTimestamp(account.lastInboundAt) : t("common.na")}</span>
        </div>
        ${
          account.lastError
            ? html`
              <div class="account-card-error">
                ${account.lastError}
              </div>
            `
            : nothing
        }
      </div>
    </div>
  `;
}
