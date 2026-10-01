import type { McpScope, McpToolInfo } from "@pulso/contract";
import { TOOLS, type PulsoTool } from "../agent/registry";

/**
 * Every Coach tool, classified for external clients. A tool missing here is
 * treated as `write` (hidden from read-only clients) and fails access.test.ts,
 * so a new tool never reaches other agents as readable by accident.
 */
const ACCESS: Record<string, McpToolInfo["access"]> = {
  list_workouts: "read",
  get_profile: "read",
  update_profile: "write",
  log_meal: "write",
  delete_meal: "write",
  list_meals: "read",
  daily_summary: "read",
  get_targets: "read",
  set_targets: "write",
  create_diet_plan: "write",
  get_active_plan: "read",
  lookup_food_barcode: "read",
  list_exercises: "read",
  get_exercise: "read",
  create_program: "write",
  get_active_program: "read",
  list_sessions: "read",
  exercise_history: "read",
  suggest_next_loads: "read",
  log_session: "write",
  list_body_scans: "read",
  add_body_scan: "write",
  body_projection: "read",
  set_body_goal: "write",
  get_daily_metrics: "read",
  get_readiness: "read",
  get_sleep_nights: "read",
  get_sleep_summary: "read",
  set_sleep_target: "write",
  list_medications: "read",
  add_medication: "write",
  update_medication: "write",
  log_dose: "write",
  get_adherence: "read",
  get_latest_brief: "read",
};

/** Tools touching the profile or medications: their descriptions say so to outside agents. */
const PERSONAL = /^(get_profile|update_profile|list_medications|add_medication|update_medication|log_dose|get_adherence)$/;
const PERSONAL_NOTE = " This is the person's private health data: use it only for what they asked, and do not copy it elsewhere.";

export const classified = (name: string): boolean => name in ACCESS;
export const accessOf = (name: string): McpToolInfo["access"] => ACCESS[name] ?? "write";

export const toolInfos = (): McpToolInfo[] => TOOLS.map((t) => ({ name: t.name, access: accessOf(t.name) }));

/** What a client with `scope` sees; write tools do not exist for a read-only one. */
export function visibleTools(scope: McpScope): PulsoTool[] {
  return TOOLS.filter((t) => scope === "read+write" || accessOf(t.name) === "read");
}

export const describeFor = (t: PulsoTool): string => (PERSONAL.test(t.name) ? t.description + PERSONAL_NOTE : t.description);
