# The living diet: plan → shopping → eaten

The person's complaint: the plan was per day, the shopping list per fortnight, and
anything that went differently pushed toward regenerating the whole diet. Now there
is one thread, and real life changes it in small, undoable steps.

```
diet_plans (rotation: days[] that cycle)          ← create_diet_plan, only on request
   │ materialized lazily, one date at a time
   ▼
plan_days + plan_slots (date × meal)  ◄── recipes / prep_batches fill slots
   │            ▲
   │            └── meal_slot_links ◄── meal_entries (logMeal with slotId / planItemId)
   ▼
shopping list = slots still to eat + batches still to cook
   └── tick / «Ya tengo»: marks on the list's own items
```

## The dated plan (`slots.ts`, `horizon.ts`)

- **Slot** = one meal on one date: `items` (the plan's item list), `recipe` (portions of
  a recipe cooked that day), `prep` (a portion of a batch cooked earlier) or `eat_out`
  (a kcal/macros budget). Every slot carries `items` so old readers work: recipe and
  prep slots hold one dish item in servings, eat-out holds its budget as one item.
- **Status**: `planned`, `skipped`, `replaced` are stored; `eaten` is derived from a
  `meal_slot_links` row with role `planned`. Slots also carry `real` (the entries tied
  to them, as one meal) and `missed` (pending 2 h past its time, or on a past day,
  with nothing logged: «sin registrar», never an automatic skip).
- **Materialization** (the migration): a date is laid out from the rotation the first
  time anything reads or changes it (`materialize`), copying the plan's item ids. A
  `plan_days` row marks it, so it is never refilled — a date whose meals all moved
  away stays empty. `planForDay` lays out today and later; past dates never laid out
  still read the rotation. Nothing is rewritten in bulk, so old plans need no step.
- **Horizon**: `plan_horizons.days` (default 14; `create_diet_plan` takes
  `horizonDays`). It is the default window for `get_diet_horizon`, ingredient swaps
  and the shopping list. It rolls: later dates are laid out when reached.
- **Old readers**: `planForDay(date).day` is the dated plan for that date (skipped and
  replaced meals left out) and `adjustment` stays the overlay it was, so iOS and the
  web keep drawing the same shape.

## Planeado → Real (`reconcile.ts`)

The plan is a suggestion; what was eaten is the truth. `logMeals` ties each meal
(entries logged together) to the day's slot it belongs to, so every path — Coach,
phone, web, barcode — gets it:

1. the `slotId` given; 2. the slot holding its plan item; 3. the meal it was logged as
(`comida` is lunch even at 16:00), unless trivial (< 50 kcal or drinks only); 4. the
meal whose **window** holds `eatenAt`. Windows come from the person's meal times
(calendar, else 08:00 / 11:00 / 14:00 / 17:30 / 20:30) and end 90 min before the next
meal (halfway when closer): breakfast at 8 and lunch at 14 → breakfast until 12:30.

- Under 250 kcal and not said to be a meal → an **extra**, except the first food of
  the day in the first meal's window (breakfast skipped, a Vualá at 11:11 is breakfast).
- A slot eaten as planned takes nothing more by inference; a skipped one only when the
  entry says it is that meal. Later entries in a replaced meal's window join it.
- Role: plan items (by id, or the same food name) → `planned`, else `replacement`;
  the slot is `replaced` while anything eaten instead is tied to it. `offPlan` on an
  entry is derived from that.
- Inferred ties and replacements are revisions (`op: log`; undo unties, the entry
  stays). Ticking the plan's own slot leaves none. Deleting or moving entries settles
  the slot they leave: nothing tied → back to pending.
- `meal_entry_pins` holds «eso fue un snack» (op `place` with `extra`): never tied
  again. A one-off backfill (`nutrition_repairs`) ties loose entries of the last 14
  laid-out days the first time a day is read.

## Adjustments and compensation (`adjust.ts`, `ops.ts`)

- The day's **goal** = targets (or the plan day's total) + `plan_days.shift_kcal`.
- **Same day**: `rebalance_day` (alias `adjust_day_plan`) scales the meals still ahead
  by one factor, 50–150 % per meal, and with `maxChangePct` (15 by default for the new
  tools) never more than that share of the goal in total — checked after portions are
  rounded. The result is the familiar `DayAdjustment` overlay on the slots' base items.
- **Spread**: `spread_deviation` shares a deviation over the next N days as kcal
  shifts, each day capped at 15 % of its goal; what doesn't fit is reported as
  unabsorbed, never forced. Each shifted day gets its rebalance overlay.
- **Who decides**: the Coach, by magnitude (persona): small slips absorbed or let go,
  big ones spread. `skip_slot` and `replace_slot` take `compensate: none|day|spread`.
