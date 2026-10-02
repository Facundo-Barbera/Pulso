import fs from "node:fs";
import path from "node:path";

/**
 * The Coach's evidence base: curated Markdown cards in ./cards, read once and
 * searched with BM25 over title, tags and body. No external services.
 */

export const TOPICS = ["nutrition", "training", "body", "sleep", "medication", "supplements", "substances"] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_LABELS: Record<Topic, string> = {
  nutrition: "Nutrición",
  training: "Entrenamiento",
  body: "Composición corporal",
  sleep: "Sueño y recuperación",
  medication: "Medicación",
  supplements: "Suplementos",
  substances: "Alcohol y cannabis",
};

export type Card = {
  id: string;
  title: string;
  topic: Topic;
  tags: string[];
  evidence: "alta" | "moderada" | "baja";
  reviewed: string;
  /** Markdown after the front matter, sources included. */
  body: string;
  sources: string[];
};

// The engine runs with apps/engine as its working directory (next.config.ts relies on it too).
export const CARDS_DIR = path.join(process.cwd(), "src", "knowledge", "cards");

export function parseCard(text: string, file = "card"): Card {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new Error(`${file}: missing front matter`);
  const [, front = "", rest = ""] = match;
  const meta: Record<string, string> = {};
  for (const line of front.split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const body = rest.trim();
  const topic = meta.topic as Topic;
  const evidence = meta.evidence as Card["evidence"];
  if (!meta.id || !meta.title || !meta.reviewed) throw new Error(`${file}: id, title and reviewed are required`);
  if (!TOPICS.includes(topic)) throw new Error(`${file}: unknown topic ${meta.topic}`);
  if (!["alta", "moderada", "baja"].includes(evidence)) throw new Error(`${file}: evidence must be alta, moderada or baja`);
  const sources = (body.split(/^## Fuentes\s*$/m)[1] ?? "")
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
  const tags = (meta.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return { id: meta.id, title: meta.title, topic, tags, evidence, reviewed: meta.reviewed, body, sources };
}

const STOPWORDS = new Set(
  (
    "de la el los las un una unos unas y o u que en con por para a al del se me mi mis tu tus su sus lo le les es son " +
    "como mas pero sin sobre si no ya muy tan esto esta este eso esa ese hay ser estar soy estoy tengo tiene puedo " +
    "puede debo debe deberia cuanto cuanta cuantos cuantas cual cuales cuando donde mejor bien hacer hago tomo " +
    "tomar algo nada yo te nos the an of to and or in on for with is are what how much many can my do should per " +
    "when which it its at be from by"
  ).split(" "),
);

/** Lowercase words without accents or stopwords. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])-(\d)/g, "$1$2") // GLP-1 → glp1, omega-3 → omega3
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

// Longest first. Spanish conjugates and derives freely, so stripping these lets
// "entrenar", "entreno" and "entrenamiento" meet, and "proteínas" meet "protein".
const SUFFIXES = ["amiento", "imiento", "aciones", "acion", "adora", "ador", "mente", "idad", "ando", "iendo", "ar", "er", "ir", "as", "es", "os", "a", "e", "o", "s"];

function stem(word: string): string {
  for (const suffix of SUFFIXES) if (word.endsWith(suffix) && word.length - suffix.length >= 4) return word.slice(0, -suffix.length);
  return word;
}

export const tokenize = (text: string): string[] => words(text).map(stem);

/** Colloquial words and verb forms that cards tag under another name. Tags carry most synonyms; this is the overflow. */
const SYNONYMS: Record<string, string> = {
  cafe: "cafeina coffee",
  cafes: "cafeina coffee",
  ozempic: "semaglutida glp1",
  wegovy: "semaglutida glp1",
  rybelsus: "semaglutida glp1",
  mounjaro: "tirzepatida glp1",
  eutirox: "levotiroxina tiroides",
  euthyrox: "levotiroxina tiroides",
  synthroid: "levotiroxina tiroides",
  dormir: "sueno",
  duermo: "dormir sueno",
  dormi: "dormir sueno",
  cerveza: "alcohol",
  cervezas: "alcohol",
  vino: "alcohol",
  copas: "alcohol",
  porro: "cannabis",
  marihuana: "cannabis",
  weed: "cannabis",
  adelgazar: "deficit perder grasa",
  pierdo: "perder",
  perdi: "perder",
  dejo: "dejar",
  deje: "dejar",
  gano: "ganar",
  bebo: "beber",
  serie: "volumen",
  series: "volumen",
  sets: "volumen",
};

const FIELD_WEIGHTS = { title: 3, tags: 3, body: 1 };
const K1 = 1.2;
const B = 0.75;

type Indexed = { card: Card; tf: Map<string, number>; length: number };
type Index = { docs: Indexed[]; idf: Map<string, number>; avgLength: number };

export function buildIndex(cards: Card[]): Index {
  const docs = cards.map((card) => {
    const tf = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number) => {
      for (const token of tokenize(text)) {
        tf.set(token, (tf.get(token) ?? 0) + weight);
        length += weight;
      }
    };
    add(card.title, FIELD_WEIGHTS.title);
    add(card.tags.join(" "), FIELD_WEIGHTS.tags);
    add(card.body.split(/^## Fuentes\s*$/m)[0] ?? "", FIELD_WEIGHTS.body);
    return { card, tf, length };
  });
  const df = new Map<string, number>();
  for (const doc of docs) for (const token of doc.tf.keys()) df.set(token, (df.get(token) ?? 0) + 1);
  const idf = new Map([...df].map(([token, n]) => [token, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))]));
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  return { docs, idf, avgLength };
}

export function search(index: Index, query: string, opts: { topics?: Topic[]; limit?: number } = {}): { card: Card; score: number }[] {
  const raw = words(query);
  const terms = new Set(tokenize([...raw, ...raw.map((w) => SYNONYMS[w] ?? "")].join(" ")));
  return index.docs
    .filter((doc) => !opts.topics?.length || opts.topics.includes(doc.card.topic))
    .map((doc) => {
      let score = 0;
      for (const term of terms) {
        const tf = doc.tf.get(term);
        if (!tf) continue;
        score += (index.idf.get(term) ?? 0) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / index.avgLength)));
      }
      return { card: doc.card, score };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 3);
}

let cached: { cards: Card[]; index: Index } | undefined;

function load() {
  if (!cached) {
    const files = fs.existsSync(CARDS_DIR) ? fs.readdirSync(CARDS_DIR).filter((f) => f.endsWith(".md")).sort() : [];
    const cards = files.map((f) => parseCard(fs.readFileSync(path.join(CARDS_DIR, f), "utf8"), f));
    cached = { cards, index: buildIndex(cards) };
  }
  return cached;
}

export const listCards = (): Card[] => load().cards;

export const consultKnowledge = (query: string, opts: { topics?: Topic[]; limit?: number } = {}) => search(load().index, query, opts);

/** Titles only, by topic: tells the Coach what exists without spending the context on it. */
export function knowledgeIndex(): string {
  const cards = listCards();
  if (!cards.length) return "";
  const lines = TOPICS.flatMap((topic) => {
    const titles = cards.filter((c) => c.topic === topic).map((c) => c.title);
    return titles.length ? [`- ${TOPIC_LABELS[topic]}: ${titles.join(" · ")}`] : [];
  });
  return ["## Evidence base (read the cards with consult_knowledge)", ...lines].join("\n");
}
