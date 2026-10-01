/**
 * How much of a scanned product a portion said in words is: "una cucharada",
 * "la mitad del paquete", "3 galletas", "2 de 6 galletas", "un tercio de la
 * botella". Spoons and cups of a solid go through a small density table, so
 * a spoon of peanut butter weighs more than a spoon of oats.
 */
import type { FoodProduct, Macros, Measure, PortionEstimate } from "@pulso/contract";
import { HOUSEHOLD_SIZES } from "@pulso/contract";
import { normalizeBarcode } from "./barcode";
import { parseMeasure } from "./measure";

/** An amount that can't be worked out; the message is Spanish, for the person (and the Coach to relay). */
export class PortionError extends Error {}

/** Grams per ml of foods people measure with spoons and cups, matched on the product's name (folded). First match wins. */
const DENSITIES: [RegExp, number, string][] = [
  [/(crema|mantequilla|pasta) de (cacahuate|cacahuete|mani)|peanut butter/, 1.07, "crema de cacahuate"],
  [/(crema|untable).*(cacao|avellana)|nutella|nocilla/, 1.25, "crema de cacao"],
  [/mantequilla|margarina|butter/, 0.95, "mantequilla"],
  [/mayonesa|mayo\b/, 0.92, "mayonesa"],
  [/miel|sirope|jarabe|honey/, 1.42, "miel"],
  [/aceite|\boil\b/, 0.92, "aceite"],
  [/leche en polvo|milk powder|powdered milk/, 0.5, "leche en polvo"],
  [/yogur|yogurt|skyr|kefir/, 1.03, "yogur"],
  [/proteina|whey|protein/, 0.45, "proteína en polvo"],
  [/azucar|sugar/, 0.85, "azúcar"],
  [/harina|maicena|flour/, 0.53, "harina"],
  [/avena|\boats?\b/, 0.36, "avena"],
  [/arroz.*(cocido|cocinado|vasito|microondas)|cooked rice/, 0.73, "arroz cocido"],
  [/arroz|\brice\b/, 0.78, "arroz crudo"],
  [/rallado|parmesano|grated/, 0.4, "queso rallado"],
  [/granola|muesli/, 0.45, "granola"],
  [/cereal|corn ?flakes|copos/, 0.13, "cereal"],
  [/cacao|cocoa|cola ?cao|nesquik/, 0.45, "cacao en polvo"],
  [/mermelada|confitura|\bjam\b/, 1.33, "mermelada"],
  [/ketchup|salsa|mostaza/, 1.1, "salsa"],
  [/chia|lino|semillas/, 0.65, "semillas"],
];
/** A solid nobody listed: between a powder and a paste. */
const DEFAULT_SOLID_DENSITY = 0.8;

/** Typical weight of one counted thing, when the package doesn't say. */
const UNIT_WEIGHTS: [RegExp, number][] = [
  [/^galletas?$/, 10],
  [/^(rebanadas?|tostadas?)$/, 25],
  [/^lonchas?$/, 15],
  [/^(onzas?|cuadritos?|cuadros?|pastillas?)$/, 6],
  [/^barritas?$/, 25],
  [/^(bombones?|bombon)$/, 12],
  [/^nuggets?$/, 18],
  [/^caramelos?$/, 5],
];

const SCOOP = /^(scoops?|cacitos?|cazos?|medidor(es)?|dosis)$/;
const PACKAGE = /^(paquetes?|botes?|frascos?|tarros?|envases?|bolsas?|cajas?|tabletas?|bricks?|tarrinas?|packs?|latas?|botellas?|botellin(es)?|vasitos?)$/;
const SHARES: [RegExp, number][] = [
  [/\bdos tercios\b/, 2 / 3],
  [/\btres cuartos\b/, 3 / 4],
  [/\bmitad\b/, 1 / 2],
  [/\btercio\b/, 1 / 3],
  [/\bcuarto\b/, 1 / 4],
  [/\bquinto\b/, 1 / 5],
  [/\b(todo|toda|entero|entera|completo|completa)\b/, 1],
];
const NUMBER_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12 };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const count = (word: string | undefined) => (word === undefined ? undefined : /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word]);
const fmt = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: n < 10 ? 1 : 0 });
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The density for spoons and cups of this product, and what it was taken as. */
export function densityOf(product: Pick<FoodProduct, "name" | "liquid">): { density: number; as: string | null } {
  if (product.liquid) return { density: 1, as: null };
  const name = fold(product.name);
  const found = DENSITIES.find(([pattern]) => pattern.test(name));
  return found ? { density: found[1], as: found[2] } : { density: DEFAULT_SOLID_DENSITY, as: null };
}

