/**
 * The tools the Pulso agent gets, through one in-process MCP server named
 * `pulso`. Each feature defines its tools in its own file with the Agent
 * SDK's `tool()` and adds ONE spread here.
 */
import type { tool } from "@anthropic-ai/claude-agent-sdk";
import { dailyTools } from "../daily/tools";
import { workoutTools } from "../workouts-tools";

export type PulsoTool = ReturnType<typeof tool<any>>;

export const TOOLS: PulsoTool[] = [...workoutTools, ...dailyTools];
