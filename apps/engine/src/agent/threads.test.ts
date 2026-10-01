import { expect, test } from "bun:test";
import { getProfile, updateProfile } from "./profile";
import { addMessage, createThread, DEFAULT_TITLE, deleteThread, getThread, listMessages, listThreads, sdkSessionOf, setSdkSession, titleFrom, updateMessage } from "./threads";

test("a thread is titled from its first message only", () => {
  const thread = createThread();
  expect(thread.title).toBe(DEFAULT_TITLE);
  addMessage(thread.id, "user", "Diseña mi rutina de esta semana", "done");
  addMessage(thread.id, "user", "Otra cosa", "done");
  expect(getThread(thread.id)?.title).toBe("Diseña mi rutina de esta semana");
});

test("titleFrom keeps the first line and cuts long text at a word", () => {
  expect(titleFrom("  hola\nsegunda línea")).toBe("hola");
  expect(titleFrom("   ")).toBe(DEFAULT_TITLE);
  const long = titleFrom("Quiero bajar de peso sin perder fuerza y entrenar cuatro días por semana en casa");
  expect(long.endsWith("…")).toBe(true);
  expect(long.length).toBeLessThanOrEqual(49);
  expect(long).not.toContain(" …");
});

test("messages keep their order, tools and status; the list shows the latest preview", () => {
  const thread = createThread();
  const user = addMessage(thread.id, "user", "¿Cómo voy?", "done");
  const reply = addMessage(thread.id, "assistant", "", "streaming");
  updateMessage(reply.id, { text: "Vas bien.", tools: [{ name: "list_workouts", status: "done" }], status: "done" });
  const messages = listMessages(thread.id);
  expect(messages.map((m) => m.id)).toEqual([user.id, reply.id]);
  expect(messages[1]).toMatchObject({ role: "assistant", text: "Vas bien.", status: "done", tools: [{ name: "list_workouts", status: "done" }], error: null });
  expect(listMessages(thread.id, 1).map((m) => m.id)).toEqual([reply.id]);
  expect(listThreads().find((t) => t.id === thread.id)?.preview).toBe("Vas bien.");
});

test("the SDK session id is stored per thread, and deleting a thread drops its messages", () => {
  const thread = createThread();
  expect(sdkSessionOf(thread.id)).toBeNull();
  setSdkSession(thread.id, "session-1");
  expect(sdkSessionOf(thread.id)).toBe("session-1");
  addMessage(thread.id, "user", "hola", "done");
  expect(deleteThread(thread.id)).toBe(true);
  expect(getThread(thread.id)).toBeUndefined();
  expect(listMessages(thread.id)).toHaveLength(0);
  expect(deleteThread(thread.id)).toBe(false);
});

test("the profile merges patches, clears nulls and rejects nonsense", () => {
  expect(getProfile()).toEqual({});
  updateProfile({ age: 34, goals: "Ganar fuerza" });
  updateProfile({ injuries: "Rodilla izquierda", goals: null });
  expect(getProfile()).toEqual({ age: 34, injuries: "Rodilla izquierda" });
  expect(() => updateProfile({ age: -3 })).toThrow();
  expect(getProfile().age).toBe(34);
});
