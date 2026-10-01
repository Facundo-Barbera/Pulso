import type { z } from "zod";
import { apiFailure } from "@/src/nutrition/api";
import { NO_STORE } from "../auth";

export const ok = (body: unknown) => Response.json(body, { headers: NO_STORE });
export const invalid = (message: string, status = 400) => Response.json({ code: "invalid_request", message }, { status, headers: NO_STORE });

/** Parses a JSON body with a zod schema; a Response when it doesn't fit. */
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? parsed.data : invalid(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
}

/** `?date=YYYY-MM-DD`, or undefined when absent; null when malformed. */
export function dateParam(request: Request, name = "date"): string | undefined | null {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Runs a dated-plan call (horizon, ops, recipes, pantry…): known errors → 400/404/409 with a Spanish message. */
export async function diet(run: () => unknown): Promise<Response> {
  try {
    return ok(await run());
  } catch (error) {
    const failure = apiFailure(error);
    if (!failure) throw error;
    const { status, ...rest } = failure;
    return Response.json(rest, { status, headers: NO_STORE });
  }
}

/** `?name=` as an integer within [min, max]; undefined when absent, null when not one. */
export function intParam(request: Request, name: string, min: number, max: number): number | undefined | null {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
