import { VIA_HEADER } from "@pulso/contract";

export const NO_STORE = { "cache-control": "no-store" };

/**
 * The gate already keeps the tailnet off this path; this is the second lock,
 * so minting secrets stays the Mac's alone even if the gate changes.
 */
export function macOnly(request: Request): Response | undefined {
  if (request.headers.get(VIA_HEADER) !== "tailnet") return undefined;
  return Response.json({ code: "tailnet_closed", message: "Sólo se administra desde la Mac que corre Pulso." }, { status: 403, headers: NO_STORE });
}

export const badRequest = (message: string) => Response.json({ code: "bad_request", message }, { status: 400, headers: NO_STORE });
export const notFound = () => Response.json({ code: "not_found", message: "No existe ese cliente." }, { status: 404, headers: NO_STORE });

export async function jsonBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const body = await request.json().catch(() => undefined);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
}