/** Options the Coach can pass when the label says more than Open Food Facts. */
export type PortionHints = { unitGrams?: number; unitsPerPackage?: number; density?: number };

type Amount = { quantity: number; measure: Measure | null; share: number | null; said: string; how?: string };

/**
 * Works out `text` against the product: grams (ml for a drink), the macros for
 * them and the assumption in one Spanish line. Throws PortionError when the
 * amount can't be read or needs something the label doesn't say.
 */
export function estimatePortion(product: FoodProduct, text: string, hints: PortionHints = {}): PortionEstimate {
  const said = text.trim().replace(/\s+/g, " ");
  // Punctuation goes, decimal marks ("1,5") stay.
  const folded = fold(said).replace(/[()¿?¡!]|(?<!\d)[.,]|[.,](?!\d)/g, " ").replace(/(\d)([a-z%])/g, "$1 $2").replace(/\s+/g, " ").trim();
  if (!folded) throw new PortionError("Dime cuánto comiste: «una cucharada», «la mitad», «3 galletas»…");
  const unit = product.liquid ? "ml" : "g";
  const amount = shareOf(product, folded, said, hints) ?? measured(product, folded, said, hints);
  const quantity = amount.quantity >= 10 ? Math.round(amount.quantity) : r1(amount.quantity);
  if (!(quantity > 0)) throw new PortionError("Esa cantidad es cero; dime cuánto comiste.");
  const macros = scale(product.per100g, quantity / 100);
  const share = amount.share ?? (product.packageSize ? quantity / product.packageSize : null);
  // What is logged adds up to the same grams: "1 cucharada" of 16 g, not of 16,05.
  const measure = amount.measure?.size && amount.measure.unit !== "lata" && amount.measure.unit !== "botella" ? { ...amount.measure, size: r1(quantity / amount.measure.amount) } : amount.measure;
  const head = amount.how ? `${amount.said} de ${product.name} (${amount.how})` : `${amount.said} de ${product.name}`;
  return {
    barcode: product.barcode,
    name: product.name,
    quantity,
    unit,
    macros,
    measure,
    packageShare: share === null ? null : Math.round(share * 1000) / 1000,
    assumption: `${head} ≈ ${fmt(quantity)} ${unit} → ${macros.kcal} kcal`,
  };
}

function scale(per100: Macros, factor: number): Macros {
  return {
    kcal: Math.round(per100.kcal * factor),
    protein: r1(per100.protein * factor),
    carbs: r1(per100.carbs * factor),
    fat: r1(per100.fat * factor),
    fiber: r1(per100.fiber * factor),
  };
}

function packageSize(product: FoodProduct): number {
  if (!product.packageSize) throw new PortionError("No sé cuánto trae el paquete: dime los gramos o cuánto pesa entero.");
  return product.packageSize;
}

