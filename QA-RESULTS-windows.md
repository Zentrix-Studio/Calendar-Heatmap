# Windows Desktop QA — Results

Machine: Windows 11 Home · Node v24.12.0 · Power BI Desktop 2.154.1260.0 (Store) · **system locale `en-IN`**
Date: 2026-06-04

---

## Summary

Setup completed and the build re-verified on Windows. Re-verification surfaced **one real defect**
(locale-dependent date/number formatting) that broke 54 unit tests on a non-`en-US` machine. It has
been **fixed in source** and the suite is green again. Hands-on Power BI **Desktop** QA (the manual
areas) is still pending — it needs a human driving Desktop.

---

## A. Build re-verification (Windows)

| Check | Mac (claimed) | Windows (initial) | Windows (after fix) |
|---|---|---|---|
| `tsc --noEmit` | clean | **clean** | clean |
| ESLint | clean | **clean** | clean |
| Jest | 408/408 | **354/408 — 54 FAIL** | **408/408** |
| `pbiviz package` | builds | builds | builds |

`npm install` clean (880 pkgs; 4 moderate advisories, not addressed — out of scope for QA).

---

## B. Defect found + fixed

### BUG-W01 — Dates/numbers formatted with the machine locale, not the report locale  ✅ FIXED

- **Area:** Format / rendering (KPI header peak-day chip, tooltip date + numbers, ARIA labels).
- **What I did:** Ran `npm test` on a Windows machine whose system locale is `en-IN`.
- **Expected:** Date text renders identically regardless of the dev machine; in production it should
  follow the **report's** locale.
- **Actual:** 54 snapshot tests failed. The peak-day chip rendered `396 | 6 Jan 2025` (en-IN, day-first)
  where the committed snapshot expected `396 | Jan 6, 2025` (en-US, month-first). Root cause: three call
  sites formatted dates via `toLocaleDateString(undefined, …)` — `undefined` = the *host machine's*
  locale — so output (and the "408/408 green" claim) depended on the machine the tests ran on. A Power
  BI visual should honor the report culture the host provides, not the dev box.
  - `src/render/header.ts` (peak-day chip)
  - `src/interaction/tooltip.ts` (date label + `toLocaleString` numbers)
  - `src/interaction/keyboard.ts` (ARIA date label)
- **Fix:** Thread the host-provided locale (`host.locale`, BCP-47) from `Visual.render()` into all three
  formatters, with a deterministic `"en-US"` fallback when absent (tests/dev). Production now follows the
  report's culture; tests are deterministic on any machine (the mock host already returns `en-US`, so
  snapshots are unchanged and pass everywhere).
- **Verification:** `tsc` clean · ESLint clean · **Jest 408/408 green on `en-IN`** with **no snapshot
  changes**. Files: [visual.ts](src/visual.ts), [header.ts](src/render/header.ts),
  [tooltip.ts](src/interaction/tooltip.ts), [keyboard.ts](src/interaction/keyboard.ts).
- **Note for the Mac team:** consider also pinning a locale in the Jest config (e.g. `TZ`/ICU default)
  as a belt-and-suspenders guard, and declaring the `Localizations` feature for certification.

### BUG-W02 — Tooltip day-over-day delta rendered as a raw unformatted number  ✅ FIXED

- **Area:** Tooltip (day-over-day delta line).
- **File:** `src/interaction/tooltip.ts` (the `"+N vs <weekday>"` line).
- **Expected:** The absolute delta is formatted like every other number in the tooltip (`formatNum`).
- **Actual:** It interpolated the raw JS number. Under Average aggregation (or fractional source
  values) this leaks floating-point artifacts, e.g. `+0.30000000000000004 vs Mon`, straight into the DOM.
- **Trigger:** Aggregation = Average (or non-integer values) with a defined previous day.
- **Fix:** Route the delta through the existing `formatNum(diff, this.locale)` helper (2-dp, locale-aware).
- **Verification:** tsc/ESLint clean · Jest 408/408 green. Found via a full visual-side code review.

### BUG-W03 — KPI header didn't adapt to font settings (clipping + overflow)  ✅ FIXED

- **Area:** KPI header (`src/render/header.ts`, `src/visual.ts`).
- **Found by:** the real-browser **settings sweep** (section D) — flipping every setting and checking it
  renders correctly. 4 candidates failed:
  - `headline.fontSize → 30` and `statChips.fontSize → 28` → text **clipped above the top edge**.
  - `statChips.fontFamily → Verdana` / `Cascadia Code` → chip text **overflowed the right edge**.
- **Root cause:** the header band was a hardcoded `42px` with fixed text baselines, and chip width was
  estimated at a fixed `7px × charCount` — blind to the configured font size/family. Large or wide fonts
  therefore clipped vertically and overflowed horizontally.
- **Fix:** band height + baselines now derive from the configured headline/stat fonts (`headerBandHeight`,
  threaded into `visual.ts` so the layout reserves the right space), and chip width is **measured**
  (`getComputedTextLength`, with a font-size-aware fallback). Defaults (headline 15 / stat 14) still
  resolve to exactly 42px, so only one snapshot legitimately changed (grid shifts down for the 28px stat).
- **Verification:** Jest **408/408** (1 snapshot intentionally updated); real-browser settings sweep
  **253/253 pass**; screenshot `autotest/out/set_statChips_fontSize_28.png` shows the 28px chips fully
  inside the band, no clip/overflow.

### Observations (NOT changed — appear to be deliberate design; flagged for the team)

- **Faceted keyboard ↑/↓ crosses panel boundaries.** ←/→ are panel-scoped, but ↑/↓ walk the flat day
  array, so ArrowDown off the last cell of one small-multiple lands in the next category. No crash
  (bounds are guarded); just semantically inconsistent. Leave as-is unless panel-local vertical nav is a
  requirement. (`src/interaction/keyboard.ts`)
