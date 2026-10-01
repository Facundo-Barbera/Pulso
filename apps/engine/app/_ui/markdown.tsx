import { Fragment } from "react";

/**
 * Just enough Markdown for the Coach's briefs: paragraphs, `-`/`*`/`1.` lists,
 * `#` headings, **bold** and *italic*. Rendered as React elements, never as
 * HTML, so model text cannot inject markup. The Coach chat (next wave) may
 * swap this for a full renderer.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={blocks.length} className="marker:text-muted-foreground list-disc space-y-1 pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    blocks.push(heading ? <p key={blocks.length} className="font-semibold">{inline(heading[1]!)}</p> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={className}>{blocks}</div>;
}

function inline(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    ) : part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
      <em key={i}>{part.slice(1, -1)}</em>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
