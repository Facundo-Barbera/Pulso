/**
 * Maps every library exercise to an ExerciseDB V1 exercise and records the id
 * in SQLite (`exercise_media`, verified = 0) for the person to review.
 * Re-runnable: rows already verified or rejected are left alone.
 *
 * ExerciseDB's terms forbid storing anything it serves (media, text,
 * metadata), so only the id is kept; the engine streams the GIF on demand.
 *
 *   bun run training:media                   propose matches and print them
 *   bun run training:media --dry-run         print only, write nothing
 *   bun run training:media --force           re-propose reviewed rows too
 *   bun run training:media --verify all      accept every proposal (or a comma list of ids)
 *   bun run training:media --reject a,b      no media for these ids, for good
 */
import { dataDir } from "../src/db";
import { EDB_API, EDB_MEDIA, type EdbExercise, type Match, muscleGaps, rankCandidates } from "../src/training/exercisedb";
import { LIBRARY } from "../src/training/library";
import { listMediaRows, proposeMedia, reviewMedia } from "../src/training/media";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const ids = (list: string) => (list === "all" ? listMediaRows().map((r) => r.exerciseId) : list.split(",").map((s) => s.trim()));

console.log(`Data: ${dataDir()}`);

const verify = value("--verify");
const reject = value("--reject");
if (verify || reject) {
  for (const id of verify ? ids(verify) : []) console.log(reviewMedia(id, "verify") ? `✓ ${id}` : `  ${id}: no proposal to verify`);
  for (const id of reject ? ids(reject) : []) console.log(reviewMedia(id, "reject") ? `✗ ${id}` : `  ${id}: no row; run the import first`);
  process.exit(0);
}

/** A polite GET: sequential, honours Retry-After, gives up after a few tries. */
async function get(url: string, method = "GET"): Promise<Response> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, { method, headers: { "user-agent": "Pulso (personal, non-commercial)" } });
    if (response.status !== 429) return response;
    const wait = Number(response.headers.get("retry-after")) || 5;
    console.log(`  ExerciseDB asked to slow down; waiting ${wait}s`);
    await Bun.sleep((wait + 1) * 1000);
  }
  throw new Error(`ExerciseDB kept rate-limiting ${url}`);
}

// The whole catalog, held in memory for this run only.
const catalog: EdbExercise[] = [];
let cursor: string | undefined;
do {
  const response = await get(`${EDB_API}/exercises?limit=100${cursor ? `&after=${cursor}` : ""}`);
  if (!response.ok) throw new Error(`ExerciseDB ${response.status} listing exercises`);
  const page = (await response.json()) as { data: EdbExercise[]; meta: { hasNextPage: boolean; nextCursor?: string } };
  catalog.push(...page.data);
  cursor = page.meta.hasNextPage ? page.meta.nextCursor : undefined;
  if (cursor) await Bun.sleep(1500);
} while (cursor);
console.log(`ExerciseDB: ${catalog.length} exercises\n`);

const dryRun = flag("--dry-run");
const force = flag("--force");
const unmatched: string[] = [];
let withMedia = 0;
for (const exercise of LIBRARY) {
  // The first of the top three whose GIF actually exists: some duplicate entries have none.
  let match: Match = { exerciseId: exercise.id, candidate: null, score: 0 };
  for (const option of rankCandidates(exercise, catalog).slice(0, 3)) {
    const head = await get(`${EDB_MEDIA}/${option.candidate.exerciseId}.gif`, "HEAD");
    await Bun.sleep(250);
    if (head.ok) {
      match = option;
      break;
    }
  }
  const candidate = match.candidate;
  if (!candidate) unmatched.push(exercise.id);
  else withMedia++;
  const written = dryRun ? false : proposeMedia(exercise.id, candidate?.exerciseId ?? null, match.score, force);
  const gaps = candidate ? muscleGaps(exercise.id, candidate) : [];
  console.log(
    [
      exercise.name.padEnd(38),
      "→",
      (candidate ? `${candidate.name} (${candidate.exerciseId})` : "—").padEnd(56),
      match.score.toFixed(2),
      dryRun ? "" : written ? "" : "kept (reviewed)",
      gaps.length ? `⚠ ExerciseDB targets ${gaps.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );
}

console.log(`\n${withMedia}/${LIBRARY.length} with media.${unmatched.length ? ` Unmatched: ${unmatched.join(", ")}.` : ""}`);
if (!dryRun) console.log("Proposals are unverified: check them in the app, then --verify all (or --reject <ids>).");