- **Today ring + anomaly hint apply the combined-series result to every panel sharing a date** in facet
  mode (anomaly map keyed by date only). Code comments indicate this is the intended "combined chrome"
  simplification. Revisit only if per-facet anomaly accuracy is required. (`src/visual.ts`, `tooltip.ts`)

Otherwise the visual-side code reviewed clean: date/grid math is DST-safe, color-scale and percentage
division-by-zero are guarded, and empty/null data short-circuits to the empty-state path.

---

## C. Automated visual testing (real browser, headless) — ✅ DONE

Unit tests run under **jsdom**, which does **not** lay out SVG or measure text — so it can't catch
clipping/overflow/render bugs. To test those *automatically* (no human clicking Desktop), I built a
headless-Chromium harness that mounts the **real `Visual` class** (same one Power BI instantiates) with
the existing mock host + mock DataView, then asserts on **real geometry** and captures screenshots.

- Harness: `autotest/entry.ts` (browser mount) + `autotest/run.mjs` (Playwright driver). Build:
  `npx esbuild autotest/entry.ts --bundle --format=iife --loader:.less=empty --outfile=autotest/bundle.js`
  then `node autotest/run.mjs`. Output: `autotest/out/*.png` + `report.json`.
- **12 scenarios** × real-layout assertions, plus a real **hover→tooltip** test and a **keyboard-nav**
  test: baseline, multi-year, target+tooltip, faceted (3 teams), dark, high-contrast, tiny (240×160),
  wide-short (1500×220), narrow-tall (360×720), month-block layout, header-on, header-on-multiyear.
- Assertions per scenario: no `renderingFailed`; cells render; **no `NaN`/`undefined`/`Infinity`** in the
  SVG; **no text clipped above the top edge** (the "Peak uay" class of bug); no text overflowing the SVG
  box; semantic checks (multi-year stamps both years; peak chip = `value | date+year`; tooltip on-screen
  and well-formed; ArrowDown moves focus).

### Result: **0 HIGH-severity render bugs across all 12 scenarios + interactions.**

Auto-verified (these are the handoff's "re-confirm visually" items — now covered by automation):

| Re-confirm item | Result |
|---|---|
| KPI header not clipped at top edge | ✅ `minTop ≥ 0` with header on |
| Peak-day chip = pipe + value + year | ✅ `396 \| Jan 6, 2025` (en-US mock host) |
| Multi-year stamps the year | ✅ both 2024 and 2025 present; chip `399 \| Dec 29, 2025` |
| Tooltip renders, on-screen, no NaN | ✅ value/delta/target/anomaly all well-formed |
| Polarity neutral by default | ✅ anomaly line muted (no good/bad color) out of the box |
| Dark theme + high contrast | ✅ both render correctly (grayscale ramp in HC) |

Screenshots in `autotest/out/` (baseline, dark, high-contrast, faceted, month-layout, hover-tooltip, …).

### OBS-1 — Horizontal overflow at extreme-small width (≤ ~250px)  ⚠️ LOW — design call

- At a 240×160 viewport the full-year grid (53 week-columns) overflows the right edge: cells hit the
  **3px floor** (`grid.ts:113`, `Math.max(3, Math.min(cellSize, fitW, fitH))`) and 53×3px + gaps + the
  weekday-label margin slightly exceed 240px, so the last month labels ("Oct"–"Dec") render past the
  edge and are clipped by the host. Fine at 360px+ (narrow-tall scenario shows no overflow).
- Not auto-fixed: the right behavior at that size (min-size guard / thin labels / scroll) is a product
  decision. Recommend a "too small to render a full year" guard below a threshold width. Not a cert blocker.

### Still genuinely needs a human (cannot be automated here)

- **Service publish** + in-browser re-check (needs a Power BI account / tenant).
- **Cross-visual interactions** with *other* real visuals on a report page (cross-filtering both ways).
- **Save/reopen .pbix persistence** of settings (needs the Desktop file round-trip).

The live-debug path is set up if you ever want it: PowerShell 7 + dev cert trusted, `pbiviz start` on
`https://localhost:8080`, `.pbiviz` in `dist/`.

---

## D. Settings sweep (every setting, real browser) — ✅ DONE

Reused the same `enumerateCandidates()` the jsdom unit sweep uses, but drove all **253 setting values**
across the 21 cards through headless Chromium (`autotest/settings.mjs`), checking each one:

1. **took effect** — the rendered SVG actually changed (when a visible change is expected);
2. **render integrity** — no `renderingFailed`, cells render, no `NaN`/`undefined`/`Infinity`, nothing
   clipped above the top edge, no text overflow;
3. **correctness** — for the visually-meaningful settings the *right* attribute changed to the right
   value: layout (continuous ↔ month blocks), every palette/ramp/scale/bucket, **text size** (font-size
   px), **text colour** (fill), bold/italic/underline, cell size/gap/corner-radius, legend show/position/
   align, badges, etc.

Cards that only render in a context (facet titles → faceted data; year tags → multi-year data) are fed
the dataset that exercises them, so "no text to style" isn't mistaken for a bug.

### Result: **253/253 settings take effect and render correctly** (after fixing BUG-W03).

The sweep is what surfaced **BUG-W03** (header not adapting to font size/family). Re-run with one command:
`node autotest/settings.mjs` (after building `autotest/bundle.js`). Curated screenshots `set_*.png` in
`autotest/out/` cover layouts, every palette, scale modes, text styling, header alignment, legend, badges.

---

## Guardrails observed

No AppSource submit / publish / deploy / pricing change. Worked on a branch (origin is the upstream
Zentrix-Studio repo, not a fork). No secrets committed.
