# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`zentrixCalendarHeatmap` is a Power BI custom visual (pbiviz project, TypeScript + D3): a full-year GitHub-style calendar heatmap with tooltips, cross-filtering, small multiples, anomaly markers, and an insight engine.

> **`../CLAUDE.md` is the canonical doc** and supersedes this one — it covers everything here plus the surrounding product folder. This file is kept only for instances opened directly in `code/`; prefer editing the parent.

This directory is only the `code/` leaf of a larger single-source-of-truth folder. `../` holds `research/`, `docs/`, `roadmap/`, `assets/`, `content/` for this visual. It sits under `platform/visuals/zentrix-calendar-heatmap/`, alongside `zentrix-bar-chart` and `zentrix-bullet-chart`; the git root is the **platform monorepo** (`platform/`), which also holds the `@zentrix/*` design-system packages. Cross-visual rules live in `company/playbooks/shared-component-parity-checklist.md` — a hard pre-publish ship-gate.

## Fixing a bug — the ledger protocol (read this first)

`docs/CHANGE-LEDGER.md` is the append-only record of every defect found and fixed here. It
exists to prevent the loop *fix A → breaks B → fix B → reintroduces A*.

**Before you fix anything:** grep the ledger for the file or function you are about to
touch. If an entry pins behaviour there, that behaviour is now **part of the contract** —
your change must keep its test green.

**After you fix anything:** append an entry (template + fields are in the ledger's own
header). Every entry must name a **regression test that fails if the defect returns** — the
test is the safety net, the doc is only the index to it. An entry with no test is marked
`UNPINNED` so the next person knows the fix is on the honour system.

Record `BY DESIGN` findings too — behaviour that *looks* wrong but is intended is exactly
what the next person "fixes" into a regression.

The audit method that populated the `CB-*` entries is worth reusing: mount the real
`Visual` under jsdom, drive it through the **actual gear engine** (`applyLocal` →
`rerenderFromSettings`), and assert on what lands in the SVG — not on the settings model,
and not by reading the code. See `test/render/dayBadges.test.ts`.

## Hard rules (CEO-set)

- **`pbiviz.json` is READ-ONLY for Claude.** Never edit or write it by any means — not
  with Edit/Write, and not via shell (`sed`, `python`, redirection). Enforced by deny
  rules in `.claude/settings.json`; ask the user to make any change it needs.
- **The visual version stays `1.0.0.0`** until the CEO explicitly asks for a bump.
  The three-place bump rule below still applies *when* a bump is requested — but do not
  bump proactively, and remember the version inside `pbiviz.json` is the user's to change.

## Commands

```bash
npm start                  # pbiviz start — dev server for Desktop/Service side-load
npm run package            # pbiviz package — build the .pbiviz for AppSource
npx tsc --noEmit           # typecheck (no npm script for this)
npm run lint               # eslint . (includes the powerbi-visuals cert rules)

npm test                   # full jest suite (~20s, incl. the settings sweep)
npm run test:sweep         # just the ~250-case generated settings sweep
npm run test:update        # re-baseline sweep snapshots after an intended change
npx jest test/render/grid.test.ts        # a single test file
npx jest -t "some test name"             # a single test by name

npm run sync-tokens        # regenerate src/theme/zentrixTokens.ts from @zentrix/tokens
npm run sync-tokens:check  # fail if the token snapshot is stale
npm run harness            # esbuild the dev preview/hero/landing playgrounds
npm run bundle:vizhub      # bundle the real Visual for the vizHUB playground
```

There is no watch-mode test script and no CI config in this project.

## Architecture

### The update loop

`src/visual.ts` is the only orchestrator. `update(options)` (`visual.ts:167`) runs: hydrate formatting model → reset SVG groups → role gate → `buildFacetedModel` → `render()` → `renderingFinished`. The whole body is try/caught so a throw still fires `renderingFailed` and paints a fallback message.

Two things make this loop unusual and are load-bearing:

