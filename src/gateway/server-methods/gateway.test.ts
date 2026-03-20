import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scheduleGatewaySigusr1Restart = vi.hoisted(() => vi.fn());
const resolveOpenClawPackageRoot = vi.hoisted(() => vi.fn());
const runCommandWithTimeout = vi.hoisted(() => vi.fn());
const existsSync = vi.hoisted(() => vi.fn());

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart,
}));

vi.mock("node:fs", () => {
  const fs = { existsSync };
  return { default: fs, ...fs };
});

vi.mock("../../infra/openclaw-root.js", () => ({
  resolveOpenClawPackageRoot,
}));

vi.mock("../../process/exec.js", () => ({
  runCommandWithTimeout,
}));

import { ErrorCodes } from "../protocol/index.js";
import { __resetGatewayBuildStateForTest, gatewayHandlers } from "./gateway.js";

const ORIGINAL_NVM_DIR = process.env.NVM_DIR;
const ORIGINAL_HOME = process.env.HOME;
const BUILDABLE_SOURCE_MARKERS = new Set([
  "/repo/openclaw/pnpm-lock.yaml",
  "/repo/openclaw/scripts/tsdown-build.mjs",
  "/repo/openclaw/ui/package.json",
]);

function invokeRestart(
  respond: ReturnType<typeof vi.fn>,
  client: Parameters<(typeof gatewayHandlers)["gateway.restart"]>[0]["client"] = null,
) {
  void gatewayHandlers["gateway.restart"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {} as never,
    client,
    isWebchatConnect: () => false,
  });
}

async function invokeBuild(
  respond: ReturnType<typeof vi.fn>,
  client: Parameters<(typeof gatewayHandlers)["gateway.build"]>[0]["client"] = null,
) {
  await gatewayHandlers["gateway.build"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {
      logGateway: {
        info: vi.fn(),
      },
    } as never,
    client,
    isWebchatConnect: () => false,
  });
}

describe("gateway.restart", () => {
  it("schedules a SIGUSR1 restart with audit context", () => {
    const respond = vi.fn();
    const client = {
      connect: {
        client: { id: "control-ui" },
        device: { id: "macbook" },
      },
      clientIp: "127.0.0.1",
    } as Parameters<(typeof gatewayHandlers)["gateway.restart"]>[0]["client"];

    invokeRestart(respond, client);

    expect(scheduleGatewaySigusr1Restart).toHaveBeenCalledWith({
      reason: "gateway.restart",
      audit: {
        actor: "control-ui",
        deviceId: "macbook",
        clientIp: "127.0.0.1",
      },
    });
  });

  it("responds with ok: true", () => {
    const respond = vi.fn();

    invokeRestart(respond);

    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);
  });
});