/** As a share of the package, when it is said that way; undefined otherwise. */
function shareOf(product: FoodProduct, folded: string, said: string, hints: PortionHints): Amount | undefined {
  const kind = product.packageKind;
  const asMeasure = (share: number): Measure | null => (kind ? { amount: r1(share), unit: kind, size: packageSize(product) } : null);
  const share = (n: number, how?: string): Amount => ({ quantity: n * packageSize(product), measure: asMeasure(n), share: n, said, how });

  // "2 de 6 galletas", "dos de las doce"
  const ofTotal = /\b(\d+|[a-z]+) de (?:las |los )?(\d+|[a-z]+)\b/.exec(folded);
  const eaten = count(ofTotal?.[1]);
  const total = count(ofTotal?.[2]);
  if (eaten && total && eaten <= total) return share(eaten / total, `paquete de ${fmt(packageSize(product))} ${product.liquid ? "ml" : "g"}`);

  const percent = /(\d+(?:[.,]\d+)?) ?%/.exec(folded);
  if (percent) return share(Number(percent[1]!.replace(",", ".")) / 100);

  // "la mitad", "un tercio de la botella", but "un cuarto de taza" is a cup.
  const spoken = SHARES.find(([pattern]) => pattern.test(folded));
  if (spoken) {
    const after = folded.split(/\b(?:mitad|tercios?|cuartos?|quinto|todo|toda|entero|entera|completo|completa)\b/)[1] ?? "";
    const next = after.replace(/^\s*(del|de la|de el|de|el|la)\s+/, "").split(" ")[0];
    const household = next && /^(tazas?|vasos?|cucharadas?|cucharaditas?|punos?)$/.test(next);
    if (!household) return share(spoken[1]);
    const parsed = parseMeasure(`1 ${next}`)!;
    return volume(product, spoken[1] * parsed.measure.amount, parsed.measure, said, hints);
  }

  // "1 paquete", "1/3 del bote", "media lata"
  const n = /^(\d+(?:[.,]\d+)?|\d+\/\d+|[a-z]+)(?: y media)? (?:del |de la |de )?([a-z]+)/.exec(folded);
  // A can or bottle of unknown size counts at the default size, further down.
  if (n && PACKAGE.test(n[2]!) && (product.packageSize || !/^(latas?|botellas?|botellin(es)?)$/.test(n[2]!))) {
    const value = parseMeasure(`${n[1]}${folded.includes(" y media") ? " y media" : ""} unidad`)?.measure.amount;
    if (value) return share(value);
  }
  return undefined;
}

/** Grams or ml from a spoon or cup of this product. */
function volume(product: FoodProduct, cups: number, measure: Measure, said: string, hints: PortionHints): Amount {
  const ml = cups * (HOUSEHOLD_SIZES[measure.unit as keyof typeof HOUSEHOLD_SIZES]?.size ?? 1);
  if (product.liquid) return { quantity: ml, measure: { ...measure, amount: r1(cups) }, share: null, said };
  const { density, as } = hints.density ? { density: hints.density, as: null } : densityOf(product);
  const grams = ml * density;
  const each = grams / cups;
  const how = measure.unit === "cucharada" || measure.unit === "cucharadita" ? `rasa, ~${fmt(each)} g ${as ? `como ${as}` : "de densidad típica"}` : `~${fmt(each)} g por ${measure.unit}`;
  return { quantity: grams, measure: { amount: r1(cups), unit: measure.unit, size: r1(each) }, share: null, said, how };
}

/** Spoons, cups, g, ml, scoops and counted things. */
function measured(product: FoodProduct, folded: string, said: string, hints: PortionHints): Amount {
  const words = folded.split(" ");
  const number = count(words[0]) ?? (/^\d+([.,]\d+)?$/.test(words[0] ?? "") ? Number(words[0]!.replace(",", ".")) : undefined);
  const noun = words[number === undefined ? 0 : 1];

  if (noun && SCOOP.test(noun)) {
    const each = hints.unitGrams ?? product.servingGrams ?? 30;
    const n = number ?? 1;
    return { quantity: n * each, measure: { amount: n, unit: "unidad", size: each }, share: null, said, how: `~${fmt(each)} g cada uno` };
  }

  const parsed = parseMeasure(folded);
  if (!parsed) throw new PortionError("No entendí la cantidad. Dila como «una cucharada», «la mitad», «3 galletas» o «30 g».");
  const { measure } = parsed;
  switch (measure.unit) {
    case "g":
    case "ml": {
      // Grams of a drink or ml of a solid: convert through the density.
      const same = (measure.unit === "ml") === product.liquid;
      const { density } = hints.density ? { density: hints.density } : densityOf(product);
      const quantity = same ? measure.amount : measure.unit === "ml" ? measure.amount * density : measure.amount / density;
      return { quantity, measure: null, share: null, said };
    }
    case "taza":
    case "vaso":
    case "cucharada":
    case "cucharadita":
      if (measure.size) return { quantity: measure.amount * measure.size, measure, share: null, said };
      return volume(product, measure.amount, measure, said, hints);
    case "puño":
      return { quantity: measure.amount * (measure.size ?? 30), measure, share: null, said };
    case "lata":
    case "botella": {
      const size = measure.size ?? product.packageSize ?? HOUSEHOLD_SIZES[measure.unit].size!;
      return { quantity: measure.amount * size, measure: { ...measure, size }, share: product.packageSize ? (measure.amount * size) / product.packageSize : null, said };
    }
    case "serving": {
      if (!product.servingGrams) throw new PortionError("La etiqueta no dice cuánto es una porción: dime los gramos.");
      return { quantity: measure.amount * product.servingGrams, measure: { amount: measure.amount, unit: "unidad", size: product.servingGrams }, share: null, said, how: `porción de ${fmt(product.servingGrams)} g` };
    }
    default: {
      // A count of things: "3 galletas", "2 galletas de 11 g".
      const each =
        measure.size ??
        hints.unitGrams ??
        (hints.unitsPerPackage && product.packageSize ? product.packageSize / hints.unitsPerPackage : undefined) ??
        UNIT_WEIGHTS.find(([pattern]) => noun && pattern.test(noun))?.[1];
      if (!each) throw new PortionError(`¿Cuánto pesa cada ${noun && noun !== "unidad" && noun !== "unidades" ? noun.replace(/s$/, "") : "unidad"}, o cuántas trae el paquete?`);
      const how = measure.size ? undefined : `~${fmt(each)} g cada una`;
      return { quantity: measure.amount * each, measure: { amount: measure.amount, unit: "unidad", size: r1(each) }, share: null, said, how };
    }
  }
}

