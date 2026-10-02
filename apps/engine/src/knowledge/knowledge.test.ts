import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { claudeMd, PERSONA } from "../agent/workspace";
import { CARDS_DIR, consultKnowledge, knowledgeIndex, listCards, parseCard, tokenize } from "./store";
import { knowledgeTools } from "./tools";

test("every card is well formed: front matter, the four sections, dated sources with a URL", () => {
  const files = fs.readdirSync(CARDS_DIR).filter((f) => f.endsWith(".md"));
  expect(files.length).toBeGreaterThanOrEqual(25);
  for (const file of files) {
    const card = parseCard(fs.readFileSync(path.join(CARDS_DIR, file), "utf8"), file);
    expect(`${card.id}.md`).toBe(file);
    expect(card.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(card.tags.length).toBeGreaterThanOrEqual(5);
    for (const section of ["## Recomendación", "## Cuándo aplica", "## Matices", "## Cuándo derivar a un profesional", "## Fuentes"]) {
      expect(card.body, `${file} lacks ${section}`).toContain(section);
    }
    expect(card.sources.length, `${file} has no sources`).toBeGreaterThan(0);
    for (const source of card.sources) expect(source, `${file}: ${source}`).toMatch(/(19|20)\d{2}.*https?:\/\//);
  }
});

test("tokens ignore accents, case and plurals", () => {
  expect(tokenize("Proteínas")).toEqual(tokenize("proteina"));
  expect(tokenize("sesiones")).toEqual(["sesion"]);
  expect(tokenize("GLP-1")).toEqual(["glp1"]);
  expect(tokenize("¿Cuánta de la")).toEqual([]);
});

/** Offline eval: what the person would ask → the card the Coach must get back (top 3). */
const EVAL: [string, string[]][] = [
  ["¿cuánta proteína con semaglutida?", ["glp1-proteina-musculo"]],
  ["¿puedo tomar café con la levotiroxina?", ["levotiroxina"]],
  ["¿cuántas series por semana para pecho?", ["volumen-semanal"]],
  ["¿cuánta creatina tomo y cuándo?", ["creatina"]],
  ["¿a qué ritmo debería bajar de peso?", ["deficit-ritmo-perdida"]],
  ["¿cuántas horas tengo que dormir?", ["sueno-duracion"]],
  ["¿el alcohol afecta la recuperación muscular?", ["alcohol-sueno-recuperacion"]],
  ["fumé un porro anoche, ¿por eso dormí mal?", ["cannabis-sueno-recuperacion"]],
  ["¿qué tan fiable es la grasa que marca mi InBody?", ["bioimpedancia-inbody"]],
  ["¿cada cuánto hago una semana de descarga?", ["descargas-deload"]],
  ["¿cuánta agua debo beber al día?", ["agua-hidratacion"]],
  ["¿cuánta fibra necesito?", ["fibra"]],
  ["¿qué significa dejar 2 RIR?", ["rpe-rir"]],
  ["si dejo de entrenar dos semanas, ¿pierdo músculo?", ["desentrenamiento"]],
  ["¿hasta qué hora puedo tomar café sin dormir mal?", ["cafeina"]],
  ["¿puedo perder grasa y ganar músculo a la vez?", ["recomposicion-corporal"]],
  ["tengo náuseas con el Ozempic", ["glp1-semaglutida"]],
  ["¿cuántos minutos de ejercicio a la semana recomienda la OMS?", ["actividad-fisica-oms"]],
  ["¿me sirve hacer un refeed?", ["refeeds-diet-breaks"]],
  ["¿el cardio me quita músculo?", ["cardio-y-fuerza"]],
  ["how much protein per kg to build muscle", ["proteina-diaria"]],
];

for (const [question, expected] of EVAL) {
  test(`eval: "${question}" → ${expected.join(", ")}`, () => {
    const ids = consultKnowledge(question).map((hit) => hit.card.id);
    for (const id of expected) expect(ids).toContain(id);
  });
}

test("protein on semaglutide also brings a GLP-1 card and a general protein card", () => {
  const ids = consultKnowledge("¿cuánta proteína debo comer con semaglutida para no perder músculo?", { limit: 5 }).map((h) => h.card.id);
  expect(ids.some((id) => id.startsWith("glp1"))).toBe(true);
  expect(ids.some((id) => id.startsWith("proteina"))).toBe(true);
});

test("topics narrow the search and nonsense finds nothing", () => {
  expect(consultKnowledge("café", { topics: ["medication"] }).every((h) => h.card.topic === "medication")).toBe(true);
  expect(consultKnowledge("xyzzy quux")).toEqual([]);
});

test("the tool returns the cards with their evidence level and sources", async () => {
  const [consult] = knowledgeTools;
  const result = await consult!.handler({ query: "creatina dosis", topics: undefined, limit: 1 }, {});
  const { cards } = JSON.parse((result.content[0] as { text: string }).text);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ id: "creatina", topic: "supplements" });
  expect(cards[0].evidence).toMatch(/alta|moderada|baja/);
  expect(cards[0].content).toContain("## Fuentes");
});

test("the workspace lists every card title and the persona says to consult before giving numbers", () => {
  const md = claudeMd({});
  expect(md).toContain(knowledgeIndex());
  for (const card of listCards()) expect(md).toContain(card.title);
  expect(PERSONA).toContain("## Conocimiento");
  expect(PERSONA).toContain("call consult_knowledge first");
});
