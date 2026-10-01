import type { WebMe } from "@pulso/contract";
import { callerOf, CLEAR_COOKIE } from "@/src/device-auth";
import { forgetDevice } from "@/src/devices";
import { fromTailnet } from "@/src/tailnet-gate";
import { json, NO_STORE } from "../http";

export const dynamic = "force-dynamic";

/** Who the web app is talking to: this Mac (`local`) or a paired browser. */
export function GET(request: Request): Response {
  const local = !fromTailnet(request.headers);
  const body: WebMe = { local, device: local ? null : (callerOf(request.headers).device ?? null) };
  return json(body);
}

/** Unpairs the browser asking — a friend's computer, when done — and clears its cookie. */
export function DELETE(request: Request): Response {
  if (!fromTailnet(request.headers)) return json({ code: "local", message: "La Mac no está emparejada: no hay nada que olvidar." }, 400);
  const device = callerOf(request.headers).device;
  if (device) forgetDevice(device.id);
  return Response.json({ ok: true }, { headers: { ...NO_STORE, "set-cookie": CLEAR_COOKIE } });
}
