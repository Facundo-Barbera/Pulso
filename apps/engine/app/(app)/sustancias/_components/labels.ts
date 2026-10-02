import type { Substance, SubstanceAmount, SubstanceContext, SubstanceForm } from "@pulso/contract";

/** One calm colour for the whole section; never a warning colour for use. */
export const COLOR = "var(--domain-medication)";

export const SUBSTANCE_LABEL: Record<Substance, string> = { cannabis: "Cannabis", alcohol: "Alcohol", nicotina: "Nicotina" };
export const FORM_LABEL: Record<SubstanceForm, string> = { fumado: "Fumado", vapeado: "Vapeado", comestible: "Comestible", otro: "Otro" };
export const AMOUNT_LABEL: Record<SubstanceAmount, string> = { poco: "Poco", normal: "Normal", mucho: "Mucho" };
export const CONTEXT_LABEL: Record<SubstanceContext, string> = { social: "Social", solo: "Solo", dormir: "Para dormir", estres: "Estrés", otro: "Otro" };

export const options = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
