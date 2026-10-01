import type { McpToolInfo } from "@pulso/contract";
import { toolInfos } from "@/src/mcp/access";
import { macOnly, NO_STORE } from "../guard";

export const dynamic = "force-dynamic";

/** `McpToolInfo[]`: every tool and whether it reads or writes, for the settings page. */
export function GET(request: Request): Response {
  const refused = macOnly(request);
  if (refused) return refused;
  const body: McpToolInfo[] = toolInfos();
  return Response.json(body, { headers: NO_STORE });
}
