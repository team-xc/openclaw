import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ToolDisplayModule = typeof import("./tool-display.ts");
type I18nModule = typeof import("../i18n/index.ts");

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe("tool display i18n", () => {
  let toolDisplay: ToolDisplayModule;
  let i18nModule: I18nModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", createStorageMock());
    vi.stubGlobal("navigator", { language: "en-US" } as Navigator);
    i18nModule = await import("../i18n/index.ts");
    toolDisplay = await import("./tool-display.ts");
    await i18nModule.i18n.setLocale("en");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("re-resolves slack action labels after locale changes", async () => {
    const before = toolDisplay.resolveToolDisplay({
      name: "slack",
      args: { action: "sendMessage", to: "x", content: "y" },
    });
    expect(before.verb).toBe("send");

    await i18nModule.i18n.setLocale("zh-CN");

    const after = toolDisplay.resolveToolDisplay({
      name: "slack",
      args: { action: "sendMessage", to: "x", content: "y" },
    });
    expect(after.verb).toBe("发送");
  });
});
