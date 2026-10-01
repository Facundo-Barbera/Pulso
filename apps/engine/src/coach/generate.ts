import fs from "node:fs";
import path from "node:path";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { CoachBrief } from "@pulso/contract";
import { dataDir } from "../db";
import { newTurnState, translate } from "../agent/events";
import { getProfile } from "../agent/profile";
import { TOOLS } from "../agent/registry";
import { agentOptions, type QueryFn } from "../agent/runner";
import { claudeMd } from "../agent/workspace";
import { briefPrompt } from "./prompts";
import { completeBrief, failBrief, getBrief } from "./store";

const BRIEF_LIMIT_MS = 10 * 60_000;
const WRITES = /^(log|add|create|update|set|delete)_/;

/** A brief only reads: every pulso tool that writes is denied, and no built-ins. */
export function briefOptions(cwd: string, context: string, abortController: AbortController): Options {
  return {
    ...agentOptions(cwd, context, undefined, abortController),
    tools: [],
    allowedTools: ["mcp__pulso"],
    disallowedTools: TOOLS.map((t) => t.name).filter((name) => WRITES.test(name)).map((name) => `mcp__pulso__${name}`),
    persistSession: false,
    maxTurns: 25,
  };
}

/**
 * Runs one SDK turn that writes the brief claimed in `brief` (a `running` row
 * from claimBrief) and stores the result. Never throws: a failure is saved on
 * the row. Returns the row as it ends.
 */
export async function generateBrief(brief: CoachBrief, run: QueryFn = query, now = new Date()): Promise<CoachBrief> {
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), BRIEF_LIMIT_MS);
  const state = newTurnState();
  let final: string | undefined;
  try {
    const cwd = path.join(dataDir(), "briefs");
    fs.mkdirSync(cwd, { recursive: true });
    const options = briefOptions(cwd, claudeMd(getProfile(), now), abortController);
    for await (const message of run({ prompt: briefPrompt(brief.kind, brief.period), options })) {
      translate(message, state);
      // The result is the last assistant message alone, without the narration before tool calls.
      if (message.type === "result" && message.subtype === "success" && !message.is_error) final = message.result;
    }
  } catch (error) {
    state.error ??= abortController.signal.aborted ? "El resumen tardó demasiado y se cortó." : error instanceof Error ? error.message : String(error);
  } finally {
    clearTimeout(timer);
  }

  const text = (final ?? state.text).trim();
  if (text && !state.error) completeBrief(brief.id, text);
  else {
    console.error(`[coach] ${brief.kind} brief ${brief.period} failed: ${state.error ?? "empty"}`);
    failBrief(brief.id, state.error ?? "El Coach no escribió nada.");
  }
  return getBrief(brief.id)!;
}
