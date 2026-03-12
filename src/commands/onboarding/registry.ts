import { telegramOnboardingAdapter } from "../../channels/plugins/onboarding/telegram.js";
import type { ChannelChoice } from "../onboard-types.js";
import type { ChannelOnboardingAdapter } from "./types.js";

const BUILTIN_ONBOARDING_ADAPTERS: ChannelOnboardingAdapter[] = [telegramOnboardingAdapter];

const CHANNEL_ONBOARDING_ADAPTERS = () => {
  // Private fork: onboarding only exposes the built-in Telegram flow, even though other
  // channel plugins may still exist for compatibility.
  return new Map<ChannelChoice, ChannelOnboardingAdapter>(
    BUILTIN_ONBOARDING_ADAPTERS.map((adapter) => [adapter.channel, adapter] as const),
  );
};

export function getChannelOnboardingAdapter(
  channel: ChannelChoice,
): ChannelOnboardingAdapter | undefined {
  return CHANNEL_ONBOARDING_ADAPTERS().get(channel);
}

export function listChannelOnboardingAdapters(): ChannelOnboardingAdapter[] {
  return Array.from(CHANNEL_ONBOARDING_ADAPTERS().values());
}

// Legacy aliases (pre-rename).
export const getProviderOnboardingAdapter = getChannelOnboardingAdapter;
export const listProviderOnboardingAdapters = listChannelOnboardingAdapters;
