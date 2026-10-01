import { expect, test } from "bun:test";
import { addMessage, createThread } from "../agent/threads";
import { claimBrief, completeBrief } from "../coach/store";
import { coachHome, coachThread } from "./coach";

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

test("home lists threads newest first with the latest daily brief", async () => {
  const older = createThread();
  addMessage(older.id, "user", "uno", "done");
  await Bun.sleep(2);
  const newer = createThread();
  addMessage(newer.id, "user", "dos", "done");
  const brief = claimBrief("daily", "2030-01-02")!;
  completeBrief(brief.id, "Buen día.");

  const home = coachHome();
  expect(home.threads.findIndex((t) => t.id === newer.id)).toBeLessThan(home.threads.findIndex((t) => t.id === older.id));
  expect(home.brief).toMatchObject({ period: "2030-01-02", text: "Buen día." });
});
