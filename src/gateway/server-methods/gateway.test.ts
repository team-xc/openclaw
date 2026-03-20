import { describe, expect, it, vi } from "vitest";

const scheduleGatewaySigusr1Restart = vi.hoisted(() => vi.fn());

vi.mock("../../infra/restart.js", () => ({
  scheduleGatewaySigusr1Restart,
}));

import { gatewayHandlers } from "./gateway.js";

function invokeRestart(
  respond: ReturnType<typeof vi.fn>,
  client: Parameters<(typeof gatewayHandlers)["gateway.restart"]>[0]["client"] = null,
) {
  gatewayHandlers["gateway.restart"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {} as never,
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
