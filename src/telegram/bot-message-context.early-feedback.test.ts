import { describe, expect, it, vi } from "vitest";
import { buildTelegramMessageContextForTest } from "./bot-message-context.test-harness.js";

describe("buildTelegramMessageContext early feedback", () => {
  it("marks default fallback group turns as early-feedback eligible", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 100,
        chat: { id: -1001234567890, type: "supergroup", title: "Team" },
        date: 1700000000,
        text: "今天星期几",
        from: { id: 42, first_name: "Alice" },
      },
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.WasMentioned).toBe(false);
    expect(ctx?.ctxPayload?.EarlyFeedbackEligible).toBe(true);
  });

  it("does not mark fallback turns when another bot is explicitly mentioned", async () => {
    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 101,
        chat: { id: -1001234567890, type: "supergroup", title: "Team" },
        date: 1700000001,
        text: "@dev 你来处理",
        entities: [{ offset: 0, length: 4, type: "mention" }],
        from: { id: 42, first_name: "Alice" },
      },
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });

    expect(ctx).not.toBeNull();
    expect(ctx?.ctxPayload?.WasMentioned).toBe(false);
    expect(ctx?.ctxPayload?.EarlyFeedbackEligible).toBe(false);
  });

  it("sends ack reactions for early-feedback fallback turns", async () => {
    const setMessageReaction = vi.fn().mockResolvedValue(undefined);

    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 102,
        chat: { id: -1001234567890, type: "supergroup", title: "Team" },
        date: 1700000002,
        text: "今天几号",
        from: { id: 42, first_name: "Alice" },
      },
      cfg: {
        agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/openclaw" } },
        channels: { telegram: {} },
        messages: { ackReaction: "👀", groupChat: { mentionPatterns: [] } },
      },
      ackReactionScope: "group-mentions",
      botApi: {
        setMessageReaction,
      },
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });

    await ctx?.ackReactionPromise;

    expect(setMessageReaction).toHaveBeenCalledWith(-1001234567890, 102, [
      { type: "emoji", emoji: "👀" },
    ]);
  });

  it("does not send fallback ack reactions for other explicit mentions", async () => {
    const setMessageReaction = vi.fn().mockResolvedValue(undefined);

    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 103,
        chat: { id: -1001234567890, type: "supergroup", title: "Team" },
        date: 1700000003,
        text: "@dev 帮我看一下",
        entities: [{ offset: 0, length: 4, type: "mention" }],
        from: { id: 42, first_name: "Alice" },
      },
      cfg: {
        agents: { defaults: { model: "anthropic/claude-opus-4-5", workspace: "/tmp/openclaw" } },
        channels: { telegram: {} },
        messages: { ackReaction: "👀", groupChat: { mentionPatterns: [] } },
      },
      ackReactionScope: "group-mentions",
      botApi: {
        setMessageReaction,
      },
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });

    await ctx?.ackReactionPromise;

    expect(setMessageReaction).not.toHaveBeenCalled();
  });
});
