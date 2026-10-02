/**
 * Where the Agent SDK keeps the Coach's session transcripts: inside Pulso's data
 * dir (CLAUDE_CONFIG_DIR for the child), so they are backed up and deleted with
 * Pulso and never mix with this Mac's own Claude Code. The CLI writes one JSONL
 * per session at `projects/<cwd as a name>/<session id>.jsonl`, plus a
 * `<session id>/` folder for subagents.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "../db";

export const sdkConfigDir = () => path.join(dataDir(), "agent-sdk");

const SESSION = /^[0-9a-f-]{36}$/;

/** What stands in for a photo in a transcript once its turn is over. */
export const PHOTO_PLACEHOLDER = "[A photo the person sent. You saw it on that turn; it is no longer attached.]";

/** The session's files (JSONL and subagent folder) in any project folder. */
function sessionFiles(sessionId: string): { jsonl: string[]; dirs: string[] } {
  const found = { jsonl: [] as string[], dirs: [] as string[] };
  if (!SESSION.test(sessionId)) return found;
  const projects = path.join(sdkConfigDir(), "projects");
  if (!fs.existsSync(projects)) return found;
  for (const project of fs.readdirSync(projects)) {
    const file = path.join(projects, project, `${sessionId}.jsonl`);
    const dir = path.join(projects, project, sessionId);
    if (fs.existsSync(file)) found.jsonl.push(file);
    if (fs.existsSync(dir)) found.dirs.push(dir);
  }
  return found;
}

export function transcriptExists(sessionId: string): boolean {
  return sessionFiles(sessionId).jsonl.length > 0;
}

/** Deletes a session's transcript and subagent folder. Returns whether there was anything to delete. */
export function deleteTranscript(sessionId: string): boolean {
  const { jsonl, dirs } = sessionFiles(sessionId);
  for (const file of jsonl) fs.rmSync(file, { force: true });
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  return jsonl.length + dirs.length > 0;
}

type Block = { type?: string; source?: { type?: string }; content?: unknown };

/** Replaces base64 image blocks (also inside tool results) with the placeholder. Returns whether anything changed. */
function stripBlocks(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  let changed = false;
  content.forEach((block: Block, i) => {
    if (block?.type === "image" && block.source?.type === "base64") {
      content[i] = { type: "text", text: PHOTO_PLACEHOLDER };
      changed = true;
    } else if (block?.type === "tool_result" && stripBlocks(block.content)) changed = true;
  });
  return changed;
}

/**
 * A photo goes to the model on the turn it was sent, not on every turn after:
 * this rewrites the session's transcript with the photos replaced by a short
 * placeholder (the reply that read them stays). Run only while no turn is using
 * the session. The JPEGs stay on disk for the app. Returns how many lines changed.
 */
export function stripImages(sessionId: string): number {
  let changed = 0;
  for (const file of sessionFiles(sessionId).jsonl) {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.includes('"base64"')) continue;
    let here = 0;
    const lines = raw.split("\n").map((line) => {
      if (!line.includes('"base64"')) return line;
      try {
        const entry = JSON.parse(line) as { message?: { content?: unknown } };
        if (!stripBlocks(entry.message?.content)) return line;
        here++;
        return JSON.stringify(entry);
      } catch {
        return line;
      }
    });
    if (!here) continue;
    changed += here;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, lines.join("\n"));
    fs.renameSync(tmp, file);
  }
  return changed;
}
