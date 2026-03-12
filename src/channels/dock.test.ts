import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { withEnv } from "../test-utils/env.js";
import { getChannelDock } from "./dock.js";

function emptyConfig(): OpenClawConfig {
  return {} as OpenClawConfig;
}

describe("channels dock", () => {
  it("telegram threading uses topic ids and current message ids", () => {
    const hasRepliedRef = { value: false };
    const telegramDock = getChannelDock("telegram");

    const telegramContext = telegramDock?.threading?.buildToolContext?.({
      cfg: emptyConfig(),
      context: {
        To: " room-1 ",
        MessageThreadId: 42,
        ReplyToId: "fallback",
        CurrentMessageId: "9001",
      },
      hasRepliedRef,
    });

    expect(telegramContext).toEqual({
      currentChannelId: "room-1",
      currentThreadTs: "42",
      currentMessageId: "9001",
      hasRepliedRef,
    });
  });

  it("telegram threading does not treat ReplyToId as thread id in DMs", () => {
    const hasRepliedRef = { value: false };
    const telegramDock = getChannelDock("telegram");
    const context = telegramDock?.threading?.buildToolContext?.({
      cfg: emptyConfig(),
      context: { To: " dm-1 ", ReplyToId: "12345", CurrentMessageId: "12345" },
      hasRepliedRef,
    });

    expect(context).toEqual({
      currentChannelId: "dm-1",
      currentThreadTs: undefined,
      currentMessageId: "12345",
      hasRepliedRef,
    });
  });

  it("telegram allowFrom formatter trims, strips prefix, and lowercases", () => {
    const telegramDock = getChannelDock("telegram");

    const formatted = telegramDock?.config?.formatAllowFrom?.({
      cfg: emptyConfig(),
      allowFrom: [" TG:User ", "telegram:Foo", " Plain "],
    });

    expect(formatted).toEqual(["user", "foo", "plain"]);
  });

  it("telegram dock config readers preserve omitted-account fallback semantics", () => {
    withEnv({ TELEGRAM_BOT_TOKEN: "tok-env" }, () => {
      const telegramDock = getChannelDock("telegram");
      const cfg = {
        channels: {
          telegram: {
            allowFrom: ["top-owner"],
            defaultTo: "@top-target",
            accounts: {
              work: {
                botToken: "tok-work",
                allowFrom: ["work-owner"],
                defaultTo: "@work-target",
              },
            },
          },
        },
      } as unknown as OpenClawConfig;

      expect(telegramDock?.config?.resolveAllowFrom?.({ cfg })).toEqual(["top-owner"]);
      expect(telegramDock?.config?.resolveDefaultTo?.({ cfg })).toBe("@top-target");
    });
  });

  it("telegram dock config readers coerce numeric allowFrom/defaultTo entries", () => {
    const telegramDock = getChannelDock("telegram");
    const cfg = {
      channels: {
        telegram: {
          allowFrom: [12345],
          defaultTo: 67890,
        },
      },
    } as unknown as OpenClawConfig;

    expect(telegramDock?.config?.resolveAllowFrom?.({ cfg })).toEqual(["12345"]);
    expect(telegramDock?.config?.resolveDefaultTo?.({ cfg })).toBe("67890");
  });
});