- **`lastRender` + `rerenderFromSettings()`** (`visual.ts:250`). The in-visual settings bar mutates the live formatting model *optimistically* and calls back to repaint from cached inputs. It does not wait for the async `persistProperties → host → update()` round-trip, which is unreliable for freshly-edited objects. Any new setting must be wired into this path or edits won't show until a host round-trip.
- **The landing page is mounted in the constructor**, not in `update()` (`visual.ts:157`). Power BI does not call `update()` until a data role is bound, so a landing page shown only from `update()` never appears on a fresh visual.

SVG layer order is fixed at construction (`visual.ts:134`): `defs → content → badges → selected-rings → today-ring → hover-ring → focus-ring`. Overlay drawers in the upper groups stay pixel-aligned with cells by reading the `px/py/ps` that the grid drawer stamps onto each `DayCell`.

### Layers

| Layer | Owns | Power BI dep? |
|---|---|---|
| `src/model/` | `DataView` → `CalendarModel` / `FacetedRender` | `dataTransform` yes, `dateGrid` no |
| `src/render/` | Pure D3 drawers + pure size predictors | no |
| `src/insights/` | `DailySeries` → ranked `Insight[]` | no |
| `src/notes/` | Author-written annotations: store + the calendar's anchor key | no |
| `src/interaction/` | Tooltip, panel, keyboard, selection, settings bar, note editor, license, landing | yes |
| `src/theme/`, `src/branding/` | Token snapshot; removable brand layer | no |

### Annotations (Z-152)

