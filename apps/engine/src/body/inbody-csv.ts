/**
 * InBody / LookinBody CSV export → scans. One row per test, a header row with
 * names like `Weight(kg)` or `Peso (kg)`; matched case- and accent-insensitively
 * with units dropped (see `readRecord`). Dates are usually `yyyyMMddHHmmss`
 * local time; missing values are `-`. Comma, semicolon or tab separated.
 */
import type { BodyImport, BodyScanInput } from "@pulso/contract";
import { hasComposition, inbodyId, readRecord } from "./fields";

/** RFC 4180-ish: quoted fields may hold the separator, newlines and doubled quotes. */
export function parseCsv(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[++i];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === separator) endField();
    else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

const detectSeparator = (headerLine: string) =>
  [",", ";", "\t"].map((s) => [s, headerLine.split(s).length] as const).sort((a, b) => b[1] - a[1])[0]![0];

export function parseInBodyCsv(text: string): { scans: BodyScanInput[]; skipped: BodyImport["skipped"] } {
  const clean = text.replace(/^﻿/, "");
  const [header, ...rows] = parseCsv(clean, detectSeparator(clean.split(/\r?\n/, 1)[0] ?? ""));
  const scans: BodyScanInput[] = [];
  const skipped: BodyImport["skipped"] = [];
  if (!header) return { scans, skipped: [{ line: 1, reason: "El archivo está vacío." }] };
  rows.forEach((cells, i) => {
    const line = i + 2;
    const record = Object.fromEntries(header.map((name, c) => [name.trim(), (cells[c] ?? "").trim()]));
    const { scan, measuredAt } = readRecord(record, "inbody");
    if (measuredAt === null) skipped.push({ line, reason: "Sin fecha legible." });
    else if (scan.weight === null && !hasComposition(scan)) skipped.push({ line, reason: "Sin peso ni composición." });
    else scans.push({ ...scan, externalId: inbodyId(measuredAt), raw: JSON.stringify(record) });
  });
  return { scans, skipped };
}
