import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewaySessionRow } from "../types.ts";
import { executeSlashCommand } from "./slash-command-executor.ts";

function row(key: string, overrides?: Partial<GatewaySessionRow>): GatewaySessionRow {
  return {
    key,
    spawnedBy: overrides?.spawnedBy,
    kind: "direct",
    updatedAt: null,
    ...overrides,
  };
}

describe("executeSlashCommand /kill", () => {
  it("aborts every sub-agent session for /kill all", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("main"),
            row("agent:main:subagent:one", { spawnedBy: "main" }),
            row("agent:main:subagent:parent", { spawnedBy: "main" }),
            row("agent:main:subagent:parent:subagent:child", {
              spawnedBy: "agent:main:subagent:parent",
            }),
            row("agent:other:main"),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "kill",
      "all",
    );

    expect(result.content).toBe("🦞 已中断 3 个子代理会话");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "chat.abort", {
      sessionKey: "agent:main:subagent:one",
    });
    expect(request).toHaveBeenNthCalledWith(3, "chat.abort", {
      sessionKey: "agent:main:subagent:parent",
    });
    expect(request).toHaveBeenNthCalledWith(4, "chat.abort", {
      sessionKey: "agent:main:subagent:parent:subagent:child",
    });
  });

  it("aborts matching sub-agent sessions for /kill <agentId>", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:subagent:one", { spawnedBy: "agent:main:main" }),
            row("agent:main:subagent:two", { spawnedBy: "agent:main:main" }),
            row("agent:other:subagent:three", { spawnedBy: "agent:other:main" }),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "kill",
      "main",
    );

    expect(result.content).toBe("🦞 已中断匹配 `main` 的 2 个子代理会话");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "chat.abort", {
      sessionKey: "agent:main:subagent:one",
    });
    expect(request).toHaveBeenNthCalledWith(3, "chat.abort", {
      sessionKey: "agent:main:subagent:two",
    });
  });

  it("does not exact-match a session key outside the current subagent subtree", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:subagent:parent", { spawnedBy: "agent:main:main" }),
            row("agent:main:subagent:parent:subagent:child", {
              spawnedBy: "agent:main:subagent:parent",
            }),
            row("agent:main:subagent:sibling", { spawnedBy: "agent:main:main" }),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:subagent:parent",
      "kill",
      "agent:main:subagent:sibling",
    );

    expect(result.content).toBe("🦞 未找到匹配 `agent:main:subagent:sibling` 的子代理会话");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
  });

  it("returns a no-op summary when matching sessions have no active runs", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:subagent:one", { spawnedBy: "agent:main:main" }),
            row("agent:main:subagent:two", { spawnedBy: "agent:main:main" }),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: false };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "kill",
      "all",
    );

    expect(result.content).toBe("🦞 没有可中断的活动任务");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "chat.abort", {
      sessionKey: "agent:main:subagent:one",
    });
    expect(request).toHaveBeenNthCalledWith(3, "chat.abort", {
      sessionKey: "agent:main:subagent:two",
    });
  });

  it("uses a Chinese fallback error when every abort request rejects without a message", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [row("agent:main:subagent:one", { spawnedBy: "agent:main:main" })],
        };
      }
      if (method === "chat.abort") {
        throw undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "kill",
      "all",
    );

    expect(result.content).toBe("🦞 中断任务失败 Error: 中断请求失败");
  });

  it("treats the legacy main session key as the default agent scope", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("main"),
            row("agent:main:subagent:one", { spawnedBy: "agent:main:main" }),
            row("agent:main:subagent:two", { spawnedBy: "agent:main:main" }),
            row("agent:other:subagent:three", { spawnedBy: "agent:other:main" }),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "main",
      "kill",
      "all",
    );

    expect(result.content).toBe("🦞 已中断 2 个子代理会话");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "chat.abort", {
      sessionKey: "agent:main:subagent:one",
    });
    expect(request).toHaveBeenNthCalledWith(3, "chat.abort", {
      sessionKey: "agent:main:subagent:two",
    });
  });

  it("does not abort unrelated same-agent subagents from another root session", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:main"),
            row("agent:main:subagent:mine", { spawnedBy: "agent:main:main" }),
            row("agent:main:subagent:mine:subagent:child", {
              spawnedBy: "agent:main:subagent:mine",
            }),
            row("agent:main:subagent:other-root", {
              spawnedBy: "agent:main:discord:dm:alice",
            }),
          ],
        };
      }
      if (method === "chat.abort") {
        return { ok: true, aborted: true };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "kill",
      "all",
    );

    expect(result.content).toBe("🦞 已中断 2 个子代理会话");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "chat.abort", {
      sessionKey: "agent:main:subagent:mine",
    });
    expect(request).toHaveBeenNthCalledWith(3, "chat.abort", {
      sessionKey: "agent:main:subagent:mine:subagent:child",
    });
  });
});

