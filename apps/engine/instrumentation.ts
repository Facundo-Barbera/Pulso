/** Runs once when the server boots: starts the Coach's brief scheduler (src/coach/scheduler.ts). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startCoachScheduler } = await import("./src/coach/scheduler");
  startCoachScheduler();
}
