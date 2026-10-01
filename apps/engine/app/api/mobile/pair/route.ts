import { PairingError, redeemPairing } from "@/src/devices";
import { NO_STORE } from "../auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { code?: unknown; name?: unknown };
  if (typeof body.code !== "string") return Response.json({ code: "invalid_request", message: "expected { code, name }" }, { status: 400 });
  try {
    return Response.json(redeemPairing({ code: body.code, name: typeof body.name === "string" ? body.name : "iPhone", kind: "phone" }), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof PairingError) return Response.json({ code: error.code, message: error.message }, { status: 401 });
    throw error;
  }
}