describe("executeSlashCommand directives", () => {
  it("resolves the legacy main alias for bare /model", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          defaults: { model: "default-model" },
          sessions: [
            row("agent:main:main", {
              model: "gpt-4.1-mini",
            }),
          ],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-4.1-mini" }, { id: "gpt-4.1" }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "main",
      "model",
      "",
    );

    expect(result.content).toBe(
      "🦞 **当前模型** `gpt-4.1-mini`\n**可选模型** `gpt-4.1-mini`, `gpt-4.1`",
    );
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "models.list", {});
  });

  it("resolves the legacy main alias for /usage", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:main", {
              model: "gpt-4.1-mini",
              inputTokens: 1200,
              outputTokens: 300,
              totalTokens: 1500,
              contextTokens: 4000,
            }),
          ],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "main",
      "usage",
      "",
    );

    expect(result.content).toBe(
      "🦞 **会话用量**\n输入 **1.2k** 个令牌\n输出 **300** 个令牌\n总计 **1.5k** 个令牌\n上下文 **30%** / 4k\n模型 `gpt-4.1-mini`",
    );
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
  });

  it("reports the current thinking level for bare /think", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            row("agent:main:main", {
              modelProvider: "openai",
              model: "gpt-4.1-mini",
            }),
          ],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-4.1-mini", provider: "openai", reasoning: true }],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "think",
      "",
    );

    expect(result.content).toBe(
      "🦞 当前思考等级 低\n可用等级 off、minimal、low、medium、high、adaptive",
    );
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
    expect(request).toHaveBeenNthCalledWith(2, "models.list", {});
  });

  it("accepts minimal and xhigh thinking levels", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true });

    const minimal = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "think",
      "minimal",
    );
    const xhigh = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "think",
      "xhigh",
    );

    expect(minimal.content).toBe("🦞 已将思考等级设为 **极简**");
    expect(xhigh.content).toBe("🦞 已将思考等级设为 **极高**");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.patch", {
      key: "agent:main:main",
      thinkingLevel: "minimal",
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.patch", {
      key: "agent:main:main",
      thinkingLevel: "xhigh",
    });
  });

  it("reports the current verbose level for bare /verbose", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [row("agent:main:main", { verboseLevel: "full" })],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "verbose",
      "",
    );

    expect(result.content).toBe("🦞 当前详细级别 完整\n可用等级 on、full、off");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
  });

  it("reports the current fast mode for bare /fast", async () => {
    const request = vi.fn(async (method: string, _payload?: unknown) => {
      if (method === "sessions.list") {
        return {
          sessions: [row("agent:main:main", { fastMode: true })],
        };
      }
      throw new Error(`unexpected method: ${method}`);
    });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "fast",
      "",
    );

    expect(result.content).toBe("🦞 当前快速模式 开启\n可用值 status、on、off");
    expect(request).toHaveBeenNthCalledWith(1, "sessions.list", {});
  });

  it("patches fast mode for /fast on", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true });

    const result = await executeSlashCommand(
      { request } as unknown as GatewayBrowserClient,
      "agent:main:main",
      "fast",
      "on",
    );

    expect(result.content).toBe("🦞 快速模式已开启");
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:main",
      fastMode: true,
    });
  });
});
