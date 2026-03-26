import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTelegramMessageContextForTest } from "./bot-message-context.test-harness.js";

const transcribeFirstAudioMock = vi.fn();
const DEFAULT_MODEL = "anthropic/claude-opus-4-5";
const DEFAULT_WORKSPACE = "/tmp/openclaw";
const DEFAULT_MENTION_PATTERN = "\\bbot\\b";

vi.mock("../media-understanding/audio-preflight.js", () => ({
  transcribeFirstAudio: (...args: unknown[]) => transcribeFirstAudioMock(...args),
}));

async function buildGroupVoiceContext(params: {
  messageId: number;
  chatId: number;
  title: string;
  date: number;
  fromId: number;
  firstName: string;
  fileId: string;
  mediaPath: string;
  groupDisableAudioPreflight?: boolean;
  topicDisableAudioPreflight?: boolean;
}) {
  const sendChatActionHandler = {
    sendChatAction: vi.fn().mockResolvedValue(undefined),
    isSuspended: vi.fn(() => false),
    reset: vi.fn(),
  };
  const groupConfig = {
    requireMention: true,
    ...(params.groupDisableAudioPreflight === undefined
      ? {}
      : { disableAudioPreflight: params.groupDisableAudioPreflight }),
  };
  const topicConfig =
    params.topicDisableAudioPreflight === undefined
      ? undefined
      : { disableAudioPreflight: params.topicDisableAudioPreflight };

  const ctx = await buildTelegramMessageContextForTest({
    message: {
      message_id: params.messageId,
      chat: { id: params.chatId, type: "supergroup", title: params.title },
      date: params.date,
      text: undefined,
      from: { id: params.fromId, first_name: params.firstName },
      voice: { file_id: params.fileId },
    },
    allMedia: [{ path: params.mediaPath, contentType: "audio/ogg" }],
    options: { forceWasMentioned: true },
    cfg: {
      agents: { defaults: { model: DEFAULT_MODEL, workspace: DEFAULT_WORKSPACE } },
      channels: { telegram: {} },
      messages: { groupChat: { mentionPatterns: [DEFAULT_MENTION_PATTERN] } },
    },
    resolveGroupActivation: () => true,
    resolveGroupRequireMention: () => true,
    resolveTelegramGroupConfig: () => ({
      groupConfig,
      topicConfig,
    }),
    sendChatActionHandler,
  });

  return { ctx, sendChatActionHandler };
}

function expectTranscriptRendered(
  ctx: Awaited<ReturnType<typeof buildGroupVoiceContext>>["ctx"],
  transcript: string,
) {
  expect(ctx).not.toBeNull();
  expect(ctx?.ctxPayload?.BodyForAgent).toBe(transcript);
  expect(ctx?.ctxPayload?.Body).toContain(transcript);
  expect(ctx?.ctxPayload?.Body).not.toContain("<media:audio>");
}

function expectAudioPlaceholderRendered(
  ctx: Awaited<ReturnType<typeof buildGroupVoiceContext>>["ctx"],
) {
  expect(ctx).not.toBeNull();
  expect(ctx?.ctxPayload?.Body).toContain("<media:audio>");
}

