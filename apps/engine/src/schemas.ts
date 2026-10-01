/**
 * Every module's tables. Each feature keeps its SQL in its own file and adds
 * ONE line to the list below. Statements must be idempotent (`IF NOT EXISTS`):
 * they run on every boot, in this order.
 */
import { AGENT_SCHEMA } from "./agent/schema";
import { BODY_SCHEMA } from "./body/schema";
import { COACH_SCHEMA } from "./coach/schema";
import { CORE_SCHEMA } from "./core-schema";
import { DAILY_SCHEMA } from "./daily/schema";
import { MCP_SCHEMA } from "./mcp/schema";
import { MEDICATION_SCHEMA } from "./medication/schema";
import { NUTRITION_SCHEMA } from "./nutrition/schema";
import { SLEEP_SCHEMA } from "./sleep/schema";
import { TRAINING_SCHEMA } from "./training/schema";

export const SCHEMAS: string[] = [
  CORE_SCHEMA,
  AGENT_SCHEMA,
  NUTRITION_SCHEMA,
  TRAINING_SCHEMA,
  BODY_SCHEMA,
  DAILY_SCHEMA,
  SLEEP_SCHEMA,
  MEDICATION_SCHEMA,
  COACH_SCHEMA,
  MCP_SCHEMA,
];
