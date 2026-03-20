import type { GatewayBrowserClient } from "../gateway.ts";
import type { HealthSnapshot, StatusSummary } from "../types.ts";

export type DebugBuildResult = {
  ok: boolean;
  code: number;
  durationMs: number;
  cwd: string | null;
  command: string;
  stdoutTail: string;
  stderrTail: string;
  truncated: boolean;
};

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
  debugBuildRunning: boolean;
  debugBuildResult: DebugBuildResult | null;
  debugBuildError: string | null;
  debugRestarting: boolean;
};

export async function loadDebug(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  try {
    const [status, health, models, heartbeat] = await Promise.all([
      state.client.request("status", {}),
      state.client.request("health", {}),
      state.client.request("models.list", {}),
      state.client.request("last-heartbeat", {}),
    ]);
    state.debugStatus = status as StatusSummary;
    state.debugHealth = health as HealthSnapshot;
    const modelPayload = models as { models?: unknown[] } | undefined;
    state.debugModels = Array.isArray(modelPayload?.models) ? modelPayload?.models : [];
    state.debugHeartbeat = heartbeat;
  } catch (err) {
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function callDebugMethod(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}

export async function restartGateway(state: DebugState) {
  if (!state.client || !state.connected || state.debugRestarting) {
    return;
  }
  state.debugRestarting = true;
  state.debugCallError = null;
  try {
    await state.client.request("gateway.restart", {});
  } catch (err) {
    state.debugCallError = String(err);
    state.debugRestarting = false;
  }
}

export async function runGatewayBuild(state: DebugState) {
  if (!state.client || !state.connected || state.debugBuildRunning) {
    return;
  }
  state.debugBuildRunning = true;
  state.debugBuildError = null;
  state.debugBuildResult = null;
  try {
    const result = await state.client.request("gateway.build", {});
    state.debugBuildResult = result as DebugBuildResult;
  } catch (err) {
    state.debugBuildError = String(err);
  } finally {
    state.debugBuildRunning = false;
  }
}
