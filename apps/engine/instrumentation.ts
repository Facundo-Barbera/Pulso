/** Runs once when the server boots: starts the Coach's brief scheduler (src/coach/scheduler.ts) and its review of the next workout (src/training/review.ts). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startCoachScheduler } = await import("./src/coach/scheduler");
  startCoachScheduler();
  const { startReviewScheduler } = await import("./src/training/review");
  startReviewScheduler();
}
