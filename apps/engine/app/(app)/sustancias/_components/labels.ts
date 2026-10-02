import type { Substance, SubstanceAmount, SubstanceContext } from "@pulso/contract";

/** One calm colour for the whole section; never a warning colour for use. */
export const COLOR = "var(--domain-medication)";

export const AMOUNT_LABEL: Record<SubstanceAmount, string> = { poco: "Poco", normal: "Normal", mucho: "Mucho" };
export const CONTEXT_LABEL: Record<SubstanceContext, string> = { social: "Social", solo: "Solo", dormir: "Para dormir", estres: "Estrés", otro: "Otro" };
export const UNIT_SUGGESTIONS = ["sesiones", "mg", "ml", "unidades", "tragos", "veces"];

export const options = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

/** "vapeado" → "Vapeado". */
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The web can only draw an emoji; an SF Symbol name (the phone's) shows nothing here. */
export const emojiOf = (substance: Pick<Substance, "symbol">) => (substance.symbol && !/^[a-z0-9.]+$/.test(substance.symbol) ? substance.symbol : null);
