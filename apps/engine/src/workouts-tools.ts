import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { recentActivity, standaloneWorkouts } from "./workouts-merge";

export const workoutTools = [
  tool(
    "list_workouts",
    "Recent workouts synced from Apple Health (newest first) that are NOT part of a Pulso session, one entry per real workout: " +
      "when two apps recorded the same workout, the engine has already merged them, so do not dedupe or halve the count. " +
      "Health workouts recorded during a Pulso session (the Watch's strength workout, the walk of its treadmill block) and the copies " +
      "Pulso writes to Health are left out here: they are that session, merged into it (list_sessions shows them as `recorded`, with merged: true). " +
      "Times are epoch ms, energy kcal, distance meters, avg/maxHeartRate bpm; sourceName is the app that recorded it.",
    { limit: z.number().int().min(1).max(200).default(30) },
    async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(standaloneWorkouts(limit)) }] }),
  ),
  tool(
    "list_activity",
    "Everything trained, newest first, each workout counted once: Pulso sessions (with whatever Apple Watch recorded during them merged in: " +
      "kcal, heart rate, distance; merged: true and the Watch workouts in `parts`) and Health workouts on their own. " +
      "Use it for totals (how many workouts, minutes, kcal this week) instead of adding list_sessions and list_workouts. " +
      "Times epoch ms (startedAt/endedAt span the session and its parts), energy kcal, distance meters, volumeKg = kg × reps.",
    { limit: z.number().int().min(1).max(100).default(20) },
    async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(recentActivity(limit)) }] }),
  ),
];
