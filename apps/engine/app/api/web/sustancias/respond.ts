import { ZodError } from "zod";
import { SubstanceError } from "@/src/substances/store";
import { shownHere } from "@/src/substances/web";
import { json } from "../http";

/** Sustancias answers only where the person turned it on; elsewhere it is as if it were not there. */
export function hidden(request: Request): Response | undefined {
  return shownHere(request.headers) ? undefined : json({ code: "hidden", message: "Sustancias está oculto en este navegador." }, 404);
}

/** Runs a store call, mapping validation and not-found errors to 400/404. */
export function respond(run: () => unknown, status = 200): Response {
  try {
    return json(run(), status);
  } catch (error) {
    if (error instanceof ZodError) return json({ code: "invalid_request", message: `Revisa los datos: ${error.issues.map((i) => i.path.join(".") || "cuerpo").join(", ")}.` }, 400);
    if (error instanceof SubstanceError) return json({ code: error.code, message: error.code === "not_found" ? "Ya no existe: recarga la página." : error.message }, error.code === "not_found" ? 404 : 400);
    throw error;
  }
}

export const body = (request: Request) => request.json().catch(() => undefined);
