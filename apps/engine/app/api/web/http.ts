import { fromTailnet } from "@/src/tailnet-gate";

export const NO_STORE = { "cache-control": "no-store" };

export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/**
 * Admin routes answer on the Mac only. The gate already refuses `/api/web/admin/*`
 * from the tailnet; this is the second lock, so a gate mistake is not a hole.
 */
export function loopbackOnly(request: Request): Response | undefined {
  if (fromTailnet(request.headers)) return json({ code: "tailnet_closed", message: "Esto sólo responde en la Mac que corre Pulso." }, 403);
  return undefined;
}
