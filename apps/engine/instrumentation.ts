/**
 * Runs once when the server boots: starts the Coach's brief scheduler (src/coach/scheduler.ts), its review of the
 * next workout (src/training/review.ts) and the conversation's upkeep (src/agent/upkeep.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startCoachScheduler } = await import("./src/coach/scheduler");
  startCoachScheduler();
  const { startReviewScheduler } = await import("./src/training/review");
  startReviewScheduler();
  const { startUpkeep } = await import("./src/agent/upkeep");
  startUpkeep();
}
