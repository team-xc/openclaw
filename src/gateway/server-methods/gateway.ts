import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRoot } from "../../infra/openclaw-root.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { runCommandWithTimeout } from "../../process/exec.js";
import { resolveControlPlaneActor } from "../control-plane-audit.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const GATEWAY_BUILD_TIMEOUT_MS = 15 * 60 * 1000;
const GATEWAY_BUILD_PROBE_TIMEOUT_MS = 10_000;
const GATEWAY_BUILD_OUTPUT_TAIL_MAX_CHARS = 12_000;
const GATEWAY_REQUIRED_NODE_MAJOR = 24;
const GATEWAY_BUILD_COMMAND = "pnpm build";
const GATEWAY_BUILD_NVM_FALLBACK_SHELLS = ["bash", "zsh"] as const;
const GATEWAY_BUILD_SOURCE_MARKERS = [
  "pnpm-lock.yaml",
  "scripts/tsdown-build.mjs",
  "ui/package.json",
] as const;

export type GatewayBuildResult = {
  ok: boolean;
  code: number;
  durationMs: number;
  cwd: string | null;
  command: string;
  stdoutTail: string;
  stderrTail: string;
  truncated: boolean;
};

let gatewayBuildInFlight: Promise<GatewayBuildResult> | null = null;

function trimOutputTail(text: string, maxChars = GATEWAY_BUILD_OUTPUT_TAIL_MAX_CHARS) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }
  return {
    text: text.slice(-maxChars),
    truncated: true,
  };
}

function createGatewayBuildResult(params: {
  startedAt: number;
  cwd: string | null;
  command: string;
  stdout: string;
  stderr: string;
  code: number;
}) {
  const stdout = trimOutputTail(params.stdout);
  const stderr = trimOutputTail(params.stderr);
  return {
    ok: params.code === 0,
    code: params.code,
    durationMs: Date.now() - params.startedAt,
    cwd: params.cwd,
    command: params.command,
    stdoutTail: stdout.text,
    stderrTail: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
  };
}

function isBuildableSourceCheckout(root: string) {
  return GATEWAY_BUILD_SOURCE_MARKERS.every((relativePath) =>
    fs.existsSync(path.join(root, relativePath)),
  );
}

function resolveNvmScriptPath() {
  const explicitNvmDir = process.env.NVM_DIR?.trim();
  if (explicitNvmDir) {
    const explicitScriptPath = path.join(explicitNvmDir, "nvm.sh");
    if (fs.existsSync(explicitScriptPath)) {
      return explicitScriptPath;
    }
  }

  const home = process.env.HOME?.trim();
  if (!home) {
    return null;
  }
  const fallbackScriptPath = path.join(home, ".nvm", "nvm.sh");
  return fs.existsSync(fallbackScriptPath) ? fallbackScriptPath : null;
}

function createNvmBuildCommand(nvmScriptPath: string) {
  const nvmDir = path.dirname(nvmScriptPath);
  return [
    `export NVM_DIR=${JSON.stringify(nvmDir)}`,
    `source ${JSON.stringify(nvmScriptPath)}`,
    `nvm use ${GATEWAY_REQUIRED_NODE_MAJOR} >/dev/null`,
    'if [ "$(node -p \'process.versions.node.split(".")[0]\')" != "24" ]; then',
    '  echo "Node 24 unavailable after nvm use 24" >&2',
    "  exit 1",
    "fi",
    "if ! command -v pnpm >/dev/null 2>&1; then",
    '  echo "pnpm not found after nvm use 24" >&2',
    "  exit 1",
    "fi",
    GATEWAY_BUILD_COMMAND,
  ].join("\n");
}

async function probeNodeMajor(cwd: string): Promise<number | null> {
  try {
    const result = await runCommandWithTimeout(
      ["node", "-p", 'process.versions.node.split(".")[0]'],
      {
        timeoutMs: GATEWAY_BUILD_PROBE_TIMEOUT_MS,
        cwd,
      },
    );
    if (result.code !== 0) {
      return null;
    }
    const major = Number.parseInt(result.stdout.trim(), 10);
    return Number.isFinite(major) ? major : null;
  } catch {
    return null;
  }
}

async function probePnpmAvailable(cwd: string): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["pnpm", "--version"], {
      timeoutMs: GATEWAY_BUILD_PROBE_TIMEOUT_MS,
      cwd,
    });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function runGatewayBuildCommand(params: {
  cwd: string;
  argv: string[];
  command: string;
  startedAt: number;
}) {
  const result = await runCommandWithTimeout(params.argv, {
    timeoutMs: GATEWAY_BUILD_TIMEOUT_MS,
    cwd: params.cwd,
  });
  return createGatewayBuildResult({
    startedAt: params.startedAt,
    cwd: params.cwd,
    command: params.command,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code ?? 1,
  });
}

async function runGatewayBuildCommandSafe(params: {
  cwd: string;
  argv: string[];
  command: string;
  startedAt: number;
}) {
  try {
    return await runGatewayBuildCommand(params);
  } catch (err) {
    return createGatewayBuildResult({
      startedAt: params.startedAt,
      cwd: params.cwd,
      command: params.command,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      code: 1,
    });
  }
}

