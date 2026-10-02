import { expect, test } from "bun:test";
import { claimBrief, completeBrief, latestBrief } from "../coach/store";
import { coachBrief, coachConversation } from "./coach";

test("the web Coach reads the one conversation, not running when no turn is in flight", () => {
  const view = coachConversation();
  expect(view.threadId).toBeTruthy();
  expect(view.contexts.find((c) => c.active)?.id).toBe(view.activeContextId);
  expect(view.running).toBe(false);
  expect(view.compacting).toBe(false);
});

test("the feed gets the latest daily brief", () => {
  // Old periods: the test database is shared with the brief scheduler's tests, which read the latest.
  const done = claimBrief("daily", "2000-01-02")!;
  completeBrief(done.id, "Buen día.");
  expect(coachBrief()).toEqual(latestBrief("daily"));
});