describe("buildTelegramMessageContext audio transcript body", () => {
  beforeEach(() => {
    transcribeFirstAudioMock.mockReset();
  });

  it("uses preflight transcript as BodyForAgent for mention-gated group voice messages", async () => {
    transcribeFirstAudioMock.mockResolvedValueOnce("hey bot please help");

    const { ctx, sendChatActionHandler } = await buildGroupVoiceContext({
      messageId: 1,
      chatId: -1001234567890,
      title: "Test Group",
      date: 1700000000,
      fromId: 42,
      firstName: "Alice",
      fileId: "voice-1",
      mediaPath: "/tmp/voice.ogg",
    });

    expect(transcribeFirstAudioMock).toHaveBeenCalledTimes(1);
    expect(sendChatActionHandler.sendChatAction).toHaveBeenCalledWith(
      -1001234567890,
      "typing",
      undefined,
    );
    expectTranscriptRendered(ctx, "hey bot please help");
  });

  it("keeps plain group voice preflight silent until the transcript actually targets the bot", async () => {
    transcribeFirstAudioMock.mockResolvedValueOnce("hey bot please help");

    const sendChatActionHandler = {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      isSuspended: vi.fn(() => false),
      reset: vi.fn(),
    };

    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 10,
        chat: { id: -1001234567998, type: "supergroup", title: "Plain Voice Group" },
        date: 1700000390,
        text: undefined,
        from: { id: 41, first_name: "Nina" },
        voice: { file_id: "voice-plain-1" },
      },
      allMedia: [{ path: "/tmp/plain-voice.ogg", contentType: "audio/ogg" }],
      cfg: {
        agents: { defaults: { model: DEFAULT_MODEL, workspace: DEFAULT_WORKSPACE } },
        channels: { telegram: {} },
        messages: { groupChat: { mentionPatterns: [DEFAULT_MENTION_PATTERN] } },
      },
      resolveGroupActivation: () => true,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: undefined,
      }),
      sendChatActionHandler,
    });

    expect(transcribeFirstAudioMock).toHaveBeenCalledTimes(1);
    expect(sendChatActionHandler.sendChatAction).not.toHaveBeenCalled();
    expectTranscriptRendered(ctx, "hey bot please help");
  });

  it("uses quoted voice for preflight when the current message only adds non-audio media", async () => {
    transcribeFirstAudioMock.mockResolvedValueOnce("quoted voice transcript");

    const sendChatActionHandler = {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      isSuspended: vi.fn(() => false),
      reset: vi.fn(),
    };

    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 10_001,
        chat: { id: -1001234567997, type: "supergroup", title: "Mixed Media Group" },
        date: 1700000410,
        text: "@bot",
        from: { id: 47, first_name: "Ivy" },
        reply_to_message: {
          message_id: 9002,
          voice: { file_id: "reply-voice-2" },
          from: { id: 53, first_name: "Oscar" },
        },
      },
      allMedia: [{ path: "/tmp/current-photo.png", contentType: "image/png" }],
      replyMedia: [{ path: "/tmp/reply-voice-2.ogg", contentType: "audio/ogg" }],
      cfg: {
        agents: { defaults: { model: DEFAULT_MODEL, workspace: DEFAULT_WORKSPACE } },
        channels: { telegram: {} },
        messages: { groupChat: { mentionPatterns: [DEFAULT_MENTION_PATTERN] } },
      },
      resolveGroupActivation: () => true,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: undefined,
      }),
      sendChatActionHandler,
    });

    expect(ctx).not.toBeNull();
    expect(transcribeFirstAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeFirstAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          MediaPaths: ["/tmp/current-photo.png", "/tmp/reply-voice-2.ogg"],
          MediaTypes: ["image/png", "audio/ogg"],
        }),
      }),
    );
    expect(sendChatActionHandler.sendChatAction).toHaveBeenCalledWith(
      -1001234567997,
      "typing",
      undefined,
    );
  });

  it("starts preflight typing for quoted voice replies that only mention the bot", async () => {
    transcribeFirstAudioMock.mockResolvedValueOnce("quoted voice transcript");

    const sendChatActionHandler = {
      sendChatAction: vi.fn().mockResolvedValue(undefined),
      isSuspended: vi.fn(() => false),
      reset: vi.fn(),
    };

    const ctx = await buildTelegramMessageContextForTest({
      message: {
        message_id: 11,
        chat: { id: -1001234567999, type: "supergroup", title: "Quoted Voice Group" },
        date: 1700000400,
        text: "@bot",
        from: { id: 46, first_name: "Eve" },
        reply_to_message: {
          message_id: 9001,
          voice: { file_id: "reply-voice-1" },
          from: { id: 52, first_name: "Mallory" },
        },
      },
      replyMedia: [{ path: "/tmp/reply-voice.ogg", contentType: "audio/ogg" }],
      cfg: {
        agents: { defaults: { model: DEFAULT_MODEL, workspace: DEFAULT_WORKSPACE } },
        channels: { telegram: {} },
        messages: { groupChat: { mentionPatterns: [DEFAULT_MENTION_PATTERN] } },
      },
      resolveGroupActivation: () => true,
      resolveGroupRequireMention: () => true,
      resolveTelegramGroupConfig: () => ({
        groupConfig: { requireMention: true },
        topicConfig: undefined,
      }),
      sendChatActionHandler,
    });

    expect(ctx).not.toBeNull();
    expect(transcribeFirstAudioMock).toHaveBeenCalledTimes(1);
    expect(transcribeFirstAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.objectContaining({
          MediaPaths: ["/tmp/reply-voice.ogg"],
          MediaTypes: ["audio/ogg"],
        }),
      }),
    );
    expect(sendChatActionHandler.sendChatAction).toHaveBeenCalledWith(
      -1001234567999,
      "typing",
      undefined,
    );
  });

  it("skips preflight transcription when disableAudioPreflight is true", async () => {
    transcribeFirstAudioMock.mockClear();

    const { ctx, sendChatActionHandler } = await buildGroupVoiceContext({
      messageId: 2,
      chatId: -1001234567891,
      title: "Test Group 2",
      date: 1700000100,
      fromId: 43,
      firstName: "Bob",
      fileId: "voice-2",
      mediaPath: "/tmp/voice2.ogg",
      groupDisableAudioPreflight: true,
    });

    expect(transcribeFirstAudioMock).not.toHaveBeenCalled();
    expect(sendChatActionHandler.sendChatAction).not.toHaveBeenCalled();
    expectAudioPlaceholderRendered(ctx);
  });

  it("uses topic disableAudioPreflight=false to override group disableAudioPreflight=true", async () => {
    transcribeFirstAudioMock.mockResolvedValueOnce("topic override transcript");

    const { ctx, sendChatActionHandler } = await buildGroupVoiceContext({
      messageId: 3,
      chatId: -1001234567892,
      title: "Test Group 3",
      date: 1700000200,
      fromId: 44,
      firstName: "Cara",
      fileId: "voice-3",
      mediaPath: "/tmp/voice3.ogg",
      groupDisableAudioPreflight: true,
      topicDisableAudioPreflight: false,
    });

    expect(transcribeFirstAudioMock).toHaveBeenCalledTimes(1);
    expect(sendChatActionHandler.sendChatAction).toHaveBeenCalledWith(
      -1001234567892,
      "typing",
      undefined,
    );
    expectTranscriptRendered(ctx, "topic override transcript");
  });

  it("uses topic disableAudioPreflight=true to override group disableAudioPreflight=false", async () => {
    transcribeFirstAudioMock.mockClear();

    const { ctx, sendChatActionHandler } = await buildGroupVoiceContext({
      messageId: 4,
      chatId: -1001234567893,
      title: "Test Group 4",
      date: 1700000300,
      fromId: 45,
      firstName: "Dan",
      fileId: "voice-4",
      mediaPath: "/tmp/voice4.ogg",
      groupDisableAudioPreflight: false,
      topicDisableAudioPreflight: true,
    });

    expect(transcribeFirstAudioMock).not.toHaveBeenCalled();
    expect(sendChatActionHandler.sendChatAction).not.toHaveBeenCalled();
    expectAudioPlaceholderRendered(ctx);
  });
});
