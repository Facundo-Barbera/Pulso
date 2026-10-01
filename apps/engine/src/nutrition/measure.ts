/**
 * Measures as people say them ("2 latas", "una taza de 300 ml", "un puño")
 * and the g / ml / servings that macros are counted against.
 */
import { HOUSEHOLD_SIZES, type HouseholdUnit, type Measure, type QuantityUnit } from "@pulso/contract";

export type Quantity = { quantity: number; unit: QuantityUnit };

const isHousehold = (unit: Measure["unit"]): unit is HouseholdUnit => unit in HOUSEHOLD_SIZES;
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The normalized amount of a measure. `base` is what an explicit size was given
 * in ("una unidad de 250 ml"); otherwise the unit's own.
 */
export function toQuantity(measure: Measure, base?: "g" | "ml"): Quantity {
  if (!isHousehold(measure.unit)) return { quantity: measure.amount, unit: measure.unit };
  const preset = HOUSEHOLD_SIZES[measure.unit];
  const size = measure.size ?? preset.size;
  if (size === null) return { quantity: measure.amount, unit: "serving" };
  return { quantity: round1(measure.amount * size), unit: measure.size !== null && base ? base : preset.base };
}

// Words are matched without accents, lower case.
const UNIT_WORDS: [RegExp, Measure["unit"], number?][] = [
  [/^(g|gr|grs|gramos?)$/, "g"],
  [/^(kg|kilos?|kilogramos?)$/, "g", 1000],
  [/^(ml|mililitros?)$/, "ml"],
  [/^(cl|centilitros?)$/, "ml", 10],
  [/^(l|lt|litros?)$/, "ml", 1000],
  [/^(tazas?|tazon(es)?)$/, "taza"],
  [/^vasos?$/, "vaso"],
  [/^latas?$/, "lata"],
  [/^(botellas?|botellin(es)?)$/, "botella"],
  [/^(cucharadas?|cda)$/, "cucharada"],
  [/^(cucharaditas?|cdta|cdita)$/, "cucharadita"],
  [/^(unidad(es)?|piezas?|u)$/, "unidad"],
  [/^(punos?|punados?)$/, "puño"],
  [/^(porcion(es)?|racion(es)?|servings?)$/, "serving"],
];

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
};

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** "1,5" → 1.5, "1/2" → 0.5, "una" → 1, "una y media" → 1.5. */
function readNumber(tokens: string[]): { value: number; used: number } | null {
  const [first, second, third] = tokens;
  if (!first) return null;
  let value: number | undefined;
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) value = Number(fraction[1]) / Number(fraction[2]);
  else if (/^\d+([.,]\d+)?$/.test(first)) value = Number(first.replace(",", "."));
  else value = NUMBER_WORDS[first];
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  if (second === "y" && (third === "medio" || third === "media")) return { value: value + 0.5, used: 3 };
  return { value, used: 1 };
}

function readUnit(word: string | undefined): { unit: Measure["unit"]; factor: number } | null {
  if (!word) return null;
  for (const [pattern, unit, factor] of UNIT_WORDS) if (pattern.test(word)) return { unit, factor: factor ?? 1 };
  return null;
}

/** A size like "330 ml", "(1,5 l)", "de 11 g" anywhere in the text. */
function readSize(text: string): { size: number; base: "g" | "ml" } | null {
  const match = /(\d+(?:[.,]\d+)?)\s*(ml|cl|l|g|gr|kg)\b/.exec(text);
  if (!match) return null;
  const unit = readUnit(match[2])!;
  return { size: Number(match[1]!.replace(",", ".")) * unit.factor, base: unit.unit === "g" ? "g" : "ml" };
}

/**
 * Reads a measure in Spanish: "2 latas", "1 taza", "250 ml", "33 cl",
 * "30 g de almendras", "un puño", "media taza", "una lata de 330 ml",
 * "2 galletas" (a count of things → unidad), "2 galletas de 11 g".
 * Null when there is neither an amount nor a unit to go on.
 */
export function parseMeasure(text: string): (Quantity & { measure: Measure }) | null {
  const folded = fold(text).replace(/[()]/g, " ");
  // "250ml" → "250 ml"
  const tokens = folded.replace(/(\d)([a-z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  const number = readNumber(tokens);
  const rest = tokens.slice(number?.used ?? 0);
  const said = readUnit(rest[0]);
  if (!number && !said) return null;
  const amount = number?.value ?? 1;

  if (said && !isHousehold(said.unit)) {
    const measure: Measure = { amount: round1(amount * said.factor), unit: said.unit, size: null };
    return { measure, ...toQuantity(measure) };
  }
  // A household unit, or a count of named things ("2 galletas"), maybe with its size after it.
  const unit = said?.unit ?? "unidad";
  const size = readSize(rest.slice(said ? 1 : 0).join(" "));
  const measure: Measure = { amount, unit, size: size?.size ?? null };
  return { measure, ...toQuantity(measure, size?.base) };
}
