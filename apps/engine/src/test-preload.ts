import { afterAll } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-test-"));
process.env.PULSO_DATA_DIR = dir;
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
