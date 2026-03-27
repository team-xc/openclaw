import { describe, expect, it, vi } from "vitest";

vi.mock("../../auto-reply/tokens.js", () => ({
  SILENT_REPLY_TOKEN: "QUIET_TOKEN",
}));

const textToSpeechMock = vi.fn(async (_params: unknown) => ({
  success: true,
  audioPath: "/tmp/test-audio.mp3",
  provider: "edge",
  voiceCompatible: true,
}));

vi.mock("../../tts/tts.js", () => ({
  textToSpeech: (params: unknown) => textToSpeechMock(params),
}));

const { createTtsTool } = await import("./tts-tool.js");

describe("createTtsTool", () => {
  it("uses SILENT_REPLY_TOKEN in guidance text", () => {
    const tool = createTtsTool();

    expect(tool.description).toContain("QUIET_TOKEN");
    expect(tool.description).not.toContain("NO_REPLY");
  });

  it("passes agentAccountId through to textToSpeech", async () => {
    textToSpeechMock.mockClear();
    const tool = createTtsTool({
      agentChannel: "telegram",
      agentAccountId: "ops",
    });

    const result = await tool.execute("call-1", {
      text: "你好",
    });

    expect(textToSpeechMock).toHaveBeenCalledWith({
      text: "你好",
      cfg: expect.any(Object),
      channel: "telegram",
      accountId: "ops",
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "[[audio_as_voice]]\nMEDIA:/tmp/test-audio.mp3" }],
      details: { audioPath: "/tmp/test-audio.mp3", provider: "edge" },
    });
  });
});
