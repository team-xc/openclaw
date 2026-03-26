import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../templating.js";
import {
  getReplyCommonMockState,
  registerGetReplyCommonMocks,
  resetGetReplyCommonMockState,
} from "./get-reply.test-mocks.js";

const mocks = vi.hoisted(() => ({
  applyMediaUnderstanding: vi.fn(async (..._args: unknown[]) => undefined),
  applyLinkUnderstanding: vi.fn(async (..._args: unknown[]) => undefined),
  createInternalHookEvent: vi.fn(),
  triggerInternalHook: vi.fn(async (..._args: unknown[]) => undefined),
  resolveReplyDirectives: vi.fn(),
  initSessionState: vi.fn(),
}));

registerGetReplyCommonMocks();

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));
vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: mocks.createInternalHookEvent,
  triggerInternalHook: mocks.triggerInternalHook,
}));
vi.mock("../../link-understanding/apply.js", () => ({
  applyLinkUnderstanding: mocks.applyLinkUnderstanding,
}));
vi.mock("../../media-understanding/apply.js", () => ({
  applyMediaUnderstanding: mocks.applyMediaUnderstanding,
}));
vi.mock("./commands-core.js", () => ({
  emitResetCommandHooks: vi.fn(async () => undefined),
}));
vi.mock("./get-reply-directives.js", () => ({
  resolveReplyDirectives: mocks.resolveReplyDirectives,
}));
vi.mock("./get-reply-inline-actions.js", () => ({
  handleInlineActions: vi.fn(async () => ({ kind: "reply", reply: { text: "ok" } })),
}));
vi.mock("./session.js", () => ({
  initSessionState: mocks.initSessionState,
}));

const { getReplyFromConfig } = await import("./get-reply.js");

function buildCtx(overrides: Partial<MsgContext> = {}): MsgContext {
  return {
    Provider: "telegram",
    Surface: "telegram",
    OriginatingChannel: "telegram",
    OriginatingTo: "telegram:-100123",
    ChatType: "group",
    ExplicitInvokeForTyping: true,
    Body: "<media:audio>",
    BodyForAgent: "<media:audio>",
    RawBody: "<media:audio>",
    CommandBody: "<media:audio>",
    MediaPath: "/tmp/voice.ogg",
    MediaUrl: "/tmp/voice.ogg",
    MediaType: "audio/ogg",
    MediaPaths: ["/tmp/voice.ogg"],
    MediaUrls: ["/tmp/voice.ogg"],
    MediaTypes: ["audio/ogg"],
    SessionKey: "agent:main:telegram:-100123",
    From: "telegram:user:42",
    To: "telegram:-100123",
    GroupChannel: "ops",
    Timestamp: 1710000000000,
    ...overrides,
  };
}

