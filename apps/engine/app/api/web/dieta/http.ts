import { ZodError, type z } from "zod";
import { ShoppingError } from "@/src/shopping/store";
import { json } from "../http";

export const invalid = (message: string, status = 400) => json({ code: "invalid_request", message }, status);

/** Parses a JSON body with a zod schema; a Response when it doesn't fit. */
export async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await request.json().catch(() => undefined));
  return parsed.success ? parsed.data : invalid(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
}

/** `?date=YYYY-MM-DD`, or undefined when absent; null when malformed. */
export function dateParam(request: Request, name = "date"): string | undefined | null {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Runs a shopping store call: validation → 400, a missing item → 404, no active plan → 409. */
export async function shopping(run: () => unknown): Promise<Response> {
  try {
    return json(await run());
  } catch (error) {
    if (error instanceof ZodError) return invalid(error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (error instanceof ShoppingError) return json({ code: error.code, message: error.message }, error.code === "not_found" ? 404 : 409);
    throw error;
  }
}
