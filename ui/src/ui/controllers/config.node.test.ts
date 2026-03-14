import { describe, expect, it, vi } from "vitest";
import { saveConfig, type ConfigState } from "./config.ts";

function createState(): ConfigState {
  return {
    applySessionKey: "main",
    client: null,
    configActiveSection: null,
    configActiveSubsection: null,
    configApplying: false,
    configForm: null,
    configFormDirty: false,
    configFormMode: "form",
    configFormOriginal: null,
    configIssues: [],
    configLoading: false,
    configRaw: "",
    configRawOriginal: "",
    configSaving: false,
    configSchema: null,
    configSchemaLoading: false,
    configSchemaVersion: null,
    configSearchQuery: "",
    configSnapshot: null,
    configUiHints: {},
    configValid: null,
    connected: false,
    lastError: null,
    updateRunning: false,
  };
}

function createRequestWithConfigGet() {
  return vi.fn().mockImplementation(async (method: string) => {
    if (method === "config.get") {
      return { config: {}, valid: true, issues: [], raw: "{\n}\n" };
    }
    return {};
  });
}

describe("saveConfig (node)", () => {
  it("omits redundant Telegram top-level defaults for multi-account configs", async () => {
    const request = createRequestWithConfigGet();
    const state = createState();
    state.connected = true;
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormMode = "form";
    state.configForm = {
      channels: {
        telegram: {
          enabled: true,
          defaultAccount: "chat",
          dmPolicy: "pairing",
          groupPolicy: "allowlist",
          streaming: "partial",
          accounts: {
            chat: {
              dmPolicy: "allowlist",
              groupPolicy: "disabled",
            },
            debug: {
              dmPolicy: "allowlist",
              groupPolicy: "disabled",
            },
          },
        },
      },
    };
    state.configSchema = "invalid-schema";
    state.configSnapshot = { hash: "hash-save-telegram-defaults" };

    await saveConfig(state);

    expect(request.mock.calls[0]?.[0]).toBe("config.set");
    const params = request.mock.calls[0]?.[1] as { raw: string; baseHash: string };
    const parsed = JSON.parse(params.raw) as {
      channels: {
        telegram: Record<string, unknown>;
      };
    };
    expect(parsed.channels.telegram).toEqual({
      enabled: true,
      defaultAccount: "chat",
      accounts: {
        chat: {
          dmPolicy: "allowlist",
          groupPolicy: "disabled",
        },
        debug: {
          dmPolicy: "allowlist",
          groupPolicy: "disabled",
        },
      },
    });
    expect(params.baseHash).toBe("hash-save-telegram-defaults");
  });
});
