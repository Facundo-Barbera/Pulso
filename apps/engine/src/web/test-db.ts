import { afterAll, beforeAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Gives the calling test file a database of its own and hands the shared one
 * back afterwards. The page assemblers read "the latest" of several features,
 * so they must not see (or leave behind) other files' rows.
 */
export function ownDatabase(name: string) {
  const g = globalThis as Record<string, unknown>;
  const shared = { db: g.__pulso_db__, dir: process.env.PULSO_DATA_DIR };
  const own = fs.mkdtempSync(path.join(os.tmpdir(), `pulso-${name}-test-`));
  beforeAll(() => {
    delete g.__pulso_db__;
    process.env.PULSO_DATA_DIR = own;
  });
  afterAll(() => {
    (g.__pulso_db__ as { close(): void } | undefined)?.close();
    g.__pulso_db__ = shared.db;
    process.env.PULSO_DATA_DIR = shared.dir;
    fs.rmSync(own, { recursive: true, force: true });
  });
}
