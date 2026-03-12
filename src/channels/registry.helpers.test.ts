import { describe, expect, it } from "vitest";
import {
  formatChannelSelectionLine,
  listChatChannels,
  normalizeChatChannelId,
} from "./registry.js";

describe("channel registry helpers", () => {
  it("normalizes telegram and rejects removed channel aliases", () => {
    expect(normalizeChatChannelId("telegram")).toBe("telegram");
    expect(normalizeChatChannelId(" tg ")).toBeNull();
    expect(normalizeChatChannelId(" imsg ")).toBeNull();
    expect(normalizeChatChannelId("gchat")).toBeNull();
    expect(normalizeChatChannelId("web")).toBeNull();
    expect(normalizeChatChannelId("nope")).toBeNull();
  });

  it("keeps Telegram first in the default order", () => {
    const channels = listChatChannels();
    expect(channels[0]?.id).toBe("telegram");
  });

  it("does not include MS Teams by default", () => {
    const channels = listChatChannels();
    expect(channels.some((channel) => channel.id === "msteams")).toBe(false);
  });

  it("formats selection lines for the private telegram-only surface", () => {
    const channels = listChatChannels();
    const first = channels[0];
    if (!first) {
      throw new Error("Missing channel metadata.");
    }
    const line = formatChannelSelectionLine(first, (path, label) =>
      [label, path].filter(Boolean).join(":"),
    );
    expect(line).toContain("Docs:");
    expect(line).toContain("/channels/telegram");
    expect(line).not.toContain("https://openclaw.ai");
  });
});