async function runGatewayBuildViaNvm(params: {
  cwd: string;
  nvmScriptPath: string;
  startedAt: number;
}): Promise<GatewayBuildResult> {
  const shellCommand = createNvmBuildCommand(params.nvmScriptPath);
  let lastSpawnError: Error | null = null;

  for (const shell of GATEWAY_BUILD_NVM_FALLBACK_SHELLS) {
    try {
      return await runGatewayBuildCommand({
        cwd: params.cwd,
        argv: [shell, "-lc", shellCommand],
        command: `${shell} -lc ${JSON.stringify(shellCommand)}`,
        startedAt: params.startedAt,
      });
    } catch (err) {
      lastSpawnError = err instanceof Error ? err : new Error(String(err));
      if (
        !(lastSpawnError as NodeJS.ErrnoException).code ||
        (lastSpawnError as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        break;
      }
    }
  }

  const searchedShells = GATEWAY_BUILD_NVM_FALLBACK_SHELLS.join(", ");
  const reason = lastSpawnError
    ? `No supported shell available for nvm fallback (${searchedShells}): ${lastSpawnError.message}`
    : `No supported shell available for nvm fallback (${searchedShells})`;
  return createGatewayBuildResult({
    startedAt: params.startedAt,
    cwd: params.cwd,
    command: GATEWAY_BUILD_COMMAND,
    stdout: "",
    stderr: reason,
    code: 1,
  });
}

async function runGatewayBuild(): Promise<GatewayBuildResult> {
  const startedAt = Date.now();
  const cwd =
    (await resolveOpenClawPackageRoot({
      argv1: process.argv[1],
      moduleUrl: import.meta.url,
      cwd: process.cwd(),
    })) ?? null;

  if (!cwd) {
    return {
      ok: false,
      code: 1,
      durationMs: Date.now() - startedAt,
      cwd: null,
      command: GATEWAY_BUILD_COMMAND,
      stdoutTail: "",
      stderrTail: "OpenClaw package root not found for gateway.build",
      truncated: false,
    };
  }

  if (!isBuildableSourceCheckout(cwd)) {
    return createGatewayBuildResult({
      startedAt,
      cwd,
      command: GATEWAY_BUILD_COMMAND,
      stdout: "",
      stderr:
        "Current OpenClaw installation is not a buildable source checkout " +
        "(missing source-build files such as pnpm-lock.yaml, scripts/tsdown-build.mjs, or ui/package.json)",
      code: 1,
    });
  }

  const nodeMajor = await probeNodeMajor(cwd);
  if (nodeMajor === GATEWAY_REQUIRED_NODE_MAJOR) {
    const pnpmAvailable = await probePnpmAvailable(cwd);
    if (!pnpmAvailable) {
      return createGatewayBuildResult({
        startedAt,
        cwd,
        command: GATEWAY_BUILD_COMMAND,
        stdout: "",
        stderr: "pnpm not found on PATH for gateway.build",
        code: 1,
      });
    }
    return await runGatewayBuildCommandSafe({
      cwd,
      argv: ["pnpm", "build"],
      command: GATEWAY_BUILD_COMMAND,
      startedAt,
    });
  }

  const nvmScriptPath = resolveNvmScriptPath();
  if (!nvmScriptPath) {
    return createGatewayBuildResult({
      startedAt,
      cwd,
      command: GATEWAY_BUILD_COMMAND,
      stdout: "",
      stderr:
        `Node ${GATEWAY_REQUIRED_NODE_MAJOR} unavailable for gateway.build ` +
        `(current PATH resolves ${nodeMajor == null ? "unknown" : `Node ${nodeMajor}`}, and no nvm.sh was found)`,
      code: 1,
    });
  }

  return await runGatewayBuildViaNvm({ cwd, nvmScriptPath, startedAt });
}

export function __resetGatewayBuildStateForTest() {
  gatewayBuildInFlight = null;
}

export const gatewayHandlers: GatewayRequestHandlers = {
  "gateway.restart": ({ respond, client }) => {
    const actor = resolveControlPlaneActor(client);
    scheduleGatewaySigusr1Restart({
      reason: "gateway.restart",
      audit: {
        actor: actor.actor,
        deviceId: actor.deviceId,
        clientIp: actor.clientIp,
      },
    });
    respond(true, { ok: true }, undefined);
  },
  "gateway.build": async ({ respond, client, context }) => {
    if (gatewayBuildInFlight) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, "gateway build already running", {
          retryable: true,
        }),
      );
      return;
    }
    const actor = resolveControlPlaneActor(client);
    context.logGateway.info("gateway build requested", {
      event: "gateway_build_requested",
      actor: actor.actor,
      deviceId: actor.deviceId,
      clientIp: actor.clientIp,
    });
    gatewayBuildInFlight = runGatewayBuild().finally(() => {
      gatewayBuildInFlight = null;
    });
    const result = await gatewayBuildInFlight;
    context.logGateway.info("gateway build finished", {
      event: "gateway_build_finished",
      actor: actor.actor,
      deviceId: actor.deviceId,
      clientIp: actor.clientIp,
      ok: result.ok,
      code: result.code,
      durationMs: result.durationMs,
    });
    respond(true, result, undefined);
  },
};
