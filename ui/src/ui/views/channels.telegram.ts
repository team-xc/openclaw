import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { formatRelativeTimestamp } from "../format.ts";
import type { ChannelAccountSnapshot, TelegramStatus } from "../types.ts";
import { renderChannelConfigSection } from "./channels.config.ts";
import type { ChannelsProps } from "./channels.types.ts";

function renderBool(value: boolean) {
  return value ? t("common.yes") : t("common.no");
}

export function renderTelegramCard(params: {
  props: ChannelsProps;
  telegram?: TelegramStatus;
  telegramAccounts: ChannelAccountSnapshot[];
  accountCountLabel: unknown;
}) {
  const { props, telegram, telegramAccounts, accountCountLabel } = params;
  const hasMultipleAccounts = telegramAccounts.length > 1;

  const renderAccountCard = (account: ChannelAccountSnapshot) => {
    const probe = account.probe as { bot?: { username?: string } } | undefined;
    const botUsername = probe?.bot?.username;
    const label = account.name || account.accountId;
    return html`
      <div class="account-card">
        <div class="account-card-header">
          <div class="account-card-title">
            ${botUsername ? `@${botUsername}` : label}
          </div>
          <div class="account-card-id">${account.accountId}</div>
        </div>
        <div class="status-list account-card-status">
          <div>
            <span class="label">${t("channels.status.running")}</span>
            <span>${renderBool(account.running)}</span>
          </div>
          <div>
            <span class="label">${t("channels.status.configured")}</span>
            <span>${renderBool(account.configured)}</span>
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
  };

  return html`
    <div class="card">
      <div class="card-title">${t("channels.telegram.title")}</div>
      <div class="card-sub">${t("channels.telegram.subtitle")}</div>
      ${accountCountLabel}

      ${
        hasMultipleAccounts
          ? html`
            <div class="account-card-list">
              ${telegramAccounts.map((account) => renderAccountCard(account))}
            </div>
          `
          : html`
            <div class="status-list" style="margin-top: 16px;">
              <div>
                <span class="label">${t("channels.status.configured")}</span>
                <span>${telegram ? renderBool(Boolean(telegram.configured)) : t("common.na")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.running")}</span>
                <span>${telegram ? renderBool(Boolean(telegram.running)) : t("common.na")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.mode")}</span>
                <span>${telegram?.mode ?? t("common.na")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.lastStart")}</span>
                <span>${telegram?.lastStartAt ? formatRelativeTimestamp(telegram.lastStartAt) : t("common.na")}</span>
              </div>
              <div>
                <span class="label">${t("channels.status.lastProbe")}</span>
                <span>${telegram?.lastProbeAt ? formatRelativeTimestamp(telegram.lastProbeAt) : t("common.na")}</span>
              </div>
            </div>
          `
      }

      ${
        telegram?.lastError
          ? html`<div class="callout danger" style="margin-top: 12px;">
            ${telegram.lastError}
          </div>`
          : nothing
      }

      ${
        telegram?.probe
          ? html`<div class="callout" style="margin-top: 12px;">
            ${t("channels.probe.label")} ${telegram.probe.ok ? t("channels.probe.ok") : t("channels.probe.failed")} ·
            ${telegram.probe.status ?? ""} ${telegram.probe.error ?? ""}
          </div>`
          : nothing
      }

      ${renderChannelConfigSection({ channelId: "telegram", props })}

      <div class="row" style="margin-top: 12px;">
        <button class="btn" @click=${() => props.onRefresh(true)}>
          ${t("channels.probe.button")}
        </button>
      </div>
    </div>
  `;
}
