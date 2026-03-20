import { html, nothing } from "lit";
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
    critical > 0 ? `${critical} critical` : warn > 0 ? `${warn} warnings` : "No critical issues";
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
            <div class="card-title">Snapshots</div>
            <div class="card-sub">Status, health, and heartbeat data.</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="muted">Status</div>
            ${
              securitySummary
                ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                  Security audit: ${securityLabel}${info > 0 ? ` · ${info} info` : ""}. Run
                  <span class="mono">openclaw security audit --deep</span> for details.
                </div>`
                : nothing
            }
            <pre class="code-block">${JSON.stringify(props.status ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Health</div>
            <pre class="code-block">${JSON.stringify(props.health ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Last heartbeat</div>
            <pre class="code-block">${JSON.stringify(props.heartbeat ?? {}, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Manual RPC</div>
        <div class="card-sub">Send a raw gateway method with JSON params.</div>
        <div class="stack" style="margin-top: 16px;">
          <label class="field">
            <span>Method</span>
            <select
              .value=${props.callMethod}
              @change=${(e: Event) => props.onCallMethodChange((e.target as HTMLSelectElement).value)}
            >
              ${
                !props.callMethod
                  ? html`
                      <option value="" disabled>Select a method…</option>
                    `
                  : nothing
              }
              ${props.methods.map((m) => html`<option value=${m}>${m}</option>`)}
            </select>
          </label>
          <label class="field">
            <span>Params (JSON)</span>
            <textarea
              .value=${props.callParams}
              @input=${(e: Event) =>
                props.onCallParamsChange((e.target as HTMLTextAreaElement).value)}
              rows="6"
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" @click=${props.onCall}>Call</button>
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
              <div class="card-title">Build Status</div>
              <div class="card-sub">Runs the fixed project build with Node 24 via nvm.</div>
              <div class="stack" style="margin-top: 12px;">
                ${
                  props.buildRunning
                    ? html`
                        <div class="callout warn">Build in progress…</div>
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
                          ${props.buildResult.ok ? "Build completed successfully" : "Build failed"}
                        </div>
                        <div class="list" style="margin-top: 8px;">
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">Command</div>
                              <div class="list-sub mono">${props.buildResult.command}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">Working directory</div>
                              <div class="list-sub mono">${props.buildResult.cwd ?? "n/a"}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">Exit code</div>
                              <div class="list-sub mono">${String(props.buildResult.code)}</div>
                            </div>
                          </div>
                          <div class="list-item">
                            <div class="list-main">
                              <div class="list-title">Duration</div>
                              <div class="list-sub mono">${String(props.buildResult.durationMs)} ms</div>
                            </div>
                          </div>
                        </div>
                        ${
                          props.buildResult.stdoutTail
                            ? html`
                                <div>
                                  <div class="muted">stdout (tail)</div>
                                  <pre class="code-block">${props.buildResult.stdoutTail}</pre>
                                </div>
                              `
                            : nothing
                        }
                        ${
                          props.buildResult.stderrTail
                            ? html`
                                <div>
                                  <div class="muted">stderr (tail)</div>
                                  <pre class="code-block">${props.buildResult.stderrTail}</pre>
                                </div>
                              `
                            : nothing
                        }
                        ${
                          props.buildResult.truncated
                            ? html`
                                <div class="muted">Output truncated to the most recent logs.</div>
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
      <div class="card-title">Models</div>
      <div class="card-sub">Catalog from models.list.</div>
      <pre class="code-block" style="margin-top: 12px;">${JSON.stringify(
        props.models ?? [],
        null,
        2,
      )}</pre>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Event Log</div>
      <div class="card-sub">Latest gateway events.</div>
      ${
        props.eventLog.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No events yet.</div>
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
