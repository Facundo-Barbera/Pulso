import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { recentActivity, standaloneWorkouts } from "./workouts-merge";

export const workoutTools = [
  tool(
    "list_workouts",
    "Recent Apple Health workouts (newest first) that are NOT part of a Pulso session, one per real workout: duplicates from two apps are already merged, so don't dedupe or halve. " +
      "Workouts recorded during a Pulso session, and Pulso's own copies, are left out (list_sessions has them as `recorded`). " +
      "Times epoch ms, energy kcal, distance meters, avg/maxHeartRate bpm; sourceName = the recording app.",
    { limit: z.number().int().min(1).max(200).default(30) },
    async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(standaloneWorkouts(limit)) }] }),
  ),
  tool(
    "list_activity",
    "Everything trained, newest first, each workout once: Pulso sessions (Watch data recorded during them merged in: merged: true, the workouts in `parts`) and standalone Health workouts. " +
      "Use it for totals (workouts, minutes, kcal this week) instead of adding list_sessions and list_workouts. Times epoch ms (startedAt/endedAt span the parts), energy kcal, distance meters, volumeKg = kg × reps.",
    { limit: z.number().int().min(1).max(100).default(20) },
    async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(recentActivity(limit)) }] }),
  ),
];
