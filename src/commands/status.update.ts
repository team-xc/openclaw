import type { UpdateCheckResult } from "../infra/update-check.js";

const DISABLED_UPDATE_CHECK: UpdateCheckResult = {
  root: null,
  installKind: "unknown",
  packageManager: "unknown",
};

export async function getUpdateCheckResult(_params: {
  timeoutMs: number;
  fetchGit: boolean;
  includeRegistry: boolean;
}): Promise<UpdateCheckResult> {
  return DISABLED_UPDATE_CHECK;
}

export type UpdateAvailability = {
  available: boolean;
  hasGitUpdate: boolean;
  hasRegistryUpdate: boolean;
  latestVersion: string | null;
  gitBehind: number | null;
};

export function resolveUpdateAvailability(_update: UpdateCheckResult): UpdateAvailability {
  return {
    available: false,
    hasGitUpdate: false,
    hasRegistryUpdate: false,
    latestVersion: null,
    gitBehind: null,
  };
}

export function formatUpdateAvailableHint(_update: UpdateCheckResult): string | null {
  return null;
}

export function formatUpdateOneLiner(_update: UpdateCheckResult): string {
  return "disabled";
}
