import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandleCommandsParams } from "./commands-types.js";

const hoisted = vi.hoisted(() => ({
  loadSessionStoreMock: vi.fn(),
  resolveSessionFilePathMock: vi.fn(),
  resolveCommandsSystemPromptBundleMock: vi.fn(),
  openSessionManagerMock: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  SessionManager: {
    open: (...args: unknown[]) => hoisted.openSessionManagerMock(...args),
  },
}));

vi.mock("../../config/sessions/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/sessions/paths.js")>();
  return {
    ...actual,
    resolveDefaultSessionStorePath: vi.fn(() => "/tmp/openclaw-session-store.json"),
    resolveSessionFilePath: (...args: unknown[]) => hoisted.resolveSessionFilePathMock(...args),
    resolveSessionFilePathOptions: vi.fn(() => ({})),
  };
});

vi.mock("../../config/sessions/store.js", () => ({
  loadSessionStore: (...args: unknown[]) => hoisted.loadSessionStoreMock(...args),
}));

vi.mock("./commands-system-prompt.js", () => ({
  resolveCommandsSystemPromptBundle: (...args: unknown[]) =>
    hoisted.resolveCommandsSystemPromptBundleMock(...args),
}));

const { buildExportSessionReply } = await import("./commands-export-session.js");

function createBaseParams(
  overrides: Partial<HandleCommandsParams> = {},
  commandOverrides: Partial<HandleCommandsParams["command"]> = {},
): HandleCommandsParams {
  return {
    command: {
      commandBodyNormalized: "/export-session",
      channel: "telegram",
      ...commandOverrides,
    },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp",
    agentId: "main",
    sessionEntry: undefined,
    ...overrides,
  } as unknown as HandleCommandsParams;
}

describe("buildExportSessionReply", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-export-session-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a Chinese error when there is no active session", async () => {
    const result = await buildExportSessionReply(createBaseParams());

    expect(result).toEqual({ text: "🦞 未找到当前会话" });
  });

  it("returns a Chinese export summary for Telegram surfaces", async () => {
    const sessionFile = path.join(tempDir, "session.jsonl");
    const outputFile = path.join(tempDir, "export.html");
    fs.writeFileSync(sessionFile, "placeholder", "utf-8");

    hoisted.loadSessionStoreMock.mockReturnValue({
      "agent:main:main": {
        sessionId: "session-12345678",
      },
    });
    hoisted.resolveSessionFilePathMock.mockReturnValue(sessionFile);
    hoisted.resolveCommandsSystemPromptBundleMock.mockResolvedValue({
      systemPrompt: "hello",
      tools: [{ name: "tool-a" }, { name: "tool-b" }],
    });
    hoisted.openSessionManagerMock.mockReturnValue({
      getEntries: () => [{ id: "1" }, { id: "2" }],
      getHeader: () => null,
      getLeafId: () => "leaf-1",
    });

    const result = await buildExportSessionReply(
      createBaseParams(
        {
          sessionEntry: { sessionId: "session-12345678" } as HandleCommandsParams["sessionEntry"],
          workspaceDir: tempDir,
        },
        {
          commandBodyNormalized: `/export-session ${outputFile}`,
        },
      ),
    );

    expect(result).toEqual({
      text: ["🦞 会话已导出", "文件 export.html", "条目 2", "系统提示词 5 字符", "工具 2"].join(
        "\n",
      ),
    });
    expect(fs.existsSync(outputFile)).toBe(true);
  });
});
