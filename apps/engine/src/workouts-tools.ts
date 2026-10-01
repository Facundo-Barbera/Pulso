import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { listWorkouts } from "./workouts";

export const workoutTools = [
  tool(
    "list_workouts",
    "Recent workouts synced from Apple Health (newest first), one entry per real session: when two apps recorded the same session, " +
      "the engine has already merged them, so do not dedupe or halve the count. Times are epoch ms, energy kcal, distance meters; " +
      "sourceName is the app that recorded it.",
    { limit: z.number().int().min(1).max(200).default(30) },
    async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(listWorkouts(limit)) }] }),
  ),
];
