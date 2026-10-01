import { ZodError } from "zod";
import { DATE, localNow, TIME } from "@/src/medication/schedule";
import { MedicationError } from "@/src/medication/store";
import { NO_STORE } from "../auth";

export const ok = (body: unknown) => Response.json(body, { headers: NO_STORE });

/** Runs a store call, mapping validation and not-found errors to 400/404. */
export async function respond(run: () => unknown | Promise<unknown>): Promise<Response> {
  try {
    return ok(await run());
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
      return Response.json({ code: "invalid_request", message }, { status: 400, headers: NO_STORE });
    }
    if (error instanceof MedicationError) {
      return Response.json({ code: error.code, message: error.message }, { status: error.code === "not_found" ? 404 : 400, headers: NO_STORE });
    }
    throw error;
  }
}

export const body = (request: Request) => request.json().catch(() => undefined);

/** The phone's local date/time from `?date=&time=`, falling back to the Mac's clock. */
export function asOf(request: Request): { date: string; time: string } {
  const params = new URL(request.url).searchParams;
  const now = localNow();
  const date = params.get("date") ?? "";
  const time = params.get("time") ?? "";
  return { date: DATE.test(date) ? date : now.date, time: TIME.test(time) ? time : now.time };
}
