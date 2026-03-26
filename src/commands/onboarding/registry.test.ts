import { describe, expect, it } from "vitest";
import { getChannelOnboardingAdapter, listChannelOnboardingAdapters } from "./registry.js";

describe("onboarding registry", () => {
  it("exposes only the telegram onboarding adapter on the private surface", () => {
    expect(listChannelOnboardingAdapters().map((adapter) => adapter.channel)).toEqual(["telegram"]);
    expect(getChannelOnboardingAdapter("telegram")).toBeDefined();
  });

  it("does not expose non-telegram onboarding adapters", () => {
    expect(getChannelOnboardingAdapter("signal")).toBeUndefined();
  });
});
