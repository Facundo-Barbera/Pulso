/**
 * What the phone (`/api/mobile/nutrition/…`) and web (`/api/web/dieta/…`)
 * routes for the dated plan share: running an op from a body, and mapping the
 * engine's errors to a status and a Spanish message.
 */
import { ZodError } from "zod";
import { ShoppingError } from "../shopping/errors";
import { PlanError } from "./horizon";
import { OPS } from "./ops";
import { planOpSchema } from "./plan-inputs";
import { RecipeError } from "./recipes";
import { RevisionError } from "./revisions";

/** Runs `{ op, ...fields }` (see plan-inputs.ts). */
export function runOp(body: unknown) {
  const { op, ...input } = planOpSchema.parse(body) as { op: keyof typeof OPS } & Record<string, unknown>;
  return (OPS[op] as (input: unknown) => unknown)(input);
}

/** `detail` carries the engine's own (English) reason when the Spanish message is generic. */
export type ApiFailure = { status: number; code: string; message: string; detail?: string };

/** A known error as a response body, or null to rethrow. */
export function apiFailure(error: unknown): ApiFailure | null {
  if (error instanceof ZodError) return { status: 400, code: "invalid_request", message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") };
  if (error instanceof ShoppingError) return { status: error.code === "not_found" ? 404 : 409, code: error.code, message: error.code === "not_found" ? "Eso ya no está." : "No hay un plan de dieta activo." };
  if (error instanceof RevisionError) return { status: 409, code: "cannot_undo", message: error.message.startsWith("Nothing") ? "No hay nada que deshacer." : error.message.startsWith("A later") ? "Antes hay que deshacer un cambio posterior en esos días." : "Ese cambio ya no se puede deshacer." };
  if (error instanceof RecipeError) return { status: 404, code: "not_found", message: "Esa receta o ese batch ya no existe." };
  if (error instanceof PlanError && error.message.startsWith("No active diet plan")) return { status: 409, code: "no_plan", message: "No hay un plan de dieta activo." };
  if (error instanceof PlanError) return { status: 409, code: "plan_conflict", message: "Ese cambio no encaja con el plan.", detail: error.message };
  return null;
}
