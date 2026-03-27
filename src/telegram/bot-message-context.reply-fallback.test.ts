import { describe, expect, it } from "vitest";
import { buildTelegramMessageContextForTest } from "./bot-message-context.test-harness.js";

describe("buildTelegramMessageContext always-on group fallback", () => {
  async function buildAlwaysOnGroupReplyCtx(params: {
    replyFromId?: number;
    replyFromIsBot?: boolean;
    text?: string;
    options?: { forceWasMentioned?: boolean };
  }) {
    return await buildTelegramMessageContextForTest({
      message: {
        message_id: 100,
        chat: { id: -1001234567890, type: "supergroup", title: "Team" },
        date: 1700000000,
        text: params.text ?? "我很好",
        from: { id: 42, first_name: "Alice" },
        reply_to_message: {
          message_id: 1,
          text: "你好吗",
          from: {
            id: params.replyFromId ?? 999,
            first_name: "Bob",
            is_bot: params.replyFromIsBot ?? false,
          },
        },
      },
      options: params.options ?? {},
      resolveGroupRequireMention: () => false,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: false },
        topicConfig: undefined,
      }),
    });
  }

  it("skips default always-on fallback when replying to a different participant", async () => {
    const ctx = await buildAlwaysOnGroupReplyCtx({});
    expect(ctx).toBeNull();
  });

  it("keeps replies to the current bot enabled", async () => {
    const ctx = await buildAlwaysOnGroupReplyCtx({
      replyFromId: 7,
      replyFromIsBot: true,
    });

    expect(ctx).not.toBeNull();
  });

  it("keeps explicit invocations while replying to a different participant", async () => {
    const ctx = await buildAlwaysOnGroupReplyCtx({
      text: "助理 我很好",
      options: { forceWasMentioned: true },
    });

    expect(ctx).not.toBeNull();
  });
});
