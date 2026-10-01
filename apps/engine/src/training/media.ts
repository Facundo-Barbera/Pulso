import type { ActiveProgramResponse, Exercise, ExerciseMedia, ListMedia } from "@pulso/contract";
import { db } from "../db";
import { EDB_ATTRIBUTION, EDB_MEDIA } from "./exercisedb";

// ── Mapping (what the import script writes) ──────────────────────────────────

export type MediaRow = { exerciseId: string; sourceId: string | null; score: number; verified: boolean };

/** Every mapping, rejected ones (no `sourceId`) included. */
export function listMediaRows(): MediaRow[] {
  return db()
    .query<{ exercise_id: string; source_id: string | null; score: number; verified: number }, []>(
      "SELECT exercise_id, source_id, score, verified FROM exercise_media ORDER BY exercise_id",
    )
    .all()
    .map((r) => ({ exerciseId: r.exercise_id, sourceId: r.source_id, score: r.score, verified: r.verified === 1 }));
}

/**
 * Records a proposed match. A row the person already verified or rejected is
 * kept unless `force`: re-running the import never undoes a review.
 */
export function proposeMedia(exerciseId: string, sourceId: string | null, score: number, force = false, now = Date.now()): boolean {
  const result = db()
    .query(
      `INSERT INTO exercise_media (exercise_id, source, source_id, attribution, score, verified, matched_at) VALUES (?, 'exercisedb', ?, ?, ?, 0, ?)
       ON CONFLICT (exercise_id) DO UPDATE SET source_id = excluded.source_id, attribution = excluded.attribution, score = excluded.score, verified = 0, matched_at = excluded.matched_at
       WHERE exercise_media.verified = 0 OR ?`,
    )
    .run(exerciseId, sourceId, EDB_ATTRIBUTION, score, now, force ? 1 : 0);
  return result.changes > 0;
}

/** The person looked at it: keep it (`verify`) or drop the media for good (`reject`). */
export function reviewMedia(exerciseId: string, verdict: "verify" | "reject"): boolean {
  const sql =
    verdict === "verify"
      ? "UPDATE exercise_media SET verified = 1 WHERE exercise_id = ? AND source_id IS NOT NULL"
      : "UPDATE exercise_media SET verified = 1, source_id = NULL WHERE exercise_id = ?";
  return db().query(sql).run(exerciseId).changes > 0;
}

/** The ExerciseDB id behind an exercise's media, if it has any. */
export function mediaSourceOf(exerciseId: string): string | undefined {
  return (
    db()
      .query<{ source_id: string }, [string]>("SELECT source_id FROM exercise_media WHERE exercise_id = ? AND source_id IS NOT NULL")
      .get(exerciseId)?.source_id ?? undefined
  );
}

/** Library ids that have demonstration media. */
export function idsWithMedia(): Set<string> {
  return new Set(
    db()
      .query<{ exercise_id: string }, []>("SELECT exercise_id FROM exercise_media WHERE source_id IS NOT NULL")
      .all()
      .map((r) => r.exercise_id),
  );
}

// ── URLs the phone loads ─────────────────────────────────────────────────────

export const MEDIA_ROUTE = "/api/mobile/training/media";
export type MediaKind = "animation" | "thumbnail";

export const mediaUrl = (exerciseId: string, kind: MediaKind) => `${MEDIA_ROUTE}/exercises/${exerciseId}/${kind}.gif`;

export const NO_MEDIA: ExerciseMedia = { animation: null, thumbnail: null, source: null, attribution: null };

export function mediaFor(exerciseId: string, hasMedia: boolean): ExerciseMedia {
  if (!hasMedia) return NO_MEDIA;
  return { animation: mediaUrl(exerciseId, "animation"), thumbnail: mediaUrl(exerciseId, "thumbnail"), source: "exercisedb", attribution: EDB_ATTRIBUTION };
}

const listMedia = (exerciseId: string, has: Set<string>): ListMedia =>
  has.has(exerciseId) ? { thumbnail: mediaUrl(exerciseId, "thumbnail"), animation: mediaUrl(exerciseId, "animation") } : { thumbnail: null, animation: null };

/** Library rows with their thumbnail and animation URLs, for the phone. */
export function exercisesWithMedia(exercises: Exercise[]): Exercise[] {
  const has = idsWithMedia();
  return exercises.map((e) => ({ ...e, ...listMedia(e.id, has) }));
}

/** The active program with thumbnail and animation URLs on every prescribed exercise. */
export function programWithMedia(view: ActiveProgramResponse): ActiveProgramResponse {
  if (!view.program) return view;
  const has = idsWithMedia();
  const days = view.program.days.map((d) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, ...listMedia(e.exerciseId, has) })) }));
  return { ...view, program: { ...view.program, days } };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `[...path]` of the media route → what to serve. Only
 * `exercises/<library id>/(animation|thumbnail).gif` is valid; the id is then
 * looked up in SQLite, so no path ever reaches the filesystem or the upstream URL.
 */
