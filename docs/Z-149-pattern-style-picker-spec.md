# Z-149 — Cell pattern-style picker (Core 5) · Design spec

> **Owner (design):** Iris (P4). **Build:** Daedalus (P5). **QA:** Themis (P6).
> **CEO-directed 2026-06-07 — design decisions already made; this spec is the build contract.**
> Canonical dev tree: `powerbi-visuals/zentrix-calendar-heatmap/code/zentrixCalendarHeatmap/`.
> Builds ON the shipped Z-146 rules engine + Z-148 token mirror — **does not rip anything out.**

## 0. Verified current state (grounded, not assumed)

- One pattern today: `drawThresholdPattern(overlay, box, dark)` — `src/render/states.ts:92`.
  Draws raw per-cell `<line>` elements inside a per-cell `<clipPath>` (a fresh clip + N lines **per cell**).
- Invoked in **two** places in `src/visual.ts`:
  - `:459` — Accessibility "Pattern on threshold" overlay (`s.accessibility.patternOnThreshold`).
  - `:486` — Z-146 rules `patternOn` cue (`hit.cueRule?.patternOn`).
- `AccessibilityCard` (`src/settings.ts:260`) has `patternOnThreshold` + `patternThresholdValue` —
  **no style choice.**
- Each `RuleSlot` (`src/settings.ts:300`) already has a `pattern` **boolean** toggle ("CVD hatch"),
  mapped to `Rule.patternOn` in `activeRules()` (`src/settings.ts:373`). `rules.ts` has `patternOn?: boolean`.
- `defs` precedent exists: `src/render/legend.ts:96` already does `g.append("defs").append("linearGradient")`.
- Token mirror `src/theme/zentrixTokens.ts` exports `accent`, `posSafe`, `negSafe`, `textPrimary`,
  `textTertiary`, etc. **No new hex is needed** — pattern strokes resolve from tokens.

## 1. Scope (CEO decisions, applied exactly)

**Pattern set = Core 5**, in this fixed order (Diagonal lines is index 0 = the back-compat default):

| key        | label          | notes |
|------------|----------------|-------|
| `diagonal` | Diagonal lines | **Default.** Must reproduce today's hatch look. |
| `dots`     | Dots           | |
| `crosshatch` | Crosshatch   | diagonal in both directions |
| `grid`     | Grid           | orthogonal H+V lines |
| `stars`    | Stars          | small 4/5-point star glyphs tiled |

**Scope = per-rule patterns + an accessibility-card style picker (both):**

- **(a)** Add a **"Pattern style"** dropdown to `AccessibilityCard` controlling the threshold-overlay
  pattern style. Default `diagonal`.
- **(b)** Extend each of the **3 Z-146 rule slots** so a rule's cue becomes **color outline + badge +
  pattern**, each independent. The per-rule `pattern` boolean toggle stays as the on/off; add a per-rule
  **pattern style** dropdown next to it. So the cue is: optional outline color, optional badge, optional
  pattern (on/off + style).

## 2. Rendering — generalize to a pattern module with reusable `<pattern>` defs

Replace the per-cell `<line>` drawing with **define-once SVG `<pattern>` defs, fill rects with `url(#…)`**.

**New module `src/render/patterns.ts`** (keep `states.ts` lean):

```ts
export type PatternStyle = "diagonal" | "dots" | "crosshatch" | "grid" | "stars";

/** Ensure a <pattern> def exists for (style, theme, density bucket) and return its id.
 *  Idempotent: define-once, reused across all cells in the render. */
export function ensurePatternDef(
    defs: GroupSel,            // a single <defs> created once per render
    style: PatternStyle,
    dark: boolean,
    sizeBucket: number,        // quantized cell size → density (see §3)
): string;

/** Draw a pattern over a cell by filling a clipped rect with url(#id) —
 *  no per-cell <line> loops, no per-cell clipPath. pointer-events:none. */
export function drawPattern(
    defs: GroupSel,
    overlay: GroupSel,
    box: CellBox,
    dark: boolean,
    style: PatternStyle,
): void;
```

