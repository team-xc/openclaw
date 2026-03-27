import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { EventLogEntry } from "../app-events.ts";
import type { DebugBuildResult } from "../controllers/debug.ts";
import { formatEventPayload } from "../presenter.ts";

export type DebugProps = {
  loading: boolean;
  status: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  models: unknown[];
  heartbeat: unknown;
  eventLog: EventLogEntry[];
  methods: string[];
  callMethod: string;
  callParams: string;
  callResult: string | null;
  callError: string | null;
  buildRunning: boolean;
  buildResult: DebugBuildResult | null;
  buildError: string | null;
  onCallMethodChange: (next: string) => void;
  onCallParamsChange: (next: string) => void;
  onRefresh: () => void;
  onCall: () => void;
};

export function renderDebug(props: DebugProps) {
  const securityAudit =
    props.status && typeof props.status === "object"
      ? (props.status as { securityAudit?: { summary?: Record<string, number> } }).securityAudit
      : null;
  const securitySummary = securityAudit?.summary ?? null;
  const critical = securitySummary?.critical ?? 0;
  const warn = securitySummary?.warn ?? 0;
  const info = securitySummary?.info ?? 0;
  const securityTone = critical > 0 ? "danger" : warn > 0 ? "warn" : "success";
  const securityLabel =
    critical > 0
      ? t("debug.securityCritical", { count: String(critical) })
      : warn > 0
        ? t("debug.securityWarnings", { count: String(warn) })
        : t("debug.securityNoCritical");
  const securityInfoLabel =
    info > 0 ? ` · ${t("debug.securityInfo", { count: String(info) })}` : "";
  const buildTone = props.buildResult
    ? props.buildResult.ok
      ? "success"
      : "danger"
    : props.buildError
      ? "danger"
      : "warn";

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">${t("debug.snapshotsTitle")}</div>
            <div class="card-sub">${t("debug.snapshotsSubtitle")}</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? t("debug.refreshing") : t("common.refresh")}
          </button>
        </div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="muted">${t("debug.status")}</div>
            ${
              securitySummary
                ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                  ${t("debug.securityAuditPrefix")} ${securityLabel}${securityInfoLabel}. ${t("debug.securityAuditRun")}
                  <span class="mono">openclaw security audit --deep</span> ${t("debug.securityAuditSuffix")}
                </div>`
                : nothing
            }
            <pre class="code-block">${JSON.stringify(props.status ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">${t("common.health")}</div>
            <pre class="code-block">${JSON.stringify(props.health ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">${t("debug.lastHeartbeat")}</div>
            <pre class="code-block">${JSON.stringify(props.heartbeat ?? {}, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${t("debug.manualRpcTitle")}</div>
        <div class="card-sub">${t("debug.manualRpcSubtitle")}</div>
        <div class="stack" style="margin-top: 16px;">
          <label class="field">
            <span>${t("debug.method")}</span>
            <select
              .value=${props.callMethod}
              @change=${(e: Event) => props.onCallMethodChange((e.target as HTMLSelectElement).value)}
            >
              ${
                !props.callMethod
                  ? html`
                      <option value="" disabled>${t("debug.selectMethod")}</option>
                    `
                  : nothing
              }
              ${props.methods.map((m) => html`<option value=${m}>${m}</option>`)}
            </select>
          </label>
          <label class="field">
            <span>${t("debug.paramsJson")}</span>
            <textarea
              .value=${props.callParams}
              @input=${(e: Event) =>
                props.onCallParamsChange((e.target as HTMLTextAreaElement).value)}
              rows="6"
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" @click=${props.onCall}>${t("debug.call")}</button>
        </div>
        ${
          props.callError
            ? html`<div class="callout danger" style="margin-top: 12px;">
              ${props.callError}
            </div>`
            : nothing
        }
        ${
          props.callResult
            ? html`<pre class="code-block" style="margin-top: 12px;">${props.callResult}</pre>`
            : nothing
        }
      </div>
    </section>

    ${
      props.buildRunning || props.buildResult || props.buildError
        ? html`
            <section class="card" style="margin-top: 18px;">
              <div class="card-title">${t("debug.buildStatusTitle")}</div>
              <div class="card-sub">${t("debug.buildStatusSubtitle")}</div>
              <div class="stack" style="margin-top: 12px;">
                ${
                  props.buildRunning
                    ? html`
                        <div class="callout warn">${t("debug.buildInProgress")}</div>
                      `
                    : nothing
                }
                ${
                  props.buildError
                    ? html`<div class="callout danger">${props.buildError}</div>`
                    : nothing
                }
                ${
                  props.buildResult
                    ? html`
                        <div class="callout ${buildTone}">
                          ${props.buildResult.ok ? t("debug.buildCompleted") : t("debug.buildFailed")}
                        </div>
                        <div class="list" style="margin-top: 8px;">
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">${t("debug.command")}</div>
                              <div class="list-sub mono">${props.buildResult.command}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">${t("debug.workingDirectory")}</div>
                              <div class="list-sub mono">${props.buildResult.cwd ?? t("common.na")}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">${t("debug.exitCode")}</div>
                              <div class="list-sub mono">${String(props.buildResult.code)}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">${t("debug.duration")}</div>
                              <div class="list-sub mono">${String(props.buildResult.durationMs)} ms</div>
                            </div>
                          </div>
                        </div>
                        ${
                          props.buildResult.stdoutTail
                            ? html`
                                <div>
                                  <div class="muted">${t("debug.stdoutTail")}</div>
                                  <pre class="code-block">${props.buildResult.stdoutTail}</pre>
                                </div>
                              `
                            : nothing
                        }
                        ${
                          props.buildResult.stderrTail
                            ? html`
                                <div>
                                  <div class="muted">${t("debug.stderrTail")}</div>
                                  <pre class="code-block">${props.buildResult.stderrTail}</pre>
                                </div>
                              `
                            : nothing
                        }
                        ${
                          props.buildResult.truncated
                            ? html`
                                <div class="muted">${t("debug.outputTruncated")}</div>
                              `
                            : nothing
                        }
                      `
                    : nothing
                }
              </div>
            </section>
          `
        : nothing
    }

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${t("debug.modelsTitle")}</div>
      <div class="card-sub">${t("debug.modelsSubtitle")}</div>
      <pre class="code-block" style="margin-top: 12px;">${JSON.stringify(
        props.models ?? [],
        null,
        2,
      )}</pre>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${t("debug.eventLogTitle")}</div>
      <div class="card-sub">${t("debug.eventLogSubtitle")}</div>
      ${
        props.eventLog.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">${t("debug.noEvents")}</div>
            `
          : html`
            <div class="list debug-event-log" style="margin-top: 12px;">
              ${props.eventLog.map(
                (evt) => html`
                  <div class="list-item debug-event-log__item">
                    <div class="list-main">
                      <div class="list-title">${evt.event}</div>
                      <div class="list-sub">${new Date(evt.ts).toLocaleTimeString()}</div>
                    </div>
                    <div class="list-meta debug-event-log__meta">
                      <pre class="code-block debug-event-log__payload">${formatEventPayload(
                        evt.payload,
                      )}</pre>
                    </div>
                  </div>
                `,
              )}
            </div>
          `
      }
    </section>
  `;
}
