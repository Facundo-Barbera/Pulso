import { NextResponse, type NextRequest } from "next/server";
import { callerOf, CLEAR_COOKIE, sameOrigin } from "@/src/device-auth";
import { fromTailnet, gate } from "@/src/tailnet-gate";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Runs before every route. Loopback passes untouched (the Electron window and
 * this Mac keep full trust); tailnet traffic goes through the gate. An unpaired
 * browser opening a page gets the `/pair` form in its place; an API call gets
 * the 401/403 as JSON; a cookie that names nobody is cleared.
 */
export default function proxy(request: NextRequest): NextResponse {
  if (!fromTailnet(request.headers)) return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  const caller = callerOf(request.headers);
  const verdict = gate({ method: request.method, pathname, device: caller.device });
  if (verdict.allow) {
    if (caller.via === "cookie" && !sameOrigin(request.method, request.headers)) {
      return NextResponse.json({ code: "cross_origin", message: "Una escritura con la cookie de Pulso tiene que venir de la propia página." }, { status: 403, headers: NO_STORE });
    }
    return NextResponse.next();
  }
  // Served in place rather than redirected: Next wants an absolute Location, and the only host it knows is 127.0.0.1.
  const response =
    verdict.status === 401 && request.method === "GET" && !pathname.startsWith("/api/") && !pathname.startsWith("/_next/")
      ? NextResponse.rewrite(pairUrl(request), { headers: NO_STORE })
      : NextResponse.json({ code: verdict.status === 401 ? "unpaired" : "tailnet_closed", message: verdict.reason }, { status: verdict.status, headers: NO_STORE });
  if (caller.via === "cookie" && !caller.device) response.headers.set("set-cookie", CLEAR_COOKIE);
  return response;
}

/** The pair form, remembering where the browser was going so pairing lands there. */
function pairUrl(request: NextRequest): URL {
  const url = new URL("/pair", request.nextUrl);
  url.search = "";
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return url;
}

export const config = { matcher: "/:path*" };
