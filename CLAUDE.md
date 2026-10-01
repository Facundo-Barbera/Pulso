# Pulso — working rules

Pulso is a personal, agentic health app: diet, training, body composition. iOS is the main surface. The Mac runs the engine and holds all the data. README.md has the architecture.

## Layout and ownership
- `apps/engine` — Next.js under Bun, `bun:sqlite`. Feature code lives in `src/<feature>/` (store, tools, tests). API routes for the phone go under `app/api/mobile/<feature>/` and must check the bearer with `deviceOf()` from `app/api/mobile/auth.ts`.
- **Schema:** each feature keeps its SQL in `src/<feature>/schema.ts` (idempotent, `IF NOT EXISTS`) and adds one line to `src/schemas.ts`.
- **Agent tools:** each feature defines its tools with the Agent SDK's `tool()` + zod in `src/<feature>/tools.ts` and adds one spread to `src/agent/registry.ts`. Write tool descriptions for the model: what the tool does, units, when to use it.
- `packages/contract` — shared TS types. Add `packages/contract/<feature>.ts` and one `export * from "./<feature>"` line in `index.ts`.
- `apps/ios` — SwiftUI, iOS 18+, `@Observable`. Each feature owns `Pulso/Features/<Feature>/` (views, its own `@Observable` store, and an `extension PulsoAPI` for its routes). Shared look: `Pulso/Design/Theme.swift` (`Card`, `CardTitle`, `Theme` colors). `PulsoModel.shared.api` is the authenticated client; pass errors to `PulsoModel.shared.handle(_:)`.
- `Pulso.xcodeproj` is generated from `project.yml` and not committed. Edit `project.yml` only for entitlements, Info keys or new targets.
- The UI is in Spanish (the person's language); code and comments are in English.

## iOS design bar
The person judges the app by how it looks and feels on their iPhone (iOS 27). Target iOS 26+, so no availability checks needed.
- Native first: Liquid Glass (`.glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass/.glassProminent)`), large titles, `ScrollView` + cards over plain `List` for dashboards, SF Symbols with `.symbolEffect`, `.contentTransition(.numericText())` for changing numbers, `.sensoryFeedback` haptics, smooth `.animation(.snappy)`/matched transitions.
- Hierarchy: one hero per screen (big ring, number or chart), then supporting cards. Rounded type (`.fontDesign(.rounded)`) for numbers. Generous spacing; nothing cramped.
- Color: `Theme` domain colors and the accent only; dark mode first, must look right in light too. Gradients subtle.
- Empty states are designed (illustration-ish SF Symbol, one line, one action), never a bare "Todavía nada".
- Spanish everywhere the person reads, dates via `.formatted()` (the app's base language is Spanish).
- Charts: Swift Charts with soft area gradients, no gridline clutter, selected-point readouts.

## Checks before committing
- `bun run test` and `bun run typecheck` from the repo root.
- `apps/ios/check.sh` — compiles the app and tests (there is no simulator runtime on this Mac).
- To hit the engine over HTTP in a worktree, run `cd apps/engine && PULSO_DATA_DIR=$(mktemp -d) bun --bun next dev --hostname 127.0.0.1 --port <your port>`. Never use 3230 (the person's live engine) or the real `data/`.

## Don'ts
- Do not install on the iPhone, push, or open PRs: the coordinator integrates and installs.
- Do not touch `.env*`, lockfiles by hand, or another feature's folder beyond the one-line registry hooks above.
- Commits: conventional prefixes (feat:, fix:, chore:, refactor:, test:, docs:), small and atomic, explaining why.
