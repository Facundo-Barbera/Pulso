# The web app

The engine serves Pulso's desktop app: the Electron window on the Mac (loopback, full trust) and any browser on the tailnet that has been paired. Same Next App Router app for both. Spanish UI, dark-first, Telar's look.

## Layout

```
app/
  layout.tsx              root: fonts, globals.css, the pre-paint appearance script
  globals.css             Telar's tokens copied verbatim, then Pulso's layer at the end
  _ui/                    shared components (below) — not routed
  (app)/                  everything inside the shell (sidebar / tab bar)
    layout.tsx            the Shell; reads the sidebar cookie and who is asking
    loading.tsx           skeleton shown while a section's server data loads
    page.tsx              Hoy  (/)
    _hoy/                 Hoy's own components
    coach/                the Coach chat (below)
    entreno/ dieta/ calendario/ cuerpo/ sueno/ medicacion/
    ajustes/              pairing, devices, appearance
      _components/
  pair/route.ts           the no-JS pair form for unpaired browsers
  api/web/                the web app's API (cookie auth, see Security)
    admin/                Mac-only: pair codes, device list, revoke
    me/                   who is asking; DELETE forgets this browser
    hoy/                  TodayOverview as JSON
    coach/                threads, turns (NDJSON), stop, briefs: the phone's runner, cookie-authed
src/web/                  view assemblers: one function per page that reads the feature stores
```

## Adding or filling in a section

