import { targetsSchema } from "@/src/nutrition/inputs";
import { getTargets, setTargets } from "@/src/nutrition/store";
import { deviceOf, unpaired } from "../../auth";
import { body, ok } from "../http";

export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  if (!deviceOf(request)) return unpaired();
  return ok({ targets: getTargets() });
}

export async function PUT(request: Request): Promise<Response> {
  if (!deviceOf(request)) return unpaired();
  const input = await body(request, targetsSchema);
  if (input instanceof Response) return input;
  return ok({ targets: setTargets(input) });
}
