# Autonomous visual-side testing

The problem: a Power BI custom visual has ~80 settings. Manually flipping each in
`pbiviz start` to confirm it (a) takes effect and (b) doesn't break anything else
doesn't scale across many visuals. This harness does it automatically, with **no
browser and no Power BI account** — it runs under `npm test`.

## How it works

The visual is friendly to this because of two facts:

1. Every setting lives in one enumerable `VisualFormattingSettingsModel`
   (cards → slices).
2. The **render path computes its layout mathematically** — it never calls
   `getBBox`/text-measurement (only the hover tooltip + gear overlay do). So the
   real render runs correctly under **jsdom**, no real browser needed.

So the sweep:

1. Mounts the **real `Visual`** with a mock host (`mockHost.ts`) + a synthetic
   `DataView` (`mockDataView.ts`).
2. Enumerates every slice and generates a candidate per non-default value
   (`sweep.ts`) — every dropdown item, both toggle states, a few numbers, a
   contrasting color, a sample string.
3. For each candidate (`settingsSweep.test.ts`): applies it the same way the
   in-visual gear does (mutate model → `rerenderFromSettings`) and asserts:
   - **no throw / no `renderingFailed`** — the setting doesn't crash the visual
   - **cells still render** — it doesn't silently blank the canvas
   - **the SVG actually changed** — the setting *took effect* (non-smoke ones)
   - **structural fingerprint snapshot** — regression net: catches "changing X
     broke unrelated Y". Run `npm run test:update` to accept intended changes.

```
npm run test:sweep      # just the sweep
npm test                # whole suite incl. sweep (~20s, 250+ generated cases)
npm run test:update     # re-baseline snapshots after an intentional change
```

## What it does NOT cover (by design)

This is the autonomous *logic/render* net. It does not catch pixel-level look
("is it ugly / overlapping"), and a few settings are marked **smoke-only** (run,
don't crash, but no effect-assert) because their effect needs context the sweep
doesn't simulate:

- `dataDisplay.firstDayOfWeek` / `aggregation` — consumed when the model is
  *built*, not on rerender. Covered separately by the data-layer test
  (`describe("data-level settings")`) which rebuilds with `buildFacetedModel`.
- `smallMultiples.*`, `facetTitle.*` — need a Split-by dataset (separate test).
- `yearTags.*` — needs multi-year data (separate test).
- `toolbar.*`, `presentation.*`, `branding.*`, `tooltip.*`, `accessibility.focusRing`
  — affect the overlay/tooltip/runtime, not the heatmap SVG.

The smoke/prereq knowledge lives in `CARD_RULES` / `SLICE_RULES` in `sweep.ts` —
the only per-visual config. Everything else is generic.

## Reusing on the next visual

`sweep.ts`, `mockHost.ts`, and `svgPolyfill.ts` are visual-agnostic. To port:

1. Copy `test/harness/` over.
2. Point `sweep.ts` at the new `VisualFormattingSettingsModel`.
3. Write a `mockDataView.ts` for the new visual's data roles.
4. Adjust `CARD_RULES`/`SLICE_RULES` for that visual's gated settings.

## Optional next layers (not built here)

- **Pixel/visual regression** — drive an esbuild bundle in headless Chromium with
  **Playwright** (`toHaveScreenshot`), sweeping the same candidates and diffing
  PNGs. Catches visual breakage jsdom can't see. Free, runs in CI (GitHub
  Actions). This is the standard Power BI community approach for "broken visual"
  detection (see John Kerski's `pbi-dataops-visual-error-testing`).
- **AI sanity check** — feed the Playwright screenshots to a vision model to flag
  "this looks empty/overlapping/broken." Useful but non-deterministic; keep it as
  an advisory signal, not a gate.

### Why not Microsoft's official test stack?

Microsoft's docs recommend `powerbi-visuals-utils-testutils` + **Karma + Chrome**
(a real browser) specifically because **jsdom can't lay out SVG** (`getBBox`
returns nothing). That's true in general — but this visual's render path doesn't
depend on `getBBox`, so we get real-render fidelity under jsdom without the weight
of a browser test runner. If a future visual measures text in its render path,
move the sweep to the Playwright layer above.
