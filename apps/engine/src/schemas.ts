/**
 * Every module's tables. Each feature keeps its SQL in its own file and adds
 * ONE line here. Statements must be idempotent (`IF NOT EXISTS`): they run on
 * every boot, in this order.
 */
import { BODY_SCHEMA } from "./body/schema";
import { CORE_SCHEMA } from "./core-schema";

export const SCHEMAS: string[] = [CORE_SCHEMA, BODY_SCHEMA];
