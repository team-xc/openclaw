import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { PresenceEntry } from "../types.ts";

export type PresenceState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
};

export async function loadPresence(state: PresenceState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.presenceLoading) {
    return;
  }
  state.presenceLoading = true;
  state.presenceError = null;
  state.presenceStatus = null;
  try {
    const res = await state.client.request("system-presence", {});
    if (Array.isArray(res)) {
      state.presenceEntries = res;
      state.presenceStatus = res.length === 0 ? t("instances.noInstancesYet") : null;
    } else {
      state.presenceEntries = [];
      state.presenceStatus = t("instances.noPresencePayload");
    }
  } catch (err) {
    state.presenceError = String(err);
  } finally {
    state.presenceLoading = false;
  }
}