1. **Page:** replace `app/(app)/<section>/page.tsx`. A server component, `export const dynamic = "force-dynamic"` and `export const metadata = { title: "<Sección>" }`. Wrap in `<Page>` and start with `<PageHeader>`.
2. **Section components:** `app/(app)/<section>/_components/*.tsx` (the `_` keeps them out of routing). Client components only where there is interaction; everything else renders on the server.
3. **Data:** read the feature stores directly from the server component — `src/<feature>/store.ts` — or, when a page needs several, add an assembler in `src/web/<section>.ts` that returns one typed object (see `src/web/today.ts`) and test it. **Never call `/api/mobile/*` from the web.**
4. **Writes / client refresh:** add routes under `app/api/web/<section>/…`. Reads need the `view` scope and writes `edit`; the gate applies that by path, so there is nothing to register. Return JSON with `json()` from `app/api/web/http.ts`. Anything the Mac alone may do goes under `app/api/web/admin/` and also calls `loopbackOnly(request)`.
5. **Navigation:** sections are listed once in `app/_ui/sections.ts` (sidebar order = ⌘1…⌘9, so nine at most; `tab: true` puts it in the phone's bottom bar, the rest go under «Más»).

## Shared components (`app/_ui/`)

| Component | Use |
|---|---|
| `Page`, `PageHeader` (`page-header.tsx`) | The page column (max width, gutters, room for the tab bar) and its header: eyebrow, large title, one supporting line, actions. Handles the Mac titlebar band and the phone's safe area. |
| `Card`, `CardTitle` (`card.tsx`) | The raised surface everything sits on (`shadow-1`, 18px radius, a gentle entrance; `delay` staggers it). `CardTitle` = tinted icon + title + optional «Ver ›» link. |
| `StatTile` | One number: label, value (tabular), unit, caption; `children` for a chart under it. |
| `Ring` | The hero ring, 0–100, sweeps in once. `children` in the middle. |
| `Sparkline` | Line (soft area) or bars, no axes, hover/touch readout, gaps for nulls, optional dashed `target`. Client component: pass preformatted `label`s, `unit`, `decimals` (no functions). |
| `EmptyState` | Designed empty: tinted symbol, title, one line, one action. `compact` inside cards. Never a bare «Todavía nada». |
| `Skeleton` | Shimmering placeholder (still for reduced motion). Size it like the content so nothing shifts. |
| `Sheet` (`sheet.tsx`) | The editing modal: a native `<dialog>`, title, scrolling body. Its body mounts only while open, so drafts start fresh. |
| `fields.tsx` | Form pieces for editors: `inputClass`, `Field`, `FieldGroup`, `Segmented`, `WeekdayPicker`, `Toggle`, `Button`. A client module: don't import its constants into server components. |
| `send` (`send.ts`) | A JSON write to `/api/web/*` from a client component; throws the engine's message. Follow it with `router.refresh()`. |
| `Markdown` | Safe renderer for Coach text: headings, nested lists, tables, quotes, code, links (http/mailto only, open outside). Parsing is `markdown-parse.ts` (plain data, tested); `plainText` for previews. |
| `ComingSoon` | The placeholder a section shows until it is built. |
| `PulsoMark` | The app icon as a mark. |
| `format.ts` | Spanish `Intl` helpers: `fmtLongDate`, `fmtShortDate`, `fmtDayLabel`, `fmtTime`, `fmtMinutes`, `fmtAgo`, `fmtNumber`, `greeting`. Format on the server so the browser's timezone never changes the render. |
| `cn` | Class joiner. |

## Look

- **Tokens:** use Telar's semantic utilities — `bg-card`, `bg-muted`, `text-muted-foreground`, `bg-primary`, `text-success/warning/destructive`, `shadow-1/2/3`, `border-border`. Do not edit the copied block in `globals.css`; override after it.
- **Domain colours** (same as iOS `Theme.swift`): `var(--domain-training|body|energy|protein|carbs|fat|sleep|medication|heart)`, also as utilities (`text-training`, `bg-sleep/15`…). Never for state.
- **Brand gradient** `var(--pulso-gradient)`: the mark and one hero glow. Sparingly.
- **Hierarchy:** one hero per page, then a responsive card grid — `grid gap-5 md:grid-cols-2 xl:grid-cols-3`.
- Numbers: `tabular` class. Motion: `motion-safe:` only. Touch targets ≥ 44px on the phone (`min-h-11`). Focus: `focus-visible:ring-2 focus-visible:ring-ring`.
- **Appearance** (`_ui/appearance.ts`): theme, accent (default rose), depth, typeface and Mac-window translucency, per browser in localStorage, applied pre-paint.
- **Mac window:** `data-telar-shell="macos"` is set inside Electron. The sidebar is an `app-ground` (vibrancy shows through when translucent); content stays opaque. Interactive things in the top 48px band need `app-no-drag`.
- **Keyboard:** ⌘1–⌘9 sections, ⌘K command palette (add actions in `command-palette.tsx`), ⌘\ folds the sidebar.

## The Coach

`coach/layout.tsx` keeps the thread list mounted beside the chat (on the phone, `/coach` is the list and a chat is its own page). `/coach/nuevo` is a new chat (`?q=` sends a prompt, `?responder=<brief id>` answers a brief); `/coach/<id>` a thread. The client state lives outside React in `_components/chat-store.ts`, one live chat per thread like iOS's `ChatStore`: a reply keeps streaming while the person moves around, and a reload re-attaches to the turn in flight (`GET …/turn`). Turns run in `src/agent/runner.ts`, the same as the phone's; stop is `DELETE …/turn`.

## Security

- **Loopback** (no `x-pulso-via` header): the Electron window and this Mac. Full trust.
- **Tailnet** (`bun run tailnet` stamps `x-pulso-via: tailnet` and passes the browser's Host as `x-pulso-host`): `proxy.ts` → `src/tailnet-gate.ts`. Public: `/pair`, `POST /api/mobile/pair`. Phone: `/api/mobile/*` (bearer checked per route, `mobile` scope). Paired browser (HttpOnly `SameSite=Lax` cookie `pulso_device`): pages, `/_next/*` and `/api/web/*` by scope. Admin (`/api/web/admin/*`, any other `/api`): 403.
- Writes carrying the cookie must have `Origin: http://<x-pulso-host>`. A revoked cookie is cleared on its next request.
- Pairing: Ajustes › Emparejar › Navegador mints an 8-digit code (5 min, one use, only for that kind; five wrong guesses burn it). The browser opens `http://<tailscale-ip>:8090`, gets the pair form, types the code and a name.