describe("gateway.build", () => {
  beforeEach(() => {
    __resetGatewayBuildStateForTest();
    resolveOpenClawPackageRoot.mockReset();
    runCommandWithTimeout.mockReset();
    existsSync.mockReset();
    existsSync.mockImplementation((filePath: string) => BUILDABLE_SOURCE_MARKERS.has(filePath));
    delete process.env.NVM_DIR;
  });

  afterEach(() => {
    if (ORIGINAL_NVM_DIR === undefined) {
      delete process.env.NVM_DIR;
    } else {
      process.env.NVM_DIR = ORIGINAL_NVM_DIR;
    }
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = ORIGINAL_HOME;
    }
  });

  it("runs pnpm build directly when PATH already resolves Node 24", async () => {
    const respond = vi.fn();
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "node") {
        return { stdout: "24\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm" && argv[1] === "--version") {
        return { stdout: "10.0.0\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm" && argv[1] === "build") {
        return { stdout: "build ok", stderr: "", code: 0 };
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    await invokeBuild(respond);

    expect(resolveOpenClawPackageRoot).toHaveBeenCalled();
    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      1,
      ["node", "-p", 'process.versions.node.split(".")[0]'],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      2,
      ["pnpm", "--version"],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      3,
      ["pnpm", "build"],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        code: 0,
        cwd: "/repo/openclaw",
        command: expect.stringContaining("pnpm build"),
        stdoutTail: "build ok",
        stderrTail: "",
        truncated: false,
      }),
      undefined,
    );
  });

  it("falls back to nvm when PATH does not resolve Node 24", async () => {
    const respond = vi.fn();
    process.env.NVM_DIR = "/custom/nvm";
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    existsSync.mockImplementation(
      (filePath: string) =>
        BUILDABLE_SOURCE_MARKERS.has(filePath) || filePath === "/custom/nvm/nvm.sh",
    );
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "node") {
        return { stdout: "22\n", stderr: "", code: 0 };
      }
      if (argv[0] === "bash") {
        return { stdout: "build ok", stderr: "", code: 0 };
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    await invokeBuild(respond);

    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      1,
      ["node", "-p", 'process.versions.node.split(".")[0]'],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      2,
      ["bash", "-lc", expect.stringContaining('source "/custom/nvm/nvm.sh"')],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(runCommandWithTimeout.mock.calls[1]?.[0]?.[2]).toContain("nvm use 24");
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        command: expect.stringContaining("bash -lc"),
      }),
      undefined,
    );
  });

  it("returns a clear Node 24 unavailable error when PATH is not Node 24 and nvm is missing", async () => {
    const respond = vi.fn();
    process.env.NVM_DIR = "/missing/nvm";
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    existsSync.mockImplementation((filePath: string) => BUILDABLE_SOURCE_MARKERS.has(filePath));
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "node") {
        return { stdout: "22\n", stderr: "", code: 0 };
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    await invokeBuild(respond);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: false,
        stderrTail: expect.stringContaining("Node 24 unavailable"),
      }),
      undefined,
    );
  });

  it("falls back to zsh when bash is unavailable but nvm is present", async () => {
    const respond = vi.fn();
    process.env.NVM_DIR = "/custom/nvm";
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    existsSync.mockImplementation(
      (filePath: string) =>
        BUILDABLE_SOURCE_MARKERS.has(filePath) || filePath === "/custom/nvm/nvm.sh",
    );
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "node") {
        return { stdout: "20\n", stderr: "", code: 0 };
      }
      if (argv[0] === "bash") {
        const err = new Error("spawn bash ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (argv[0] === "zsh") {
        return { stdout: "build ok", stderr: "", code: 0 };
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    await invokeBuild(respond);

    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      2,
      ["bash", "-lc", expect.any(String)],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(runCommandWithTimeout).toHaveBeenNthCalledWith(
      3,
      ["zsh", "-lc", expect.any(String)],
      expect.objectContaining({ cwd: "/repo/openclaw" }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        command: expect.stringContaining("zsh -lc"),
      }),
      undefined,
    );
  });

  it("returns a structured failure payload when the build exits non-zero", async () => {
    const respond = vi.fn();
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    runCommandWithTimeout.mockImplementation(async (argv: string[]) => {
      if (argv[0] === "node") {
        return { stdout: "24\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm" && argv[1] === "--version") {
        return { stdout: "10.0.0\n", stderr: "", code: 0 };
      }
      if (argv[0] === "pnpm" && argv[1] === "build") {
        return { stdout: "", stderr: "tsc failed", code: 1 };
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    await invokeBuild(respond);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: false,
        code: 1,
        stderrTail: "tsc failed",
      }),
      undefined,
    );
  });

  it("rejects non-source installs before probing Node or pnpm", async () => {
    const respond = vi.fn();
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    existsSync.mockReturnValue(false);

    await invokeBuild(respond);

    expect(runCommandWithTimeout).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: false,
        stderrTail: expect.stringContaining("not a buildable source checkout"),
      }),
      undefined,
    );
  });

  it("rejects concurrent builds", async () => {
    const firstRespond = vi.fn();
    const secondRespond = vi.fn();
    let resolveBuild: ((value: { stdout: string; stderr: string; code: number }) => void) | null =
      null;
    resolveOpenClawPackageRoot.mockResolvedValue("/repo/openclaw");
    runCommandWithTimeout.mockImplementation((argv: string[]) => {
      if (argv[0] === "node") {
        return Promise.resolve({ stdout: "24\n", stderr: "", code: 0 });
      }
      if (argv[0] === "pnpm" && argv[1] === "--version") {
        return Promise.resolve({ stdout: "10.0.0\n", stderr: "", code: 0 });
      }
      if (argv[0] === "pnpm" && argv[1] === "build") {
        return new Promise((resolve) => {
          resolveBuild = resolve;
        });
      }
      throw new Error(`unexpected argv: ${argv.join(" ")}`);
    });

    const firstCall = invokeBuild(firstRespond);
    await Promise.resolve();
    await invokeBuild(secondRespond);

    await vi.waitFor(() => {
      expect(resolveBuild).not.toBeNull();
    });

    expect(secondRespond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.UNAVAILABLE,
        message: "gateway build already running",
      }),
    );

    resolveBuild?.({ stdout: "", stderr: "", code: 0 });
    await firstCall;
  });
});
