"use client";

import { useMemo, useSyncExternalStore } from "react";
import { LIVE_KEY, parseLive, type LiveState } from "@/src/web/entreno-live";

/**
 * The session in progress, kept in this browser's localStorage (one at a
 * time, like the phone). Every tab sees writes: the `storage` event covers
 * other tabs, `notify` this one.
 */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const read = () => localStorage.getItem(LIVE_KEY);

export function saveLive(state: LiveState | null) {
  if (state) localStorage.setItem(LIVE_KEY, JSON.stringify(state));
  else localStorage.removeItem(LIVE_KEY);
  notify();
}

/** `[state, ready]`: ready is false during the server render and hydration, so nothing flashes. */
export function useLive(): [LiveState | null, boolean] {
  const raw = useSyncExternalStore(subscribe, read, () => undefined);
  const state = useMemo(() => (raw === undefined ? null : parseLive(raw)), [raw]);
  return [state, raw !== undefined];
}
