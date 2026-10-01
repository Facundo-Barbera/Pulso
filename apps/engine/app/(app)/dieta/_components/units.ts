import { HOUSEHOLD_SIZES, type MealSlot, type Measure, type MeasureUnit, type QuantityUnit } from "@pulso/contract";

/** Units in the order the picker offers them, with singular and plural labels. */
export const UNITS: { unit: MeasureUnit; one: string; many: string }[] = [
  { unit: "g", one: "g", many: "g" },
  { unit: "ml", one: "ml", many: "ml" },
  { unit: "serving", one: "porción", many: "porciones" },
  { unit: "unidad", one: "unidad", many: "unidades" },
  { unit: "taza", one: "taza", many: "tazas" },
  { unit: "vaso", one: "vaso", many: "vasos" },
  { unit: "lata", one: "lata", many: "latas" },
  { unit: "botella", one: "botella", many: "botellas" },
  { unit: "cucharada", one: "cucharada", many: "cucharadas" },
  { unit: "cucharadita", one: "cucharadita", many: "cucharaditas" },
  { unit: "puño", one: "puño", many: "puños" },
];

export const isHousehold = (unit: MeasureUnit): unit is keyof typeof HOUSEHOLD_SIZES => unit in HOUSEHOLD_SIZES;
/** g, ml and servings are entered per 100 (g/ml) or per 1; household units per one of them. */
export const perHundred = (unit: MeasureUnit) => unit === "g" || unit === "ml";

const number = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
export const fmt = (value: number) => number.format(value);

export function unitLabel(unit: MeasureUnit, amount = 1): string {
  const u = UNITS.find((x) => x.unit === unit);
  return u ? (amount === 1 ? u.one : u.many) : unit;
}

/** "2 latas de 330 ml", "150 g", "1 porción". */
export function fmtAmount(measure: Measure | null, quantity: number, unit: QuantityUnit): string {
  if (!measure) return `${fmt(quantity)} ${unitLabel(unit, quantity)}`;
  const amount = measure.amount === 0.5 ? "½" : fmt(measure.amount);
  const base = isHousehold(measure.unit) ? HOUSEHOLD_SIZES[measure.unit].base : "";
  const size = measure.size ? ` de ${fmt(measure.size)} ${measure.unit === "unidad" ? "g" : base}` : "";
  return `${amount} ${unitLabel(measure.unit, measure.amount)}${size}`;
}

/** The slot a meal logged at this hour most likely belongs to. */
export function slotForHour(hour: number): MealSlot {
  if (hour < 11) return "desayuno";
  if (hour < 13) return "media_manana";
  if (hour < 17) return "comida";
  if (hour < 20) return "merienda";
  return "cena";
}

export const SLOT_OPTIONS: { slot: MealSlot; label: string }[] = [
  { slot: "desayuno", label: "Desayuno" },
  { slot: "media_manana", label: "Media mañana" },
  { slot: "comida", label: "Comida" },
  { slot: "merienda", label: "Merienda" },
  { slot: "cena", label: "Cena" },
  { slot: "snack", label: "Snack o bebida" },
];