There is **no annotation data role** — annotations are author-written (click a day → the
detail panel's "＋ Add note"). The rules are non-negotiable and are documented in the
golden source, `platform/packages/visual-annotations/README.md`; the parent
[`../CLAUDE.md`](../CLAUDE.md) summarizes the four traps (store must not be a Card or
Reset destroys it; anchor by ISO date not `selectionId`; offsets in cell-size units;
never `innerHTML`). `src/notes/core.ts` + `src/interaction/noteEditor.ts` are **mirrors**
of that package — do not hand-edit.

`src/types.ts` holds the domain contract everything else agrees on: `DayCell`, `CalendarModel`, `Facet`, `FacetedRender`, `EmptyReason`.

Render modules are **plain functions, not classes** — `(group: GroupSel, model, opts) => RenderResult`. There is no shared RenderContext. Each of the three mutually-exclusive grid drawers (`renderGrid`, `renderMonthBlocks`, `renderFacets`) returns `{ geo, cells }` and has a paired **pure size predictor** (`predictGridSize`, etc.). `planChrome` (`render/responsive.ts`) calls those predictors *before touching the DOM* and sheds chrome bands (insight lines → legend → header chips) until cell size clears a floor. If you add a chrome band, it must be added to both the predictor and the shed order or the layout will overflow.

`src/insights/` is a deterministic pure engine with zero rendering deps. It is **premium-gated**: `insightsOn = show && combined.series && premium.active` (`visual.ts:322`). `PremiumGate` (`interaction/license.ts`) is deliberately **fail-open** — unsupported host, no configured Partner Center plan, or any API error all resolve to ACTIVE. Flip `LOCK_ON_NO_PLAN` only once a paid plan is provisioned and verified in Service.

`render()` in `visual.ts` (~340 lines, `:259-597`) is a known god-method with hard-coded band heights. The modules under it are clean; the composition layer is not.

## Settings: the three-layer contract

This is the highest-risk area to change. Three layers must agree:

1. **`capabilities.json` `objects`** — the Power BI persistence contract. Object + property names are the identifiers.
2. **`src/settings.ts`** — the typed formatting model (`Card` subclasses whose slice `name` must equal the capabilities property name). Defaults live here.
3. **`src/interaction/settingsSchema.ts`** — the *only* per-visual glue for the in-visual gear. A `KEYS` registry maps an engine-key string to `{get, set, setLocal}`, plus a declarative `SB_CATS` category tree.

### The Format-pane rule (enforced in code)

The floating in-visual gear is the primary settings surface. The native Format pane is force-reduced to three cards in the model constructor (`settings.ts:534`):

```ts
const PANE_CARDS = new Set(["toolbar", "accessibility", "branding"]);
```

Toolbar (controls the gear), Accessibility (host-level a11y, expected natively for compliance), and Zentrix branding. **Everything else is gear-only.** Adding a card to the Format pane means adding it to `PANE_CARDS` deliberately, not by accident.

### Adding a setting — required order

1. `capabilities.json` — add the property under its object. Persistence fails silently otherwise.
2. `src/settings.ts` — add the slice to the matching `Card` (name must match). New card → append to the `cards` array; decide `PANE_CARDS` membership.
3. `src/interaction/settingsSchema.ts` — register the engine key in `KEYS` *and* add the field to `SB_CATS`. Wire `setLocal`, or the edit won't render until the host round-trip. Mirror any native `onPreProcess` gating as `visibleIf`.
4. Tests — add to `ROUND_TRIPS` in `test/interaction/settingsSchemaParity.test.ts`; add `CARD_RULES`/`SLICE_RULES` in `test/harness/sweep.ts` if the setting is gated or effect-less on rerender; `npm run test:update`.

## Vendored / generated files — do not hand-edit

- **`src/interaction/zentrixSettingsBar.ts`** — carries `// MIRROR OF @zentrix/visual-settings`. Generic schema-driven bar engine, shared across all Zentrix visuals. Change the golden source in the `zentrix/packages/` monorepo and re-mirror; never style-edit the copy. It has drifted before (Z-151 re-promoted this visual's drifted copy back into the golden source).
- **`src/theme/zentrixTokens.ts`** — generated by `scripts/sync-tokens.mjs` from `@zentrix/tokens`. Never hand-edit hex values.

Three known traps here:

- `zentrixSettingsBar.ts` claims it is "Verified by `sync-shared.mjs --check`" — **that script does not exist in this visual** (only `zentrix-bar-chart` and `zentrix-bullet-chart` have it). The mirror guarantee is documentary here, not an active gate. Drift will not be caught.
- `sync-tokens.mjs --check` **exits 0 with a warning** when `@zentrix/tokens` isn't linked via the pnpm workspace — which is the case in this checkout (`node_modules/@zentrix` is absent). A "clean" check does not mean the snapshot is fresh.
- The version string lives in **three** places that must be bumped together: `src/version.ts`, `pbiviz.json` (both `visual.version` and top-level `version`), and `package.json`.

## Testing

`test/harness/` runs the **real `Visual`** under jsdom with a mock host and synthetic `DataView` — no browser, no Power BI account. This works only because the render path computes layout mathematically and never calls `getBBox` (only the tooltip and gear overlay do). If you introduce text measurement into the render path, the sweep breaks and must move to Playwright.

The **settings sweep** (`test/settingsSweep.test.ts` + `test/harness/sweep.ts`) enumerates every slice in the formatting model, generates a candidate per non-default value, and for each asserts: no throw / no `renderingFailed`, cells still render, **the SVG actually changed** (the setting took effect), and a structural fingerprint snapshot. Settings whose effect the sweep can't simulate are marked smoke-only in `CARD_RULES`/`SLICE_RULES` — the only per-visual config in an otherwise visual-agnostic harness.

The **parity test** (`test/interaction/settingsSchemaParity.test.ts`) catches "I added a native prop but forgot the gear binding." It must stay non-tautological: deleting one binding should fail it.

## Lint

`eslint.config.mjs` does two non-obvious things:

- The `powerbi-visuals` cert-plugin rules are **scoped off** for `harness/**` and `test/**` (dev-only code, never bundled into the `.pbiviz`). Don't patch cert-rule violations there pointwise — the scoping is deliberate.
- A **hex-literal ban** (`no-restricted-syntax`) forces token imports, but is applied to an explicitly **narrow file list**, not all of `src/render/**`. The color-ramp files (`render/colors.ts`, `render/ramps.ts`) are intentionally excluded pending a deferred RdBu→canonical ramp reconciliation. Widen the glob only when that work is scoped.

Note `src/render/ramps.ts` and `src/render/colors.ts` export overlapping palette constants and near-identical `resolvePalette`/`rampForPreset`. The render path uses `colors.ts`; only `interaction/landingPage.ts` imports `ramps.ts`. A palette change must be made in both or the landing page will drift from the grid.
