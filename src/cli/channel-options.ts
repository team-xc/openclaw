import { CHAT_CHANNEL_ORDER } from "../channels/registry.js";

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    resolved.push(value);
  }
  return resolved;
}

export function resolveCliChannelOptions(): string[] {
  return dedupe([...CHAT_CHANNEL_ORDER]);
}

export function formatCliChannelOptions(extra: string[] = []): string {
  return dedupe([...extra, ...resolveCliChannelOptions()]).join("|");
}
