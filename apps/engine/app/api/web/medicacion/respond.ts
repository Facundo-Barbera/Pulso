import { ZodError } from "zod";
import { MedicationError } from "@/src/medication/store";
import { json } from "../http";

/** Runs a store call, mapping validation and not-found errors to 400/404. */
export function respond(run: () => unknown): Response {
  try {
    return json(run());
  } catch (error) {
    if (error instanceof ZodError) return json({ code: "invalid_request", message: `Revisa los datos: ${error.issues.map((i) => i.path.join(".") || "cuerpo").join(", ")}.` }, 400);
    if (error instanceof MedicationError) return json({ code: error.code, message: error.code === "not_found" ? "Ya no existe: recarga la página." : error.message }, error.code === "not_found" ? 404 : 400);
    throw error;
  }
}

export const body = (request: Request) => request.json().catch(() => undefined);

export type IdContext = { params: Promise<{ id: string }> };
