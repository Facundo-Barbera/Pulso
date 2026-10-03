import { SleepError } from "./manual";

const NO_STORE = { "cache-control": "no-store" };
const STATUS: Record<SleepError["code"], number> = { invalid: 400, not_found: 404, measured: 409, taken: 409 };

/** Runs a manual-night store call for a route; its errors become 400/404/409 with a Spanish `message` to show as is. */
export function respond(run: () => unknown, status = 200): Response {
  try {
    return Response.json(run(), { status, headers: NO_STORE });
  } catch (error) {
    if (error instanceof SleepError) return Response.json({ code: error.code, message: error.message }, { status: STATUS[error.code], headers: NO_STORE });
    throw error;
  }
}

export const invalid = () =>
  Response.json({ code: "invalid_request", message: "Faltan la hora de dormir o la de despertar." }, { status: 400, headers: NO_STORE });
