import { ArrowUpRight } from "lucide-react";
import { Fragment } from "react";
import { cn } from "./cn";
import { linkLabel, parseBlocks, parseInline, type Align, type Block, type Inline } from "./markdown-parse";

/**
 * The Coach's Markdown (markdown-parse.ts) as React elements, never as HTML,
 * so model text cannot inject markup. Tables scroll sideways on narrow
 * screens; links open outside the app (Electron hands them to the browser).
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return <div className={cn("min-w-0 break-words", className)}>{blocks(parseBlocks(text))}</div>;
}

const ALIGN: Record<Exclude<Align, null>, string> = { left: "text-left", center: "text-center", right: "text-right" };

function blocks(list: Block[]): React.ReactNode {
  return list.map((block, i) => <Fragment key={i}>{renderBlock(block)}</Fragment>);
}

function renderBlock(block: Block): React.ReactNode {
  switch (block.type) {
    case "heading":
      return block.level <= 2 ? (
        <h3 className="pt-1 text-[1.1em] font-semibold tracking-tight">{inline(block.text)}</h3>
      ) : (
        <h4 className="pt-0.5 font-semibold">{inline(block.text)}</h4>
      );
    case "paragraph":
      return <p>{inline(block.text)}</p>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i} className="pl-1 [&>div]:space-y-2">
          {/* A tight item is one paragraph: no wrapper, so the marker lines up. */}
          {item.length === 1 && item[0]!.type === "paragraph" ? inline(item[0]!.text) : <div>{blocks(item)}</div>}
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="marker:text-muted-foreground list-decimal space-y-1.5 pl-6 marker:tabular-nums">
          {items}
        </ol>
      ) : (
        <ul className="marker:text-muted-foreground list-disc space-y-1.5 pl-5">{items}</ul>
      );
    }
    case "quote":
      return <blockquote className="border-border text-muted-foreground space-y-2 border-l-2 pl-4">{blocks(block.blocks)}</blockquote>;
    case "code":
      return (
        <pre className="bg-muted overflow-x-auto rounded-xl px-4 py-3 font-mono text-[13px] leading-relaxed">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="border-border -mx-1 overflow-x-auto rounded-xl border">
          <table className="w-full border-collapse text-[0.93em] leading-snug">
            <thead className="bg-muted/70">
              <tr>
                {block.header.map((cell, c) => (
                  <th key={c} scope="col" className={cn("px-3 py-2 text-left font-semibold whitespace-nowrap", block.align[c] && ALIGN[block.align[c]!])}>
                    {inline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-border even:bg-muted/30 border-t">
                  {row.map((cell, c) => (
                    <td key={c} className={cn("tabular px-3 py-2 align-top", c === 0 && "font-medium", block.align[c] && ALIGN[block.align[c]!])}>
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr className="border-border" />;
  }
}

function inline(text: string): React.ReactNode {
  return nodes(parseInline(text));
}

function nodes(list: Inline[]): React.ReactNode {
  return list.map((node, i) => <Fragment key={i}>{renderInline(node)}</Fragment>);
}

function renderInline(node: Inline): React.ReactNode {
  switch (node.type) {
    case "text":
      // Single line breaks are deliberate in chat text.
      return node.text.split("\n").map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {part}
        </Fragment>
      ));
    case "code":
      return <code className="bg-muted rounded-md px-1.5 py-0.5 font-mono text-[0.88em]">{node.text}</code>;
    case "strong":
      return <strong className="font-semibold">{nodes(node.children)}</strong>;
    case "em":
      return <em>{nodes(node.children)}</em>;
    case "del":
      return <del className="text-muted-foreground">{nodes(node.children)}</del>;
    case "link": {
      const bare = node.children.length === 1 && node.children[0]!.type === "text" && node.children[0]!.text === node.href;
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer"
          title={node.href}
          className="text-primary decoration-primary/30 hover:decoration-primary focus-visible:ring-ring rounded-sm font-medium underline underline-offset-[3px] outline-none focus-visible:ring-2"
        >
          {bare ? linkLabel(node.href) : nodes(node.children)}
          <ArrowUpRight className="ml-0.5 inline size-[0.85em] align-[-0.05em] opacity-60" aria-hidden />
        </a>
      );
    }
  }
}
