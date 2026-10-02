import { expect, test } from "bun:test";
import { ownDatabase } from "../web/test-db";
import { activeContext, ensureConversation } from "./conversation";
import { fallbackDigest, legacyThreads } from "./distill";
import type { QueryFn } from "./runner";
import { addMessage, createThread } from "./threads";
import { distillOnce } from "./upkeep";

ownDatabase("distill");

test("when the model can't distill, the trimmed recap stays and it is not tried again", async () => {
  const old = createThread();
  addMessage(old.id, "user", "Soy alérgico al maní.", "done");
  addMessage(old.id, "assistant", "Anotado.", "done");
  ensureConversation();
  const seed = activeContext().seed;
  expect(seed).toContain("Soy alérgico al maní.");

  let calls = 0;
  const failing = (() => {
    calls++;
    throw new Error("no provider");
  }) as unknown as QueryFn;
  await distillOnce(failing);
  await distillOnce(failing);
  expect(calls).toBe(1);
  expect(activeContext().seed).toBe(seed);
  expect(ensureConversation().distilled_at).not.toBeNull();
});

test("the trimmed recap keeps the newest conversations when they don't all fit", () => {
  const long = "x".repeat(390);
  for (let i = 0; i < 40; i++) {
    const thread = createThread(`Charla ${i}`);
    for (let j = 0; j < 4; j++) addMessage(thread.id, "user", `${i}-${j} ${long}`, "done");
  }
  const digest = fallbackDigest(legacyThreads(ensureConversation().thread_id));
  expect(digest.length).toBeLessThanOrEqual(12_100);
  expect(digest).toContain("### Charla 39");
  expect(digest).not.toContain("### Charla 0 ");
});
