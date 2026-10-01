import { expect, test } from "bun:test";
import { cells, linkLabel, parseBlocks, parseInline, plainText } from "./markdown-parse";

test("headings, paragraphs with line breaks, rules and quotes", () => {
  expect(parseBlocks("## Hoy\nDuerme bien.\nY come.\n\n---\n> Ojo con\n> la rodilla")).toEqual([
    { type: "heading", level: 2, text: "Hoy" },
    { type: "paragraph", text: "Duerme bien.\nY come." },
    { type: "rule" },
    { type: "quote", blocks: [{ type: "paragraph", text: "Ojo con\nla rodilla" }] },
  ]);
});

test("a paragraph ends where a list starts, and lists nest", () => {
  const blocks = parseBlocks("Tu semana:\n- Lunes: pierna\n  - sentadilla\n  - prensa\n- Jueves: torso\n\n3. tres\n4. cuatro");
  expect(blocks[0]).toEqual({ type: "paragraph", text: "Tu semana:" });
  expect(blocks[1]).toMatchObject({ type: "list", ordered: false, items: [[{ type: "paragraph", text: "Lunes: pierna" }, { type: "list", items: [[{ text: "sentadilla" }], [{ text: "prensa" }]] }], [{ text: "Jueves: torso" }]] });
  expect(blocks[2]).toMatchObject({ type: "list", ordered: true, start: 3, items: [[{ text: "tres" }], [{ text: "cuatro" }]] });
});

test("a blank line between items keeps one list", () => {
  const blocks = parseBlocks("- uno\n\n- dos\n\nFin.");
  expect(blocks).toHaveLength(2);
  expect(blocks[0]).toMatchObject({ type: "list", items: [[{ text: "uno" }], [{ text: "dos" }]] });
});

test("tables keep alignment, pad short rows and respect escaped pipes", () => {
  expect(parseBlocks("| Comida | kcal |\n|:--|--:|\n| Avena \\| leche | 350 |\n| Pollo |")).toEqual([
    { type: "table", header: ["Comida", "kcal"], align: ["left", "right"], rows: [["Avena | leche", "350"], ["Pollo", ""]] },
  ]);
  expect(cells("| `a|b` | c |")).toEqual(["`a|b`", "c"]);
});

test("fenced code is kept verbatim", () => {
  expect(parseBlocks("```json\n{ \"a\": 1 }\n```\nok")).toEqual([
    { type: "code", lang: "json", text: '{ "a": 1 }' },
    { type: "paragraph", text: "ok" },
  ]);
});

test("inline marks, links and bare URLs", () => {
  expect(parseInline("**Proteína** y *agua*, `150 g`, ~~no~~")).toEqual([
    { type: "strong", children: [{ type: "text", text: "Proteína" }] },
    { type: "text", text: " y " },
    { type: "em", children: [{ type: "text", text: "agua" }] },
    { type: "text", text: ", " },
    { type: "code", text: "150 g" },
    { type: "text", text: ", " },
    { type: "del", children: [{ type: "text", text: "no" }] },
  ]);
  expect(parseInline("Fuente: [OMS](https://www.who.int/x) (https://example.com/a).")).toEqual([
    { type: "text", text: "Fuente: " },
    { type: "link", href: "https://www.who.int/x", children: [{ type: "text", text: "OMS" }] },
    { type: "text", text: " (" },
    { type: "link", href: "https://example.com/a", children: [{ type: "text", text: "https://example.com/a" }] },
    { type: "text", text: ")." },
  ]);
});

test("unsafe links stay text and snake_case is not italic", () => {
  expect(parseInline("[clic](javascript:alert(1))")).toEqual([{ type: "text", text: "clic" }, { type: "text", text: ")" }]);
  expect(parseInline("usa log_meal_entry")).toEqual([{ type: "text", text: "usa log_meal_entry" }]);
});

test("labels and plain text", () => {
  expect(linkLabel("https://www.who.int/")).toBe("who.int");
  expect(linkLabel("https://pubmed.ncbi.nlm.nih.gov/123456789/some-very-long-article-slug-here")).toHaveLength(48);
  expect(plainText("## Hola\n**bien** [OMS](https://who.int)")).toBe("Hola bien OMS");
});
