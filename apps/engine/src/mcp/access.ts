import type { McpScope, McpToolInfo } from "@pulso/contract";
import { TOOLS, type PulsoTool } from "../agent/registry";

/**
 * Every Coach tool, classified for external clients. A tool missing here is
 * treated as `write` (hidden from read-only clients) and fails access.test.ts,
 * so a new tool never reaches other agents as readable by accident.
 */
const ACCESS: Record<string, McpToolInfo["access"]> = {
  list_workouts: "read",
  list_activity: "read",
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
  adjust_day_plan: "write",
  get_diet_horizon: "read",
  skip_slot: "write",
  replace_slot: "write",
  ate_out: "write",
  place_meal: "write",
  rebalance_day: "write",
  spread_deviation: "write",
  ingredient_unavailable: "write",
  no_time_to_cook: "write",
  move_slot: "write",
  swap_days: "write",
  fill_slot: "write",
  create_recipe: "write",
  list_recipes: "read",
  suggest_prep_days: "read",
  schedule_prep: "write",
  mark_prep_cooked: "write",
  use_leftover: "write",
  list_plan_changes: "read",
  undo_plan_change: "write",
  log_water: "write",
  get_water: "read",
  set_water_goal: "write",
  get_calendar: "read",
  set_availability: "write",
  add_busy_block: "write",
  update_busy_block: "write",
  remove_busy_block: "write",
  add_health_event: "write",
  update_health_event: "write",
  list_health_events: "read",
  plan_training_week: "write",
  update_planned_session: "write",
  set_meal_times: "write",
  lookup_food_barcode: "read",
  estimate_portion: "read",
  list_dishes: "read",
  save_dish: "write",
  log_dish: "write",
  update_dish: "write",
  delete_dish: "write",
  list_exercises: "read",
  get_exercise: "read",
  create_program: "write",
  get_active_program: "read",
  list_sessions: "read",
  exercise_history: "read",
  suggest_next_loads: "read",
  log_session: "write",
  edit_program_day: "write",
  swap_program_exercise: "write",
  find_similar_exercises: "read",
  get_training_preferences: "read",
  set_training_preferences: "write",
  set_exercise_unit: "write",
  get_live_session: "read",
  edit_live_session: "write",
  set_session_adjustment: "write",
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
  generate_shopping_list: "write",
  get_shopping_list: "read",
  add_shopping_items: "write",
  update_shopping_item: "write",
  check_shopping_items: "write",
  remove_shopping_items: "write",
  list_substances: "read",
  create_substance: "write",
  log_substance_use: "write",
  list_substance_use: "read",
  substance_summary: "read",
  delete_substance_use: "write",
  set_substance_goal: "write",
};

/** Tools touching the profile, medications or Sustancias: their descriptions say so to outside agents. */
const PERSONAL = /^(get_profile|update_profile|list_medications|add_medication|update_medication|log_dose|get_adherence|.*substance.*)$/;
/** Sustancias: hidden from every external client unless the person granted it the sensitive scope, and from the Coach's briefs. */
export const SENSITIVE = /substance/;
const PERSONAL_NOTE = " This is the person's private health data: use it only for what they asked, and do not copy it elsewhere.";

export const classified = (name: string): boolean => name in ACCESS;
export const accessOf = (name: string): McpToolInfo["access"] => ACCESS[name] ?? "write";

export const isSensitive = (name: string): boolean => SENSITIVE.test(name);

export const toolInfos = (): McpToolInfo[] => TOOLS.map((t) => ({ name: t.name, access: accessOf(t.name), sensitive: isSensitive(t.name) }));

/** What a client with `scope` sees; write tools do not exist for a read-only one, sensitive ones only with that grant. */
export function visibleTools(scope: McpScope, sensitive = false): PulsoTool[] {
  return TOOLS.filter((t) => (scope === "read+write" || accessOf(t.name) === "read") && (sensitive || !isSensitive(t.name)));
}

export const describeFor = (t: PulsoTool): string => (PERSONAL.test(t.name) ? t.description + PERSONAL_NOTE : t.description);
