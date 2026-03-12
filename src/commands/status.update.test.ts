import { describe, expect, it } from "vitest";
import type { UpdateCheckResult } from "../infra/update-check.js";
import {
  getUpdateCheckResult,
  formatUpdateAvailableHint,
  formatUpdateOneLiner,
  resolveUpdateAvailability,
} from "./status.update.js";

function buildUpdate(partial: Partial<UpdateCheckResult>): UpdateCheckResult {
  return {
    root: null,
    installKind: "unknown",
    packageManager: "unknown",
    ...partial,
  };
}

describe("resolveUpdateAvailability", () => {
  it("always reports updates as disabled", () => {
    const update = buildUpdate({
      installKind: "git",
      git: {
        root: "/tmp/repo",
        sha: null,
        tag: null,
        branch: "main",
        upstream: "origin/main",
        dirty: false,
        ahead: 0,
        behind: 3,
        fetchOk: true,
      },
    });
    expect(resolveUpdateAvailability(update)).toEqual({
      available: false,
      hasGitUpdate: false,
      hasRegistryUpdate: false,
      latestVersion: null,
      gitBehind: null,
    });
  });
});

describe("formatUpdateOneLiner", () => {
  it("renders the disabled marker", () => {
    const update = buildUpdate({
      installKind: "git",
      git: {
        root: "/tmp/repo",
        sha: "abc123456789",
        tag: null,
        branch: "main",
        upstream: "origin/main",
        dirty: true,
        ahead: 0,
        behind: 2,
        fetchOk: true,
      },
    });

    expect(formatUpdateOneLiner(update)).toBe("disabled");
  });
});

describe("formatUpdateAvailableHint", () => {
  it("returns null when no update is available", () => {
    const update = buildUpdate({});

    expect(formatUpdateAvailableHint(update)).toBeNull();
  });
});

describe("getUpdateCheckResult", () => {
  it("returns a disabled placeholder result", async () => {
    await expect(
      getUpdateCheckResult({
        timeoutMs: 1000,
        fetchGit: true,
        includeRegistry: true,
      }),
    ).resolves.toEqual({
      root: null,
      installKind: "unknown",
      packageManager: "unknown",
    });
  });
});