describe("getReplyFromConfig message hooks", () => {
  beforeEach(() => {
    delete process.env.OPENCLAW_TEST_FAST;
    resetGetReplyCommonMockState();
    mocks.applyMediaUnderstanding.mockReset();
    mocks.applyLinkUnderstanding.mockReset();
    mocks.createInternalHookEvent.mockReset();
    mocks.triggerInternalHook.mockReset();
    mocks.resolveReplyDirectives.mockReset();
    mocks.initSessionState.mockReset();

    mocks.applyMediaUnderstanding.mockImplementation(async (...args: unknown[]) => {
      const { ctx } = args[0] as { ctx: MsgContext };
      ctx.Transcript = "voice transcript";
      ctx.Body = "[Audio]\nTranscript:\nvoice transcript";
      ctx.BodyForAgent = "[Audio]\nTranscript:\nvoice transcript";
    });
    mocks.applyLinkUnderstanding.mockResolvedValue(undefined);
    mocks.createInternalHookEvent.mockImplementation(
      (type: string, action: string, sessionKey: string, context: Record<string, unknown>) => ({
        type,
        action,
        sessionKey,
        context,
        timestamp: new Date(),
        messages: [],
      }),
    );
    mocks.triggerInternalHook.mockResolvedValue(undefined);
    mocks.resolveReplyDirectives.mockResolvedValue({ kind: "reply", reply: { text: "ok" } });
    mocks.initSessionState.mockResolvedValue({
      sessionCtx: {},
      sessionEntry: {},
      previousSessionEntry: {},
      sessionStore: {},
      sessionKey: "agent:main:telegram:-100123",
      sessionId: "session-1",
      isNewSession: false,
      resetTriggered: false,
      systemSent: false,
      abortedLastRun: false,
      storePath: "/tmp/sessions.json",
      sessionScope: "per-chat",
      groupResolution: undefined,
      isGroup: true,
      triggerBodyNormalized: "",
      bodyStripped: "",
    });
  });

  it("starts typing before media understanding for telegram audio messages", async () => {
    await getReplyFromConfig(buildCtx(), undefined, {});

    const typingOrder = (
      getReplyCommonMockState.typingController.startTypingLoop as ReturnType<typeof vi.fn>
    ).mock.invocationCallOrder[0];
    const mediaOrder = mocks.applyMediaUnderstanding.mock.invocationCallOrder[0];

    expect(getReplyCommonMockState.typingController.startTypingLoop).toHaveBeenCalledTimes(1);
    expect(typingOrder).toBeLessThan(mediaOrder);
  });

  it("does not start early typing for telegram group audio without explicit invoke", async () => {
    await getReplyFromConfig(
      buildCtx({
        ExplicitInvokeForTyping: false,
        WasMentioned: true,
      }),
      undefined,
      {},
    );

    expect(getReplyCommonMockState.typingController.startTypingLoop).not.toHaveBeenCalled();
    expect(mocks.applyMediaUnderstanding).toHaveBeenCalledTimes(1);
  });

  it("still starts early typing for telegram direct audio without explicit invoke flag", async () => {
    await getReplyFromConfig(
      buildCtx({
        ChatType: "direct",
        ExplicitInvokeForTyping: undefined,
        From: "telegram:42",
        To: "telegram:42",
        SessionKey: "agent:main:telegram:42",
      }),
      undefined,
      {},
    );

    expect(getReplyCommonMockState.typingController.startTypingLoop).toHaveBeenCalledTimes(1);
    expect(mocks.applyMediaUnderstanding).toHaveBeenCalledTimes(1);
  });

  it("does not start early typing for non-telegram audio messages", async () => {
    await getReplyFromConfig(
      buildCtx({
        Provider: "discord",
        Surface: "discord",
        OriginatingChannel: "discord",
        OriginatingTo: "discord:123",
        SessionKey: "agent:main:discord:123",
        To: "discord:123",
      }),
      undefined,
      {},
    );

    expect(getReplyCommonMockState.typingController.startTypingLoop).not.toHaveBeenCalled();
    expect(mocks.applyMediaUnderstanding).toHaveBeenCalledTimes(1);
  });

  it("does not start early typing when audio understanding is disabled", async () => {
    await getReplyFromConfig(buildCtx(), undefined, {
      tools: { media: { audio: { enabled: false } } },
    });

    expect(getReplyCommonMockState.typingController.startTypingLoop).not.toHaveBeenCalled();
  });

  it("does not start early typing when typing mode resolves to never", async () => {
    await getReplyFromConfig(buildCtx(), undefined, {
      session: { typingMode: "never" },
    });

    expect(getReplyCommonMockState.typingController.startTypingLoop).not.toHaveBeenCalled();
  });

  it("does not start early typing when typing policy suppresses typing", async () => {
    await getReplyFromConfig(buildCtx(), { typingPolicy: "system_event" }, {});

    expect(getReplyCommonMockState.typingController.startTypingLoop).not.toHaveBeenCalled();
  });

  it("emits transcribed + preprocessed hooks with enriched context", async () => {
    const ctx = buildCtx();

    await getReplyFromConfig(ctx, undefined, {});

    expect(mocks.createInternalHookEvent).toHaveBeenCalledTimes(2);
    expect(mocks.createInternalHookEvent).toHaveBeenNthCalledWith(
      1,
      "message",
      "transcribed",
      "agent:main:telegram:-100123",
      expect.objectContaining({
        transcript: "voice transcript",
        channelId: "telegram",
        conversationId: "telegram:-100123",
      }),
    );
    expect(mocks.createInternalHookEvent).toHaveBeenNthCalledWith(
      2,
      "message",
      "preprocessed",
      "agent:main:telegram:-100123",
      expect.objectContaining({
        transcript: "voice transcript",
        isGroup: true,
        groupId: "telegram:-100123",
      }),
    );
    expect(mocks.triggerInternalHook).toHaveBeenCalledTimes(2);
  });

  it("emits only preprocessed when no transcript is produced", async () => {
    mocks.applyMediaUnderstanding.mockImplementationOnce(async (...args: unknown[]) => {
      const { ctx } = args[0] as { ctx: MsgContext };
      ctx.Transcript = undefined;
      ctx.Body = "<media:audio>";
      ctx.BodyForAgent = "<media:audio>";
    });

    await getReplyFromConfig(buildCtx(), undefined, {});

    expect(mocks.createInternalHookEvent).toHaveBeenCalledTimes(1);
    expect(mocks.createInternalHookEvent).toHaveBeenCalledWith(
      "message",
      "preprocessed",
      "agent:main:telegram:-100123",
      expect.any(Object),
    );
  });

  it("skips message hooks in fast test mode", async () => {
    process.env.OPENCLAW_TEST_FAST = "1";

    await getReplyFromConfig(buildCtx(), undefined, {});

    expect(mocks.applyMediaUnderstanding).not.toHaveBeenCalled();
    expect(mocks.applyLinkUnderstanding).not.toHaveBeenCalled();
    expect(mocks.createInternalHookEvent).not.toHaveBeenCalled();
    expect(mocks.triggerInternalHook).not.toHaveBeenCalled();
  });

  it("skips message hooks when SessionKey is unavailable", async () => {
    await getReplyFromConfig(buildCtx({ SessionKey: undefined }), undefined, {});

    expect(mocks.createInternalHookEvent).not.toHaveBeenCalled();
    expect(mocks.triggerInternalHook).not.toHaveBeenCalled();
  });
});
