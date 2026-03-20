import { describe, expect, it, vi } from "vitest";
import { restartGateway, runGatewayBuild } from "./debug.ts";

function createState() {
  return {
    client: {
      request: vi.fn(),
    },
    connected: true,
    debugLoading: false,
    debugStatus: null,
    debugHealth: null,
    debugModels: [],
    debugHeartbeat: null,
    debugCallMethod: "",
    debugCallParams: "{}",
    debugCallResult: null,
    debugCallError: null,
    debugBuildRunning: false,
    debugBuildResult: null,
    debugBuildError: null,
    debugRestarting: false,
  };
}

describe("restartGateway", () => {
  it("keeps restarting state active after a successful restart request", async () => {
    const state = createState();
    state.client.request.mockResolvedValue({ ok: true });

    await restartGateway(state);

    expect(state.client.request).toHaveBeenCalledWith("gateway.restart", {});
    expect(state.debugRestarting).toBe(true);
    expect(state.debugCallError).toBeNull();
  });

  it("clears restarting state when the restart request fails", async () => {
    const state = createState();
    state.client.request.mockRejectedValue(new Error("boom"));

    await restartGateway(state);

    expect(state.debugRestarting).toBe(false);
    expect(state.debugCallError).toContain("boom");
  });
});

describe("runGatewayBuild", () => {
  it("stores the structured build result without touching manual RPC state", async () => {
    const state = createState();
    state.debugCallResult = '{"ok":true}';
    state.client.request.mockResolvedValue({
      ok: true,
      code: 0,
      durationMs: 123,
      cwd: "/repo/openclaw",
      command: "source ~/.nvm/nvm.sh && nvm use 24 && pnpm build",
      stdoutTail: "done",
      stderrTail: "",
      truncated: false,
    });

    await runGatewayBuild(state);

    expect(state.client.request).toHaveBeenCalledWith("gateway.build", {});
    expect(state.debugBuildRunning).toBe(false);
    expect(state.debugBuildResult).toEqual(
      expect.objectContaining({
        ok: true,
        code: 0,
        cwd: "/repo/openclaw",
      }),
    );
    expect(state.debugBuildError).toBeNull();
    expect(state.debugCallResult).toBe('{"ok":true}');
  });

  it("stores build request errors separately from manual RPC errors", async () => {
    const state = createState();
    state.debugCallError = "rpc failed";
    state.client.request.mockRejectedValue(new Error("build failed"));

    await runGatewayBuild(state);

    expect(state.debugBuildRunning).toBe(false);
    expect(state.debugBuildResult).toBeNull();
    expect(state.debugBuildError).toContain("build failed");
    expect(state.debugCallError).toBe("rpc failed");
  });
});
