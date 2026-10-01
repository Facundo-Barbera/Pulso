import { agentsOverview } from "@/src/web/agents";
import { json, loopbackOnly } from "../../http";

export const dynamic = "force-dynamic";

/** `AgentsOverview`: MCP clients with their recent calls. The Mac only. */
export function GET(request: Request): Response {
  return loopbackOnly(request) ?? json(agentsOverview());
}
