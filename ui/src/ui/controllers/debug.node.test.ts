import { describe, expect, it, vi } from "vitest";
import { restartGateway } from "./debug.ts";

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
