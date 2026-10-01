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

// The store speaks English to the agent; the web shows these.
const SHOPPING_MESSAGES = { not_found: "Eso ya no está en la lista.", no_plan: "No hay un plan de dieta activo del que sacar la lista." };

/** Runs a shopping store call: validation → 400, a missing item → 404, no active plan → 409. */
export async function shopping(run: () => unknown): Promise<Response> {
  try {
    return json(await run());
  } catch (error) {
    if (error instanceof ZodError) return invalid(error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    if (error instanceof ShoppingError) return json({ code: error.code, message: SHOPPING_MESSAGES[error.code] }, error.code === "not_found" ? 404 : 409);
    throw error;
  }
}