- When a change rewrites slots under an existing overlay, the overlay is recomputed.

## Changes are revisions (`revisions.ts`, `ops.ts`)

Every op runs inside `revise()`: it snapshots the whole of each touched date (slots,
links, day row, adjustment) plus touched batches; runs;
records `plan_revisions` with the Spanish summary. **Undo** writes the snapshot back.
Default is the latest live change; an older one is refused while a later live change
touches the same dates or batches. Undo itself is not a revision (no redo).

| Op (tool) | Touches |
|---|---|
| `skip` (skip_slot) | the slot → skipped; optional compensation |
| `replace` (replace_slot) | the slot → replaced, links entries, deviation = eaten − planned |
| `ate_out` (ate_out) | logs an estimate (given, else planned × 1.3) as the slot's real meal; undo deletes it |
| `place` (place_meal) | moves entries to another slot, or pins them as extras |
| `rebalance` (rebalance_day / adjust_day_plan) | that day's overlay |
| `spread` (spread_deviation) | shifts + overlays of the next N days |
| `ingredient_unavailable` | without substitute: preview of the affected meals. With one: items in affected planned slots; recipes and uncooked batches get a *variant* recipe (`variant_of`) |
| `no_time_to_cook` | auto: a free batch portion cooked by then, else swap with the next same-slot meal that needs no cooking (≤15 min); `quick` takes a fill |
| `move` (move_slot) | moves, or swaps with a planned meal at the target |
| `swap_days` | swaps the planned meals and labels of two dates |
| `fill` (fill_slot) | sets a slot's fill, or adds a slot |
| `schedule_prep`, `prep_cooked`, `use_leftover` | batch + the slots holding its portions |

Every op returns `PlanChange`: summary, revision, the touched dates' slots,
compensation, and `shoppingRefreshed`.

## Recipes and batches (`recipes.ts`)

Ingredients are for the whole pot (`quantity` + a `MeasureUnit`, total macros);
`perServing` is derived. A **batch** is a recipe cooked on `cookDate` yielding
`portions`; slots of kind `prep` hold its portions. `leftover` = portions − portions in
slots still planned or eaten (skipping or replacing one frees it). Cooking marks it
`cooked`; its ingredients leave the list.
`suggest_prep_days` (`prepdays.ts`) ranks the coming days by free minutes between
16:00 and an hour before bed (calendar busy blocks and planned training), so the Coach
can propose cooking days; it never schedules them itself.

## Shopping (`../shopping`)

- **Needs** (`planLines`): items of slots still `planned` in the range, ingredients of
  `recipe` slots, whole batches still to cook whose `cookDate` is in the range. Eaten,
  skipped and replaced meals and batch portions need nothing.
- **List** = needs, rounded to buyable amounts. Bought (`checked`) and «Ya tengo»
  (`pantry`) are marks on the list's own items; what is left to buy is what has neither.
  Regenerating the **same** start date keeps ids, aisles, manual items and marks. A
  **new start date** is a new trip: plan items' marks reset.
- **No pantry.** Pulso doesn't track what is at home: the person shares food with
  someone else, so it could never stay accurate. The `pantry_items` table (from when it
  did) stays in the schema so no data is lost, but nothing reads or writes it — not
  logging, ticks, cooking or undo. Old revisions' pantry snapshots are ignored.
- Every plan op rebuilds the list for its range when one exists for the active plan.

## API (both surfaces; phone needs the bearer, web is cookie-gated by scope)

`/api/mobile/nutrition/…` and `/api/web/dieta/…`:

| Route | |
|---|---|
| `GET horizon?from&days` | `{ horizon: DietHorizon \| null }` |
| `POST plan/ops` | `{ op, ...fields }` → `PlanChange` (or the ingredient preview) |
| `GET plan/revisions?limit` | `{ revisions: PlanRevision[] }` |
| `POST plan/revisions/undo` | `{ id? }` → `PlanChange` |
| `GET/POST recipes`, `GET recipes/[id]` | `{ recipes }`, `{ recipe }` |
| `GET preps` | `{ preps: PrepBatch[] }` |
| `GET prep-days?from&days` | ranked days, tight meals, batch recipes |

Errors: 400 `invalid_request`, 404 `not_found`, 409 `no_plan` / `plan_conflict`
(Spanish `message`, engine reason in `detail`) / `cannot_undo`. Existing routes
(`plan`, `plan/eat`, `plan/adjustment`, `shopping/*`, `dieta/compras/*`) are unchanged.

## Deferred

- Dates laid out after an ingredient swap (beyond its range) come from the rotation
  again — salmon may be back next week; the Coach can swap again.
- No redo; undo is per revision, newest first when they overlap.
