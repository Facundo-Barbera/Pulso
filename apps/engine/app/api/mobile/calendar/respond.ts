import { ZodError } from "zod";
import { CalendarError } from "@/src/calendar/store";
import { NO_STORE } from "../auth";

/** Runs a calendar call, mapping validation and not-found errors to 400/404. */
export async function respond(run: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    return Response.json(await run(), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return Response.json({ code: "invalid_request", message }, { status: 400, headers: NO_STORE });
    }
    if (error instanceof CalendarError) {
      return Response.json({ code: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 400, headers: NO_STORE });
    }
    throw error;
  }
}

export const body = (request: Request) => request.json().catch(() => undefined);

export const params = (request: Request) => new URL(request.url).searchParams;

export type IdContext = { params: Promise<{ id: string }> };
