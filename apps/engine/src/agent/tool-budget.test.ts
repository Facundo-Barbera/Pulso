/**
 * What every Coach tool puts in the model's context, against a realistic
 * fixture: a 4-day program with history, a week of diet plan, meals, meds,
 * sleep, calendar. Every result stays under BUDGET characters unless it is
 * allow-listed with a reason: one bloated result is paid on every later turn
 * until the context is summarized. `PULSO_TOOL_SIZES=1 bun test tool-budget`
 * prints the table.
 */
import { expect, test } from "bun:test";
import { z } from "zod";
import { getShoppingList } from "../shopping/store";
import { getActiveProgram } from "../training/store";
import { ownDatabase } from "../web/test-db";
import { forModel } from "./model-results";
import { TOOLS } from "./registry";

ownDatabase("tool-budget");

export const BUDGET = 6_000;

/** Tools allowed past BUDGET, and why. Keep it short. */
const ALLOWED: Record<string, string> = {};

type Result = { text: string; error: boolean };

async function run(name: string, args: unknown = {}): Promise<Result> {
  const found = TOOLS.find((x) => x.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  // What the model reads: through the same wrapper as the Coach.
  const t = forModel(found);
  const result = await t.handler(z.object(t.inputSchema).parse(args) as never, undefined);
  return { text: result.content.map((c) => (c.type === "text" ? c.text : "")).join(""), error: result.isError === true };
}

async function value(name: string, args: unknown = {}) {
  const r = await run(name, args);
  if (r.error) throw new Error(`${name}: ${r.text}`);
  return JSON.parse(r.text);
}

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const TODAY = iso(Date.now());
const daysAgo = (n: number) => iso(Date.now() - n * DAY);
const item = (name: string, quantity: number, kcal: number, protein: number, unit = "g") => ({ name, quantity, unit, kcal, protein, carbs: Math.round(kcal / 10), fat: Math.round(kcal / 40) });

/** The person's data, as the real one looks after a few weeks. */
async function seed() {
  await value("update_profile", {
    age: 38,
    sex: "male",
    heightCm: 178,
    goals: "Bajar 8 kg de grasa antes de marzo sin perder músculo",
    experience: "Entrena desde hace 2 años, 4 días por semana",
    equipment: "Gimnasio completo; prefiere máquinas",
    schedule: "Lunes a jueves por la tarde, 60 min",
    injuries: "Molestia leve en el hombro derecho al press por encima de la cabeza",
    allergies: "Ninguna",
    foodPreferences: "Le gusta el pollo, el arroz y la avena; no le gusta el pescado azul",
    notes: "Prefiere respuestas cortas",
  });
  await value("set_training_preferences", { preferredEquipment: ["machine", "cable"], defaultUnit: "kg" });
  const machines: { id: string; muscle: string }[] = await value("list_exercises", { equipment: "machine" });
  const pick = (muscle: string, n: number) => machines.filter((e) => e.muscle === muscle).slice(0, n);
  const rx = (e: { id: string }, i: number) => ({ exerciseId: e.id, sets: 3, repMin: 8, repMax: 12, targetRir: 2, restSeconds: 90, notes: i === 0 ? "Controla la bajada, 3 s" : undefined });
  const upper = [...pick("chest", 2), ...pick("back", 2), ...pick("shoulders", 1), ...pick("biceps", 1), ...pick("triceps", 1)];
  const lower = [...pick("quads", 2), ...pick("hamstrings", 2), ...pick("glutes", 1), ...pick("calves", 1), ...pick("core", 1)];
  await value("create_program", {
    name: "Torso/Pierna 4 días",
    goal: "Recomposición: mantener fuerza en déficit",
    weeks: 8,
    notes: "Progresión doble; 10 min de caminata al final",
    days: [
      { name: "Torso A", focus: "Empuje", exercises: upper.map(rx) },
      { name: "Pierna A", focus: "Cuádriceps", exercises: lower.map(rx) },
      { name: "Torso B", focus: "Tirón", exercises: [...upper].reverse().map(rx) },
      { name: "Pierna B", focus: "Femoral", exercises: [...lower].reverse().map(rx) },
    ],
  });
  // Three weeks of sessions, so blocks, suggestions and history are full.
  const program = getActiveProgram()!;
  for (let s = 0; s < 12; s++) {
    const day = program.days[s % 4]!;
    await value("log_session", {
      name: day.name,
      startedAt: new Date(Date.now() - (24 - s * 2) * DAY).toISOString(),
      durationMinutes: 60,
      dayId: day.id,
      sets: day.exercises.flatMap((e) => [0, 1, 2].map(() => ({ exerciseId: e.exerciseId, weightKg: 40 + s, reps: 10 }))),
    });
  }
  await value("set_targets", { kcal: 2200, protein: 170, carbs: 220, fat: 70, fiber: 30 });
  const meals = (label: string) => ({
    label,
    meals: [
      { slot: "desayuno", items: [item("Avena", 80, 300, 10), item("Leche semidesnatada", 250, 115, 8, "ml"), item("Plátano", 120, 105, 1)] },
      { slot: "media_manana", items: [item("Yogur griego", 170, 150, 15), item("Nueces", 20, 130, 3)] },
      { slot: "comida", items: [item("Pechuga de pollo", 200, 330, 62), item("Arroz basmati", 90, 320, 7), item("Brócoli", 150, 50, 4)] },
      { slot: "merienda", items: [item("Tortitas de arroz", 30, 115, 2), item("Pavo", 60, 65, 13)] },
      { slot: "cena", items: [item("Merluza", 250, 210, 45), item("Patata", 250, 190, 5), item("Ensalada", 150, 40, 2)] },
    ],
  });
  await value("create_diet_plan", { name: "Definición 2200", startsOn: daysAgo(1), horizonDays: 14, days: [meals("Entreno"), meals("Descanso")] });
  await value("log_meal", { items: [{ ...item("Avena", 80, 300, 10), slot: "desayuno" }, { ...item("Leche", 250, 115, 8, "ml"), slot: "desayuno" }], at: "08:00", dish: "Avena con leche" });
  await value("log_water", { amount: 2, unit: "vaso" });
  for (const [name, dose, unit] of [["Levotiroxina", 75, "mcg"], ["Creatina", 5, "g"], ["Vitamina D", 2000, "UI"]] as const) {
    await value("add_medication", { name, dose, unit, kind: name === "Levotiroxina" ? "medicamento" : "suplemento", schedule: { times: ["08:00"] }, instructions: "En ayunas" });
  }
  for (let n = 1; n <= 7; n++) await value("log_sleep", { asleepTime: "23:30", wakeTime: "07:00", wakeDate: daysAgo(n - 1) });
  for (let n = 0; n < 5; n++) await value("add_body_scan", { date: daysAgo(n * 14), weight: 90 - n, skeletalMuscleMass: 38, bodyFatMass: 22 + n, percentBodyFat: 24 + n });
  await value("set_availability", { trainingTimes: ["18:00"], sessionMinutes: 60, restDays: [6, 7], wakeTime: "07:00", sleepTime: "23:30" });
  await value("add_busy_block", { title: "Viaje de trabajo", date: daysAgo(-3), allDay: true });
  await value("add_health_event", { kind: "lesion", title: "Molestia en el hombro", bodyArea: "shoulder", startDate: daysAgo(5) });
  await value("generate_shopping_list", { days: 7 });
}

test("every Coach tool's result fits the budget", async () => {
  await seed();
  const program = getActiveProgram()!;
  const day = program.days[0]!;
  const exercise = day.exercises[0]!;
  const meds = await value("list_medications");
  const medId = (meds.medications ?? meds)[0]?.id;
  const shoppingId = getShoppingList().items[0]!.id;
  const meals = await value("list_meals", { from: TODAY });
  const mealId = (meals.meals ?? meals)[0]?.id;

  const tomorrow = daysAgo(-1);
  const lunch = { kind: "items", name: "Bowl rápido", items: [item("Atún", 120, 140, 30), item("Arroz", 125, 160, 3)] };
  /**
   * Arguments per tool, a value or a thunk run just before the call; anything
   * missing is called with {}. Writes come last so the reads see the fixture as seeded.
   */
  const ARGS: Record<string, unknown> = {
    get_exercise: { exerciseId: exercise.exerciseId },
    find_similar_exercises: { exerciseId: exercise.exerciseId },
    exercise_history: { exerciseId: exercise.exerciseId },
    list_exercises: { muscle: "chest" },
    lookup_food_barcode: { barcode: "0000000000000" },
    estimate_portion: { product: { name: "Crema de cacahuate", per100g: { kcal: 600, protein: 25, carbs: 20, fat: 50 } }, amount: "una cucharada" },
    get_sleep_nights: { from: daysAgo(7), to: TODAY },
    body_projection: { metric: "weight" },
    consult_knowledge: { query: "proteína en déficit" },
    // The real turn: every day shorter, in one call.
    get_active_program: {},
    edit_program_days: () => ({
      scope: "always",
      days: getActiveProgram()!.days.map((d) => ({ dayId: d.id, exercises: d.exercises.slice(0, 5).map((e) => ({ id: e.id, exerciseId: e.exerciseId, sets: 2, repMin: 10, repMax: 12, restSeconds: 60 })) })),
    }),
    swap_program_exercise: { from: exercise.exerciseId, to: exercise.exerciseId, scope: "today", dayId: day.id },
    set_session_adjustment: { dayId: day.id, noChange: true, rationale: "Todo en orden." },
    set_exercise_unit: { exerciseId: exercise.exerciseId, unit: null },
    update_medication: { id: medId, stock: 30 },
    log_dose: { medicationId: medId, status: "tomada", scheduledTime: "08:00" },
    update_shopping_item: { id: shoppingId, checked: true },
    check_shopping_items: { ids: [shoppingId] },
    add_shopping_items: { items: [{ name: "Huevos" }] },
    set_sleep_target: { hours: 8 },
    spread_deviation: { kcal: 600, days: 3 },
    skip_slot: { slot: "merienda" },
    move_slot: { slot: "cena", toDate: daysAgo(-1) },
    swap_days: { a: daysAgo(-2), b: daysAgo(-3) },
    log_substance_use: { substance: "Alcohol", note: "2 cervezas" },
    log_water: { amount: 500, unit: "ml" },
    set_body_goal: { metric: "weight", target: 82 },
    set_water_goal: { goalMl: 2500 },
    remove_shopping_items: { ids: [shoppingId] },
    create_program: { name: "Torso/Pierna 4 días v2", goal: program.goal, weeks: 8, days: program.days.map((d) => ({ name: d.name, exercises: d.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: 3, repMin: 8, repMax: 12, restSeconds: 90 })) })), reason: "Más corta" },
    log_session: () => {
      const d = program.days[1]!;
      return { name: d.name, startedAt: new Date().toISOString(), durationMinutes: 50, sets: d.exercises.flatMap((e) => [1, 2, 3].map(() => ({ exerciseId: e.exerciseId, weightKg: 60, reps: 10 }))) };
    },
    set_targets: { kcal: 2100, protein: 170, carbs: 200, fat: 70 },
    log_meal: { items: [{ ...item("Manzana", 180, 95, 0), slot: "snack" }], at: "11:00" },
    save_dish: { name: "Batido", components: [item("Proteína whey", 30, 120, 24), item("Leche", 300, 140, 10, "ml")] },
    log_dish: { name: "Batido" },
    add_medication: { name: "Magnesio", dose: 300, unit: "mg", kind: "suplemento", schedule: { bedtime: true } },
    log_sleep: { asleepTime: "00:10", wakeTime: "06:40", wakeDate: daysAgo(9) },
    update_sleep_night: { night: daysAgo(1), note: "Me desperté a las 3" },
    add_busy_block: { title: "Cena de cumpleaños", date: tomorrow, start: "20:00", end: "23:00" },
    add_health_event: { kind: "enfermedad", title: "Resfriado", startDate: TODAY },
    create_recipe: { name: "Pollo al curry", servings: 4, prepMinutes: 40, batch: true, ingredients: [item("Pollo", 800, 1320, 248), item("Arroz", 300, 1050, 21), item("Leche de coco", 200, 360, 4, "ml")] },
    schedule_prep: async () => {
      const recipes = await value("list_recipes");
      return { recipeId: (recipes.recipes ?? recipes)[0].id, cookDate: tomorrow, portions: 4, assign: [{ date: daysAgo(-2), slot: "comida" }] };
    },
    ate_out: { slot: "cena", date: daysAgo(-2), name: "Hamburguesa con patatas", kcal: 1100, protein: 45 },
    replace_slot: { slot: "merienda", date: tomorrow, what: "Un bocadillo" },
    fill_slot: { slot: "comida", date: daysAgo(-4), fill: lunch },
    no_time_to_cook: { date: daysAgo(-5), slot: "cena", strategy: "quick", quick: lunch },
    ingredient_unavailable: { ingredient: "Merluza", substitute: { name: "Bacalao", ratio: 1, per100: { kcal: 80, protein: 18, carbs: 0, fat: 1 } } },
    rebalance_day: { date: tomorrow },
    adjust_day_plan: { date: tomorrow },
    set_meal_times: { mealTimes: [{ slot: "comida", time: "14:00" }] },
    create_substance: { name: "Kratom" },
    set_substance_goal: { substance: "Alcohol", maxDaysPerWeek: 2 },
    undo_plan_change: {},
    delete_sleep_night: () => ({ id: results.get("log_sleep").id }),
    delete_meal: { id: mealId },
  };
  const order = [...TOOLS.map((t) => t.name).filter((n) => !(n in ARGS)), ...Object.keys(ARGS)];
  const sizes: { name: string; chars: number; error: boolean }[] = [];
  const results = new Map<string, any>();
  for (const name of order) {
    let r: Result;
    try {
      const args = ARGS[name];
      r = await run(name, typeof args === "function" ? await args() : (args ?? {}));
    } catch (error) {
      r = { text: String(error), error: true };
    }
    sizes.push({ name, chars: r.text.length, error: r.error });
    if (!r.error) results.set(name, JSON.parse(r.text));
    if (process.env.PULSO_TOOL_DUMP?.split(",").includes(name)) console.log(`DUMP ${name}: ${r.text.slice(0, 2500)}`);
    if (r.error && process.env.PULSO_TOOL_SIZES && name in ARGS) console.log(`ERR ${name}: ${r.text.slice(0, 300)}`);
  }
  // The fixture must stay valid: a tool given arguments that fails is measuring its error, not its result.
  expect(sizes.filter((s) => s.error && s.name in ARGS).map((s) => `${s.name}: ${s.chars}`)).toEqual([]);
  if (process.env.PULSO_TOOL_SIZES) {
    for (const s of [...sizes].sort((a, b) => b.chars - a.chars)) console.log(`${String(s.chars).padStart(7)}  ${s.name}${s.error ? "  (error)" : ""}`);
  }
  const over = sizes.filter((s) => s.chars > BUDGET && !ALLOWED[s.name]).map((s) => `${s.name}: ${s.chars}`);
  expect(over).toEqual([]);
});
