import { ZodError } from "zod";
import { ShoppingError } from "@/src/shopping/store";
import { NO_STORE } from "../auth";

/** Runs a store call, mapping validation errors to 400, a missing item to 404 and "no active plan" to 409. */
export async function respond(run: () => unknown): Promise<Response> {
  try {
    return Response.json(await run(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return Response.json({ code: "invalid_request", message }, { status: 400, headers: NO_STORE });
    }
    if (error instanceof ShoppingError) {
      return Response.json({ code: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 409, headers: NO_STORE });
    }
    throw error;
  }
}

export const body = (request: Request) => request.json().catch(() => undefined);
