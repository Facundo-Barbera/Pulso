/**
 * The tools the Pulso agent gets, through one in-process MCP server named
 * `pulso`. Each feature defines its tools in its own file with the Agent
 * SDK's `tool()` and adds ONE line to the list below.
 */
import type { tool } from "@anthropic-ai/claude-agent-sdk";
import { bodyTools } from "../body/tools";
import { calendarTools } from "../calendar/tools";
import { coachTools } from "../coach/tools";
import { dailyTools } from "../daily/tools";
import { medicationTools } from "../medication/tools";
import { nutritionTools } from "../nutrition/tools";
import { shoppingTools } from "../shopping/tools";
import { sleepTools } from "../sleep/tools";
import { trainingTools } from "../training/tools";
import { workoutTools } from "../workouts-tools";
import { profileTools } from "./tools";

export type PulsoTool = ReturnType<typeof tool<any>>;

export const TOOLS: PulsoTool[] = [
  ...workoutTools,
  ...profileTools,
  ...nutritionTools,
  ...trainingTools,
  ...bodyTools,
  ...dailyTools,
  ...sleepTools,
  ...medicationTools,
  ...coachTools,
  ...calendarTools,
  ...shoppingTools,
];
