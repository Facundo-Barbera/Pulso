import { Apple, Dumbbell, Moon, TrendingUp, type LucideIcon } from "lucide-react";

/** Quick prompts for an empty chat, as on iOS (StarterPrompt), plus sleep. */
export const STARTERS: { text: string; icon: LucideIcon; color: string }[] = [
  { text: "Diseña mi rutina de esta semana", icon: Dumbbell, color: "var(--domain-training)" },
  { text: "Arma mi plan de comidas", icon: Apple, color: "var(--domain-carbs)" },
  { text: "¿Cómo voy este mes?", icon: TrendingUp, color: "var(--domain-body)" },
  { text: "¿Cómo dormí esta semana?", icon: Moon, color: "var(--domain-sleep)" },
];
