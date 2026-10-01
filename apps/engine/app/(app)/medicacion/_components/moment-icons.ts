import type { DoseMoment } from "@pulso/contract";
import { BedDouble, Clock, Dumbbell, Moon, Sunrise, Utensils, type LucideIcon } from "lucide-react";

/** The symbol of each moment a dose hangs on; shared by the page and Hoy's card. */
export const MOMENT_ICON: Record<DoseMoment, LucideIcon> = { hora: Clock, entreno: Dumbbell, desayuno: Sunrise, comida: Utensils, cena: Moon, dormir: BedDouble };
