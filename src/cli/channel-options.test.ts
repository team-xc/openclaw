import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../channels/registry.js", () => ({
  CHAT_CHANNEL_ORDER: ["telegram"],
}));

async function loadModule() {
  return await import("./channel-options.js");
}

describe("resolveCliChannelOptions", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns the private telegram-only surface", async () => {
    const mod = await loadModule();
    expect(mod.resolveCliChannelOptions()).toEqual(["telegram"]);
  });

  it("dedupes extras when formatting options", async () => {
    const mod = await loadModule();
    expect(mod.formatCliChannelOptions(["all", "telegram"])).toBe("all|telegram");
  });
});
