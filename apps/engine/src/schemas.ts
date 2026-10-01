/**
 * Every module's tables. Each feature keeps its SQL in its own file and adds
 * ONE line here. Statements must be idempotent (`IF NOT EXISTS`): they run on
 * every boot, in this order.
 */
import { CORE_SCHEMA } from "./core-schema";
import { MEDICATION_SCHEMA } from "./medication/schema";

export const SCHEMAS: string[] = [CORE_SCHEMA, MEDICATION_SCHEMA];