/** What the model reads about a scanned product, one fact per line. */
export function describeProduct(barcode: string, product: FoodProduct | null): string {
  if (!product) return `Barcode ${barcode}: not found in Open Food Facts (or it was unreachable). Try lookup_food_barcode, else ask what it is.`;
  const per = product.liquid ? "100 ml" : "100 g";
  const unit = product.liquid ? "ml" : "g";
  const m = product.per100g;
  const { density, as } = densityOf(product);
  return [
    `Barcode: ${barcode}`,
    `Name: ${product.name}${product.brand ? ` — brand: ${product.brand}` : ""}`,
    `Per ${per}: ${m.kcal} kcal, protein ${m.protein} g, carbs ${m.carbs} g, fat ${m.fat} g, fiber ${m.fiber} g`,
    `Package: ${product.packageSize ? `${product.packageSize} ${unit}` : "size unknown"}${product.packageKind ? ` (${product.packageKind})` : ""}`,
    `Serving on the label: ${product.servingGrams ? `${product.servingGrams} ${unit}` : "unknown"}`,
    `Liquid: ${product.liquid ? "yes (counted in ml)" : "no"}`,
    product.liquid ? null : `Density for spoons and cups: ~${density} g/ml (${as ?? "typical solid, not in the table"})`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type PortionResult = { status: 200; estimate: PortionEstimate } | { status: 400 | 404 | 502; code: string; message: string };

/** The phone's and the web's «Cuánto comiste»: looks the code up and works the amount out. */
export async function portionFor(body: unknown, lookup: (code: string) => Promise<FoodProduct | null>): Promise<PortionResult> {
  const { barcode, amount } = (body ?? {}) as { barcode?: unknown; amount?: unknown };
  const code = typeof barcode === "string" ? normalizeBarcode(barcode) : undefined;
  if (!code) return { status: 400, code: "invalid_request", message: "El código debe tener de 8 a 14 dígitos." };
  if (typeof amount !== "string" || !amount.trim() || amount.length > 120) return { status: 400, code: "invalid_request", message: "Dime cuánto comiste: «una cucharada», «la mitad», «3 galletas»…" };
  let product: FoodProduct | null;
  try {
    product = await lookup(code);
  } catch {
    return { status: 502, code: "lookup_failed", message: "No se pudo consultar Open Food Facts." };
  }
  if (!product) return { status: 404, code: "not_found", message: "No conozco ese producto." };
  try {
    return { status: 200, estimate: estimatePortion(product, amount) };
  } catch (error) {
    if (error instanceof PortionError) return { status: 400, code: "invalid_request", message: error.message };
    throw error;
  }
}
