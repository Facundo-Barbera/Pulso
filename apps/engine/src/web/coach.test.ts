import { expect, test } from "bun:test";
import { addMessage, createThread } from "../agent/threads";
import { claimBrief, completeBrief, latestBrief } from "../coach/store";
import { coachBrief, coachThread } from "./coach";

test("a thread reads with its messages, not running when no turn is in flight", () => {
  const thread = createThread();
  addMessage(thread.id, "user", "¿Qué entreno hoy?", "done");
  addMessage(thread.id, "assistant", "Pierna.", "done");
  const view = coachThread(thread.id)!;
  expect(view.thread.title).toBe("¿Qué entreno hoy?");
  expect(view.messages.map((m) => m.text)).toEqual(["¿Qué entreno hoy?", "Pierna."]);
  expect(view.running).toBe(false);
  expect(coachThread("nope")).toBeUndefined();
});

test("a new chat gets the latest daily brief, and the one it answers only if it has text", () => {
  // Old periods: the test database is shared with the brief scheduler's tests, which read the latest.
  const done = claimBrief("daily", "2000-01-02")!;
  completeBrief(done.id, "Buen día.");
  const empty = claimBrief("weekly", "2000-01-02")!;

  expect(coachBrief()).toEqual({ brief: latestBrief("daily"), replyTo: null });
  expect(coachBrief(done.id).replyTo?.id).toBe(done.id);
  expect(coachBrief(empty.id).replyTo).toBeNull();
  expect(coachBrief("nope").replyTo).toBeNull();
});
