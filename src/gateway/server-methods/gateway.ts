import { resolveControlPlaneActor } from "../control-plane-audit.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import type { GatewayRequestHandlers } from "./types.js";

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
};
