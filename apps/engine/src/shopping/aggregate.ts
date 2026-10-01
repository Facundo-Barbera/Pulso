import type { DietPlan, ShoppingCategory } from "@pulso/contract";
import { addDays } from "../nutrition/dates";
import { planDayIndex } from "../nutrition/store";

/** Lowercase, no accents. ñ folds to n: fine for matching. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Spanish plural → singular, good enough to match "huevos" with "huevo" and "limones" with "limón". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ces")) return word.slice(0, -3) + "z";
  if (word.length > 4 && /[lrnd]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

// How it is cooked doesn't change what you buy.
const PREPARATION = /\b(a la plancha|a la parrilla|al horno|al vapor|en crudo|cocid[oa]s?|crud[oa]s?|hervid[oa]s?|asad[oa]s?|saltead[oa]s?)\b/g;

/** The ingredient's identity: "Pechugas de pollo a la plancha" and "pechuga de pollo" are one thing to buy. */
export function nameKey(name: string): string {
  return fold(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(PREPARATION, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

// First match wins, so the order settles overlaps ("queso batido" is dairy, "zumo de naranja" a drink, "tomate frito" pantry).
const word = (...stems: string[]) => new RegExp(`\\b(?:${stems.join("|")})(?:s|es)?\\b`);
const AISLES: [ShoppingCategory, RegExp][] = [
  ["congelados", word("congelad[oa]", "helado")],
  ["despensa", word("mantequilla de cacahuete", "crema de cacahuete", "tomate frito", "leche de coco")],
  ["lacteos_huevos", word("leche", "yogur", "yogurt", "queso", "kefir", "nata", "mantequilla", "requeson", "cuajada", "skyr", "huevo", "clara", "lacteo")],
  ["bebidas", word("bebida", "zumo", "jugo", "refresco", "agua", "cafe", "te", "infusion", "cerveza", "vino", "batido", "isotonica")],
  [
    "carnes_pescados",
    word(
      "pollo", "pavo", "ternera", "vacuno", "cerdo", "lomo", "jamon", "carne", "pechuga", "muslo", "solomillo", "hamburguesa", "salchicha",
      "chorizo", "embutido", "conejo", "cordero", "pescado", "salmon", "atun", "merluza", "bacalao", "sardina", "caballa", "dorada", "lubina",
      "gamba", "langostino", "marisco", "mejillon", "calamar", "pulpo", "sepia", "trucha", "anchoa", "boqueron", "fiambre",
    ),
  ],
  [
    "panaderia_cereales",
    word("pan", "tostada", "biscote", "baguette", "arroz", "avena", "copo", "cereal", "muesli", "granola", "pasta", "espagueti", "macarron",
      "fideo", "quinoa", "cuscus", "harina", "tortilla de trigo", "wrap", "tortita", "galleta", "bollo", "croissant", "maiz"),
  ],
  [
    "frutas_verduras",
    word(
      "fruta", "verdura", "manzana", "platano", "banana", "naranja", "mandarina", "pera", "uva", "fresa", "frutos rojos", "arandano", "frambuesa",
      "kiwi", "mango", "pina", "melon", "sandia", "melocoton", "albaricoque", "cereza", "limon", "lima", "aguacate", "tomate", "lechuga",
      "espinaca", "rucula", "brocoli", "coliflor", "calabacin", "berenjena", "pimiento", "cebolla", "ajo", "zanahoria", "patata", "boniato",
      "batata", "pepino", "champinon", "seta", "judia verde", "esparrago", "alcachofa", "apio", "puerro", "calabaza", "col", "repollo",
      "kale", "canonigo", "ensalada", "perejil", "cilantro", "albahaca", "jengibre", "remolacha", "rabano", "guisante",
    ),
  ],
  [
    "despensa",
    word(
      "aceite", "vinagre", "sal", "pimienta", "especia", "azucar", "miel", "lenteja", "garbanzo", "alubia", "judia", "legumbre", "frutos secos",
      "nuez", "almendra", "anacardo", "cacahuete", "pistacho", "avellana", "semilla", "chia", "lino",
      "proteina", "whey", "creatina", "chocolate", "cacao", "conserva", "lata", "salsa", "mostaza", "mayonesa", "ketchup",
      "caldo", "levadura", "hummus", "aceituna", "datil", "pasa", "mermelada", "edulcorante", "soja", "tofu",
    ),
  ],
];

/** The aisle for an ingredient, from Spanish keywords in its name. The Coach can correct it. */
export function classify(name: string): ShoppingCategory {
  const folded = fold(name);
  return AISLES.find(([, re]) => re.test(folded))?.[0] ?? "otros";
}

// Units the engine can convert, to a base unit and its factor. Anything else stays in its own unit.
const UNITS: Record<string, [string, number]> = {
  g: ["g", 1], gr: ["g", 1], gramo: ["g", 1], kg: ["g", 1000], kilo: ["g", 1000],
  ml: ["ml", 1], cl: ["ml", 10], l: ["ml", 1000], litro: ["ml", 1000],
  serving: ["ud", 1], ud: ["ud", 1], u: ["ud", 1], unidad: ["ud", 1], pieza: ["ud", 1], racion: ["ud", 1], porcion: ["ud", 1],
};

/** Plans count liquids in grams; you buy them by volume. */
const LIQUID = word("leche", "bebida", "zumo", "jugo", "caldo", "kefir", "agua", "aceite", "nata liquida");
const EGG = /^huevo\b/;
const EGG_GRAMS = 60;

/** Unit and amount in the unit the list counts it in: g, ml, ud or the plan's own (folded, singular). */
export function baseUnit(key: string, quantity: number, unit: string): { unit: string; quantity: number } {
  const folded = singular(fold(unit));
  const [base, factor] = UNITS[folded] ?? [folded || "ud", 1];
  const amount = quantity * factor;
  if (base === "g" && EGG.test(key)) return { unit: "ud", quantity: amount / EGG_GRAMS };
  if (base === "g" && LIQUID.test(key)) return { unit: "ml", quantity: amount };
  return { unit: base, quantity: amount };
}

const ceilTo = (value: number, step: number) => Math.ceil(value / step - 1e-6) * step;
const number = (n: number) => (Math.round(n * 10) / 10).toLocaleString("es-ES", { maximumFractionDigits: 1 });
const plural = (unit: string) => (/[aeiou]$/.test(unit) ? unit + "s" : unit + "es");

/** Rounds up to what you'd actually buy: "1,4 kg", "650 g", "2 L", "12" (eggs by the half dozen), "3 latas". */
export function buyable(quantity: number, unit: string, key = ""): string {
  switch (unit) {
    case "g":
      return quantity >= 1000 ? `${number(ceilTo(quantity / 1000, 0.1))} kg` : `${ceilTo(quantity, quantity > 100 ? 50 : 10)} g`;
    case "ml":
      return quantity >= 500 ? `${number(ceilTo(quantity / 1000, 0.5))} L` : `${ceilTo(quantity, quantity > 100 ? 50 : 10)} ml`;
    case "ud":
      return number(EGG.test(key) && quantity > 6 ? ceilTo(quantity, 6) : ceilTo(quantity, 1));
    default: {
      const n = ceilTo(quantity, 1);
      return `${number(n)} ${n === 1 ? unit : plural(unit)}`;
    }
  }
}

/** One line of the list as the plan asks for it. `key` is name + unit: what can't be converted stays a separate line. */
export type Needed = { key: string; name: string; quantity: number; unit: string; amount: string; category: ShoppingCategory };

/** Walks the plan's days in rotation over `days` days from `from`, adding up each ingredient. */
export function aggregate(plan: Pick<DietPlan, "startsOn" | "days">, from: string, days: number): Needed[] {
  const byKey = new Map<string, Omit<Needed, "amount" | "category">>();
  for (let i = 0; i < days && plan.days.length; i++) {
    const day = plan.days[planDayIndex(plan, addDays(from, i))]!;
    for (const item of day.meals.flatMap((m) => m.items)) {
      const name = item.name.trim();
      const ingredient = nameKey(name);
      if (!ingredient || !(item.quantity > 0)) continue;
      const base = baseUnit(ingredient, item.quantity, String(item.unit ?? ""));
      const key = `${ingredient}|${base.unit}`;
      const seen = byKey.get(key);
      if (!seen) byKey.set(key, { key, name, ...base });
      else {
        seen.quantity += base.quantity;
        // The shortest wording reads best on a list: "Pollo" over "Pollo a la plancha".
        if (name.length < seen.name.length) seen.name = name;
      }
    }
  }
  return [...byKey.values()].map((n) => ({
    ...n,
    quantity: Math.round(n.quantity * 10) / 10,
    amount: buyable(n.quantity, n.unit, n.key),
    category: classify(n.name),
  }));
}