- **`drawThresholdPattern(overlay, box, dark)` is REPLACED by `drawPattern(defs, overlay, box, dark, style)`.**
  Keep a thin back-compat shim OR update both call sites (build's choice — see §5).
- One `<defs>` element is created once per `update()` render (e.g. `this.defsGroup = this.svg.append("defs")`
  alongside the existing groups at `visual.ts:126-131`, cleared each render like the other groups at `:170/:231`).
- One `<pattern>` def per **(style, theme, density bucket)** — reused across every matching cell via `url(#id)`.
  Pattern id is deterministic, e.g. `zx-pat-${style}-${dark?"d":"l"}-${sizeBucket}`. **No `Math.round(box.x)`
  per-cell ids** (the old approach made one clip per cell — that's the DOM-node explosion we're killing).
- The fill rect is exactly the cell box, `fill="url(#id)"`, `pointer-events:none`. Because `<pattern>` tiles
  are clipped to the patternUnits box, no extra per-cell `<clipPath>` is needed; the fill rect bounds the tiling.

## 3. Density scales to cell size (legibility on tiny cells)

- Compute a **density bucket** by quantizing `box.size` (e.g. `Math.max(1, Math.round(box.size / 6))`,
  capped) so we get a small finite set of pattern defs, not one per pixel size. Each bucket sets the
  pattern tile `width`/`height` and motif size so **dots/stars/grid stay distinguishable when cells get
  tiny** on multi-year reports, and don't look sparse when cells are large.
- Preserve the existing CVD contrast logic: stroke is `dark ? light-stroke : dark-stroke`. Keep the current
  opacities (`rgba(255,255,255,0.62)` on dark / `rgba(0,0,0,0.50)` on light) **as the contrast baseline**;
  if expressed via tokens, derive from `textPrimary` / a neutral token at matching opacity — but **no new raw
  hex literal** in `patterns.ts` (the eslint hex-ban covers render/ token-discipline files).
- Guard `box.size <= 0` (same as today's early return).

## 4. Back-compat (must not change any existing report)

- **Accessibility path:** existing `patternOnThreshold` configs have no style saved → **default to `diagonal`**,
  which must render **the same hatch as today**. A report that only set `patternOnThreshold=true` must look
  unchanged (QA proves this — snapshot parity on the diagonal style).
- **Rules path:** existing saved rules have no per-rule style → **default to `diagonal`** when a rule's
  `pattern` toggle is on (so a rule that already had `patternOn=true` keeps the current hatch); rules with the
  pattern toggle off render **no pattern** (unchanged). New rule slots default to pattern **off** (DD-6 lineage —
  rules are off by default; a freshly-enabled rule's pattern is off until the user turns it on).
- Net: the visual default state (no rules, no accessibility pattern) is **byte-identical**; the diagonal
  style is a faithful reproduction of the shipped hatch.

## 5. Settings wiring

**AccessibilityCard (`settings.ts:260`):**
- Add `patternStyle = new ItemDropdown({ name: "patternStyle", displayName: "Pattern style", items: PATTERN_STYLE_ITEMS, value: <diagonal> })`.
- Add to `slices`. `visibleIf`/`onPreProcess` so the dropdown shows only when `patternOnThreshold` is on
  (consistent with the existing conditional-control mechanism used elsewhere — e.g. legend Z-137-B3.2).

**RuleSlot (`settings.ts:300`):**
- Add `patternStyle = new ItemDropdown({ name: \`rule${n}PatternStyle\`, displayName: "Pattern style", items: PATTERN_STYLE_ITEMS, value: <diagonal> })`.
- Add to `slices()` (after `this.pattern`) and to the `onPreProcess` slice loop at `settings.ts:353`.
- Show only when that rule's `pattern` toggle is on.

**`activeRules()` (`settings.ts:361`/`:373`):** thread the style through — set `Rule.patternStyle = r.patternStyle.value.value`
(alongside the existing `patternOn: r.pattern.value`).

**`rules.ts`:** add `patternStyle?: PatternStyle` to the `Rule` type (import the type from `patterns.ts`).
`evaluateRules` is unchanged in logic — the style just rides on the `cueRule`.

**`visual.ts`:**
- `:459` (accessibility): `drawPattern(this.defsGroup, this.badgeGroup, cellBox(d), dark, s.accessibility.patternStyle.value.value)`.
- `:486` (rules): `if (hit.cueRule?.patternOn) drawPattern(this.defsGroup, this.badgeGroup, cellBox(d), dark, hit.cueRule.patternStyle ?? "diagonal")`.
- Create `this.defsGroup = this.svg.append("defs")` once; clear it each render with the other groups.

**`capabilities.json`:** the new `patternStyle` + `rule{1,2,3}PatternStyle` enum slices must be registered
(mirror how the existing rule props were added in Z-146). `pbiviz package` + the settings-sweep test enforce
the property bijection.

## 6. Constraints (hard — enforce in QA)

- **Tokens, no raw hex.** No new inline hex in `patterns.ts` or any token-discipline file
  (`states.ts`/`tooltip.ts`/`dayData.ts`/`detailPanel.ts`/`rules.ts`/`patterns.ts` — extend the eslint hex-ban
  scope in `eslint.config.mjs` to include `patterns.ts`). `grep` for new hex must be clean.
- **Reusable `<pattern>` defs, not per-cell lines.** QA greps `patterns.ts`/`states.ts` to confirm the
  per-cell `<line>` loop + per-cell `clipPath` are gone, replaced by `url(#…)` fills + define-once defs.
- **Keyboard / HC behavior unaffected.** Patterns are non-interactive overlays — every pattern rect/def is
  `pointer-events:none`. No change to focus/selection/cross-filter.
- **The deferred RdBu cell-ramp is NOT touched.** Patterns are overlays; `colors.ts`/`ramps.ts` stay excluded
  from hex-ban and untouched.
- **No version bump / no push / no publish / no spend.** Stays `1.0.0.0`.

## 7. Tests to add (build must include)

- **`test/render/patterns.test.ts`** (new) — for each Core-5 style × {dark, light}:
  - `ensurePatternDef` is idempotent (same id returned, one def created when called N times).
  - `drawPattern` appends a rect with `fill=url(#<expected-id>)` and `pointer-events:none`, no `<line>` per cell.
  - density bucket changes the def (different tile size) but not the per-cell node count.
  - `diagonal` produces the legacy hatch geometry (contrast strokes dark vs light).
  - `box.size <= 0` is a no-op.
- **Per-rule pattern wiring** — extend the rules/settings tests: a rule with `patternOn` + a chosen
  `patternStyle` surfaces that style on `cueRule`; `activeRules()` maps `rule{n}PatternStyle` correctly;
  back-compat (no saved style → `diagonal`).
- **Back-compat snapshot:** accessibility `patternOnThreshold` only (diagonal default) renders the same family
  of nodes as before (allow for the structural change defs→url, but the visible hatch is the diagonal style).
- Settings-sweep / capabilities bijection stays green (new enum props registered).

## 8. Acceptance criteria (P6 gate)

1. `tsc --noEmit` exit 0 · `eslint .` exit 0 (hex-ban incl. `patterns.ts`) · `jest` green · `pbiviz package`
   success · `pbiviz package --certification-audit` "No external requests found".
2. All Core-5 styles render; **patterns use reusable `<pattern>` defs (`url(#…)`), not per-cell `<line>`** —
   verified by grep + the patterns test.
3. **Zero new raw hex** in token-discipline files (grep clean; eslint hex-ban active on `patterns.ts`).
4. **Back-compat:** `patternOnThreshold`-only report renders diagonal = today's look; existing rules with the
   pattern toggle on default to diagonal; default state byte-identical.
5. Density scales with cell size (dots/stars/grid legible at small sizes per the bucket logic).
6. Patterns are `pointer-events:none`; keyboard/HC/selection paths unchanged.
7. RdBu cell-ramp untouched; no version bump; nothing committed/pushed/published; no spend.

## 9. Known caveat (carry, do not re-escalate)

**Desktop visual verification still pending** — rides the existing Z-110/Z-106 Windows-env block. Patterns
**especially** need eyeballing at small cell sizes on Windows (dots/stars/grid legibility, diagonal parity with
the old hatch). Note it in the QA report; it is not a new escalation (Z-110 is already the open human-env item).
