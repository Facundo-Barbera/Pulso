import { NextResponse, type NextRequest } from "next/server";
import { fromTailnet, gate } from "@/src/tailnet-gate";

/** Runs before every route. Loopback passes untouched; tailnet traffic goes through the gate. */
export default function proxy(request: NextRequest): NextResponse {
  if (!fromTailnet(request.headers)) return NextResponse.next();
  const verdict = gate(request.nextUrl.pathname);
  if (verdict.allow) return NextResponse.next();
  return NextResponse.json({ code: "tailnet_closed", message: verdict.reason }, { status: verdict.status, headers: { "cache-control": "no-store" } });
}

export const config = { matcher: "/:path*" };
