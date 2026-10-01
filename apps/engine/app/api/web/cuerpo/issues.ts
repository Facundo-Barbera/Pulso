import type { z } from "zod";
import { json } from "../http";

/** A 400 naming each field zod refused. */
export const invalid = (error: z.ZodError) =>
  json({ code: "invalid_request", message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") }, 400);