export function parseMediaPath(segments: string[]): { exerciseId: string; kind: MediaKind } | null {
  const [root, exerciseId, file] = segments;
  if (segments.length !== 3 || root !== "exercises" || !exerciseId || exerciseId.length > 80 || !SLUG.test(exerciseId)) return null;
  if (file === "animation.gif") return { exerciseId, kind: "animation" };
  if (file === "thumbnail.gif") return { exerciseId, kind: "thumbnail" };
  return null;
}

// ── Upstream fetch, cached in memory for at most an hour ─────────────────────

/** ExerciseDB's terms cap any cache at one hour. Phones get the same limit. */
export const CACHE_MS = 60 * 60_000;
export const MEDIA_HEADERS = { "content-type": "image/gif", "cache-control": `private, max-age=${CACHE_MS / 1000}` };

type Cache = { entries: Map<string, { bytes: Gif; at: number }>; inflight: Map<string, Promise<Gif | null>>; active: number; waiting: (() => void)[] };
const KEY = "__pulso_media_cache__";
// Next's dev reloads re-evaluate modules; the cache and the slot count live on globalThis.
const cache = (): Cache => ((globalThis as Record<string, unknown>)[KEY] ??= { entries: new Map(), inflight: new Map(), active: 0, waiting: [] }) as Cache;

/** Drops every cached GIF (tests). */
export const clearMediaCache = () => {
  cache().entries.clear();
  cache().inflight.clear();
};

const MAX_PARALLEL = 2;

/** At most two upstream requests at a time: a phone scrolling the library must not hammer ExerciseDB. */
async function slot<T>(run: () => Promise<T>): Promise<T> {
  const c = cache();
  if (c.active >= MAX_PARALLEL) await new Promise<void>((resolve) => c.waiting.push(resolve));
  c.active++;
  try {
    return await run();
  } finally {
    c.active--;
    c.waiting.shift()?.();
  }
}

type Gif = Uint8Array<ArrayBuffer>;
type Fetcher = (url: string) => Promise<Response>;

async function download(sourceId: string, fetcher: Fetcher): Promise<Gif | null> {
  const url = `${EDB_MEDIA}/${sourceId}.gif`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await slot(() => fetcher(url));
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if (response.status !== 429 || attempt > 0) return null;
    const header = response.headers.get("retry-after");
    await Bun.sleep(Math.min(header === null ? 2 : Number(header) || 0, 10) * 1000);
  }
  return null;
}

/** The demonstration GIF for an ExerciseDB id, from memory when fetched less than an hour ago. */
export async function loadGif(sourceId: string, now = Date.now(), fetcher: Fetcher = fetch): Promise<Gif | null> {
  if (!/^[A-Za-z0-9]+$/.test(sourceId)) return null;
  const c = cache();
  for (const [id, entry] of c.entries) if (now - entry.at >= CACHE_MS) c.entries.delete(id);
  const hit = c.entries.get(sourceId);
  if (hit) return hit.bytes;
  let pending = c.inflight.get(sourceId);
  if (!pending) {
    pending = download(sourceId, fetcher).finally(() => c.inflight.delete(sourceId));
    c.inflight.set(sourceId, pending);
  }
  const bytes = await pending;
  if (bytes) c.entries.set(sourceId, { bytes, at: now });
  return bytes;
}

/**
 * A GIF holding only the first frame of `gif`: header, palette, that frame's
 * control block and image data, trailer. Byte surgery, no decoding, so no
 * image library is needed. Null when the bytes are not a well-formed GIF.
 */
export function firstFrame(gif: Uint8Array): Gif | null {
  const at = (i: number) => gif[i] ?? 0;
  if (gif.length < 14 || String.fromCharCode(at(0), at(1), at(2)) !== "GIF") return null;
  const tableSize = (packed: number) => (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);
  // Data sub-blocks: length-prefixed chunks ending with a zero byte. Returns the index after the terminator.
  const skipBlocks = (i: number) => {
    while (i < gif.length && at(i) !== 0) i += at(i) + 1;
    return i + 1;
  };
  const headerEnd = 13 + tableSize(at(10));
  let control: Uint8Array | null = null;
  let p = headerEnd;
  while (p < gif.length) {
    if (at(p) === 0x21) {
      const end = skipBlocks(p + 2);
      if (at(p + 1) === 0xf9) control = gif.subarray(p, end);
      p = end;
    } else if (at(p) === 0x2c) {
      const data = p + 10 + tableSize(at(p + 9)) + 1;
      const end = skipBlocks(data);
      if (end > gif.length) return null;
      const parts = [gif.subarray(0, headerEnd), control ?? new Uint8Array(), gif.subarray(p, end), Uint8Array.of(0x3b)];
      const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    } else {
      return null;
    }
  }
  return null;
}
