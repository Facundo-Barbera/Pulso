/**
 * The Markdown the Coach writes, parsed into plain data: headings, paragraphs,
 * nested lists, quotes, fenced code, tables and rules; inline code, bold,
 * italic, strikethrough, links and bare URLs. No HTML passes through: the
 * renderer (markdown.tsx) builds React elements from this.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong" | "em" | "del"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: Block[][] }
  | { type: "quote"; blocks: Block[] }
  | { type: "code"; lang: string; text: string }
  | { type: "table"; header: string[]; align: Align[]; rows: string[][] }
  | { type: "rule" };

const FENCE = /^(```+|~~~+)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const ITEM = /^(\s*)([-*+•]|\d{1,9}[.)])\s+(.*)$/;
const SEPARATOR = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const indentOf = (line: string) => line.length - line.trimStart().length;

function dedent(lines: string[]): string[] {
  const min = Math.min(...lines.filter((l) => l.trim()).map(indentOf));
  return Number.isFinite(min) ? lines.map((l) => l.slice(Math.min(min, indentOf(l)))) : lines;
}

/** Splits a table row on pipes that are not escaped or inside inline code. */
export function cells(row: string): string[] {
  const line = row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  const out: string[] = [];
  let cell = "";
  let code = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && line[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "`") {
      code = !code;
      cell += ch;
    } else if (ch === "|" && !code) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

const startsTable = (lines: string[], i: number) => lines[i]!.includes("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]!.trim()) && lines[i + 1]!.includes("-");

function startsBlock(lines: string[], i: number): boolean {
  const trimmed = lines[i]!.trim();
  return FENCE.test(trimmed) || HEADING.test(trimmed) || RULE.test(trimmed) || trimmed.startsWith(">") || ITEM.test(lines[i]!) || startsTable(lines, i);
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence[1]!); i++) body.push(lines[i]!);
      i++;
      blocks.push({ type: "code", lang: fence[2] ?? "", text: dedent(body).join("\n") });
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }

    if (RULE.test(trimmed)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) body.push(lines[i++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ type: "quote", blocks: parseBlocks(body.join("\n")) });
      continue;
    }

    if (startsTable(lines, i)) {
      const header = cells(line);
      const align = cells(lines[i + 1]!).map((c): Align => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim() && lines[i]!.includes("|"); i++) {
        const row = cells(lines[i]!);
        rows.push(header.map((_, c) => row[c] ?? ""));
      }
      blocks.push({ type: "table", header, align: header.map((_, c) => align[c] ?? null), rows });
      continue;
    }

    const first = ITEM.exec(line);
    if (first) {
      const base = indentOf(line);
      const ordered = /\d/.test(first[2]!);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        if (!current.trim()) {
          // A blank line continues the list only if more of it follows.
          let j = i + 1;
          while (j < lines.length && !lines[j]!.trim()) j++;
          const next = j < lines.length ? ITEM.exec(lines[j]!) : null;
          if (j < lines.length && (indentOf(lines[j]!) > base || (next && indentOf(lines[j]!) === base && /\d/.test(next[2]!) === ordered))) {
            items.at(-1)!.push("");
            i = j;
            continue;
          }
          break;
        }
        const item = ITEM.exec(current);
        if (item && indentOf(current) <= base + 1) {
          if (/\d/.test(item[2]!) !== ordered) break;
          items.push([item[3]!]);
        } else if (indentOf(current) > base) items.at(-1)!.push(current);
        else if (!startsBlock(lines, i)) items.at(-1)!.push(current.trim());
        else break;
        i++;
      }
      blocks.push({
        type: "list",
        ordered,
        start: ordered ? Number.parseInt(first[2]!, 10) : 1,
        items: items.map(([head, ...rest]) => parseBlocks([head!, ...dedent(rest)].join("\n"))),
      });
      continue;
    }

    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() && (body.length === 0 || !startsBlock(lines, i))) body.push(lines[i++]!.trim());
    blocks.push({ type: "paragraph", text: body.join("\n") });
  }
  return blocks;
}

const INLINE = new RegExp(
  [
    "(?<tick>`+)(?<code>.+?)\\k<tick>",
    "\\[(?<label>(?:[^\\[\\]]|\\[[^\\]]*\\])+)\\]\\(\\s*<?(?<href>[^)\\s>]+)>?(?:\\s+\"[^\"]*\")?\\s*\\)",
    "(?<bold>\\*\\*|__)(?<strong>\\S(?:.*?\\S)?)\\k<bold>",
    "~~(?<del>\\S(?:.*?\\S)?)~~",
    "(?<![\\w*])\\*(?<em>[^*\\s](?:[^*]*?[^*\\s])?)\\*(?!\\*)",
    "(?<!\\w)_(?<em2>[^_\\s](?:[^_]*?[^_\\s])?)_(?!\\w)",
    "(?<url>https?://[^\\s<>]*[^\\s<>.,;:!?)\\]'\"»”])",
  ].join("|"),
  "s",
);

/** Only links that leave the app safely: http(s) and mail. Anything else stays text. */
export function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: "text", text: rest.slice(0, match.index) });
    const g = match.groups!;
    if (g.code !== undefined) out.push({ type: "code", text: g.code.trim() || g.code });
    else if (g.label !== undefined) {
      const href = safeHref(g.href!);
      out.push(href ? { type: "link", href, children: parseInline(g.label) } : { type: "text", text: g.label });
    } else if (g.strong !== undefined) out.push({ type: "strong", children: parseInline(g.strong) });
    else if (g.del !== undefined) out.push({ type: "del", children: parseInline(g.del) });
    else if (g.em !== undefined || g.em2 !== undefined) out.push({ type: "em", children: parseInline((g.em ?? g.em2)!) });
    else if (g.url !== undefined) out.push({ type: "link", href: g.url, children: [{ type: "text", text: g.url }] });
    rest = rest.slice(match.index + match[0].length);
  }
  return out;
}

/** "https://www.who.int/news/item/123" → "who.int/news/item/123", shortened: how a bare source link reads. */
export function linkLabel(url: string, max = 48): string {
  try {
    const u = new URL(url);
    const label = `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
  } catch {
    return url;
  }
}

/** Plain text for previews and notifications: Markdown markers removed. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/:?-{2,}:?/g, " ")
    .replace(/[*_`#>|~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
