# Change ledger — bugs found, bugs fixed, and what pins them

**Purpose.** One append-only record of every defect found and fixed in this visual, so that
a later fix cannot silently undo an earlier one. The failure mode this exists to prevent:
*fix A → breaks B → fix B → reintroduces A*, forever.

**The doc is not the safety net — the regression test is.** Every entry below MUST name a
test that fails if the defect returns. A ledger entry with no test is a story, not a
guarantee. If you cannot write a test for it, say so explicitly in the entry and mark it
`UNPINNED` so the next person knows the fix is on the honour system.

## How to use this file

**Before you fix anything:** search this file for the file/function you are about to touch.
If a past entry pins behaviour there, your change must keep that entry's test green — the
old defect is *part of the contract now*.

**When you fix something, append an entry** with:

| Field | Why it's there |
|---|---|
| **ID** | Stable handle (`CB-01`) to reference in test names, commits, and future entries. |
| **Status** | `FIXED` · `BY DESIGN` · `KNOWN GAP` · `UNPINNED`. |
| **Symptom** | What the user saw. Not the diagnosis — the observation. |
| **Evidence** | The measurement that proved it. "Looks wrong" is not evidence. |
| **Root cause** | `file:line` + the mechanism. |
| **Fix** | `file:line` + what changed. |
| **Pinned by** | The test that fails if this regresses. **Required.** |
| **Blast radius** | What else this touched — where a *future* regression would show up. |

Record `BY DESIGN` findings too. Behaviour that looks wrong but is intended is exactly what
gets "fixed" by the next person, causing a regression. Writing it down is what stops the loop.

---

## Audit: CB — "Elements → Day badges" pane (2026-07-12)

**Scope:** every control in the gear's Day badges pane — Mark peak, Peak emoji, Mark
threshold, Threshold ≥, Threshold emoji, and rules 1–3 (name · operator · value · and ·
compare · badge · color · CVD hatch · pattern style).

**Method:** the real `Visual` mounted under jsdom with a synthetic `DataView`, driven
through the actual gear engine (`applyLocal` → `rerenderFromSettings`, the same path the
settings bar uses), asserting on what lands in the SVG `g.badges` layer. Not a code read —
every finding below was observed in the DOM.

**Result:** 4 defects found and fixed. Verified good, no change needed: all 6 rule
operators, all 5 pattern styles, `compareTo = target`, rule name/badge/color plumbing,
and the rule-summary label.

---

### CB-01 — "Peak emoji" was configurable while "Mark peak" was off
- **Status:** FIXED
- **Symptom:** With *Mark peak* switched OFF, the *Peak emoji* row still rendered and let
  you pick an emoji. Picking one did nothing. (This is what the pane looks like in the
  screenshot that opened this audit.)
- **Evidence:** Dumping the pane's `visibleIf` verdicts with all toggles off:
  `always  emoji  Peak emoji  badge.peakEmoji` — while the threshold's two sub-fields
  correctly reported `HIDDEN`.
- **Root cause:** `src/interaction/settingsSchema.ts:361` — the `Peak emoji` field had no
  `visibleIf`, unlike its threshold counterparts on the adjacent lines. A plain omission.
- **Fix:** `src/interaction/settingsSchema.ts:361` — added
  `visibleIf: g => Boolean(g("badge.peakOn"))`.
- **Pinned by:** `test/render/dayBadges.test.ts` → *CB-01*. The second test there asserts
  **every** badge sub-field has a `visibleIf`, so the next field added to this pane cannot
  repeat the omission.
- **Blast radius:** Gear pane only. No render or persistence change — an author who already
  chose a peak emoji keeps it; the field just hides until the source is on.

### CB-02 — peak / rule / threshold badges stacked on top of each other
- **Status:** FIXED — **this was the serious one**
- **Symptom:** A day that satisfied more than one badge source got *every* source's emoji
  drawn on it, all centred on the same point — overlapping glyphs rendering as unreadable
  mush rather than as a badge.
- **Evidence:** peak + threshold(≥50) + rule1(≥50) on a 2025 dataset → **148 cells carrying
  two emoji at identical coordinates** (`114,167.5 → ⚠️ + ⭐`, …), and the peak day carrying
  three. `drawBadge` (`src/render/states.ts:145`) centres its `<text>` in the cell, so
  co-drawn badges land exactly on top of one another.
- **Root cause:** `src/visual.ts:641-667` (pre-fix) — the three sources each ran their own
  `drawBadge` loop with no arbitration. Ironically `src/render/rules.ts` documented the
  intended contract ("one badge per cell") — the *composition layer* violated it.
- **Fix:** `src/visual.ts:640-682` — the sources now bid into a `badgeByDay:
  Map<DayCell, string>` and the winner is drawn once, after all bids. Precedence, least to
  most specific: **threshold < rule < peak**. Peak bids last because it is the single most
  specific day on the panel and must not be buried.
- **Pinned by:** `test/render/dayBadges.test.ts` → *CB-02* (4 tests: no cell ever holds >1
  badge; peak wins its day; rule supersedes threshold; **and the legacy threshold still
  badges on its own** — that last one guards the back-compat path the fix could have broken).
- **Blast radius:** Changed the rendered SVG. **37 settings-sweep snapshots** moved by
  exactly `texts: N → N−1` — one fewer glyph, no geometry change — because the sweep's
  `badgesOn` prereq turns on peak *and* threshold, so its peak cell had been double-drawn
  all along. Re-baselined. **If a future change makes those `texts` counts go back UP by
  one, CB-02 has regressed.**

### CB-03 — the threshold was unreachable for most real measures
- **Status:** FIXED
- **Symptom:** *Threshold ≥* could not be set above 200, or below 0.
- **Evidence:** stepper bounds `{min: 0, max: 200, step: 5}` against a test measure whose
  range is `0…396`. Any measure larger than 200 (revenue, counts, durations) or containing
  negatives could not be given a meaningful threshold. There is no escape hatch: the
  `badges` card is **not** in `PANE_CARDS` (`src/settings.ts:553`), so the gear is the only
  surface that can set it.
- **Root cause:** `src/interaction/settingsSchema.ts:368` — bounds were a guess about the
  data's magnitude. The rule steppers on the same pane already used `±1e9`.
- **Fix:** `src/interaction/settingsSchema.ts:368` — widened to `min: -1e9, max: 1e9,
  step: 1`, matching the rule steppers.
- **Pinned by:** `test/render/dayBadges.test.ts` → *CB-03* (bounds are no narrower than the
  rule steppers; a threshold of 300 — above the old cap — badges the correct days).
- **Blast radius:** Gear pane only. Widening bounds cannot invalidate a persisted value.

### CB-04 — a rule's "CVD hatch" switch did nothing if an earlier rule had a color
- **Status:** FIXED
- **Symptom:** Turn on *CVD hatch* for rule 2 while rule 1 is also matching → no hatch is
  drawn anywhere. The switch is dead, silently.
- **Evidence:** rule1(color `#0072B2`, matches all) + rule2(hatch `dots`, matches all) →
  `patternFills: 0`. Zero hatched cells. After the fix: `342`.
- **Root cause:** `src/render/rules.ts:99` (pre-fix) — `evaluateRules` resolved a **single**
  `cueRule` = *the first matched rule with a color __or__ a pattern*. So a color-only rule
  claimed the cue slot and the later rule's hatch — a different cue channel it never
  competed for — was dropped on the floor.
- **Fix:** `src/render/rules.ts:77-110` — `RuleHit` now resolves each cue channel
  independently: `colorRule`, `patternRule`, `badgeRule`. First-match-wins still holds
  *within* a channel, so the intended "target breach overrides bad day" precedence is
  preserved; a rule can just no longer swallow a cue it never asked for.
  `src/visual.ts:668-669` consumes the two channels.
- **Pinned by:** `test/render/dayBadges.test.ts` → *CB-04*, plus `test/render/rules.test.ts`
  ("color and hatch cues can come from different matched rules" **and** "first-match-wins
  still holds WITHIN a channel" — the second is what stops a future fix from over-correcting
  CB-04 into losing the override semantics).
- **Blast radius:** Renamed `RuleHit.cueRule` → `colorRule`/`patternRule`. Callers updated:
  `src/visual.ts`, `test/render/rules.test.ts`, `test/render/patternWiring.test.ts`.

---

## Observed and deliberately NOT changed

Recorded so they are not "fixed" into regressions later.

### CB-05 — turning on a source with its factory default matches every day
- **Status:** BY DESIGN
- *Mark threshold* defaults to `≥ 0`, and a rule defaults to `≥ 0` — so switching either on
  badges/outlines **every** valued day until you set a real value. It looks like a bug and
  is not: `≥ 0` genuinely does match everything. There is no universally correct default
  (the right number depends entirely on the measure), and changing the default would alter
  how existing saved reports render.
- **Do not** "fix" this by special-casing 0 — that would make a legitimate `≥ 0` threshold
  (perfectly meaningful for a measure with negatives) unexpressible.

### CB-06 — `Compare: Value − Target` silently matches nothing with no Target bound
- **Status:** KNOWN GAP — not fixed
- With no field in the **Target** well, `compareTo: "target"` can never match
  (`src/render/rules.ts:50` returns `null` when the target is missing), so the rule quietly
  does nothing and the gear gives no hint why.
- Not fixed because the gear's `visibleIf` predicates only see the *settings model*, not the
  data roles — surfacing this needs the schema to become data-aware, which is a
  cross-visual change to the shared settings-bar engine (`@zentrix/visual-settings`), not a
  local patch. Worth doing; out of scope for this audit.

### CB-07 — one global peak across all facets, not one per small-multiple panel
- **Status:** BY DESIGN (documented intent, `src/visual.ts:674-680`)
- In small-multiples mode a single 🔥 lands on the global maximum, not on each panel's own
  peak. This is the existing documented behaviour and the fix preserved it exactly.
- If this is ever changed, it is a **product decision**, not a bug fix — and it will move
  the sweep snapshots.

---

## QA run: 2026-07-14 — first executed Desktop pass + harness edge matrix

**Scope:** the packaged 1.1.0.0 `.pbiviz` driven interactively in Power BI Desktop
(Windows 11, report: `Zentrix-Calendar-Heatmap-QA-Report.pdf`), plus a jsdom harness
edge-matrix run closing the data cases Desktop could not mutate. Desktop verdict:
36 PASS / 4 PARTIAL / 11 DEFERRED / **0 FAIL**.

### QA-01 — `Infinity` in the Value measure collapses the linear/log color ramp
- **Status:** KNOWN GAP — not fixed
- **Symptom:** with scale mode = Linear, a single `Infinity` value flattens every other
  day to the lowest ramp color (2 distinct fills instead of 5). Quantile (the default)
  is unaffected. No crash, no `renderingFailed` — the colors are just silently wrong.
- **Evidence:** harness run 2026-07-14 — 60 days, day 30 = `Infinity`: quantile → 5
  distinct fills; linear → 2. No `NaN`/invalid fills in either mode.
- **Root cause:** `src/model/dataTransform.ts:58` guards `v == null || isNaN(v)`;
  `Infinity` passes and poisons `vMin/vMax`, so the quantize domain becomes
  `[min, Infinity]`. Fix path: `!Number.isFinite(v)` (treat as no-data), or clamp the
  domain. Microsoft's submission-testing checklist explicitly exercises infinity.
- **Pinned by:** none yet — add a regression test alongside the fix.
- **Blast radius:** `aggregateByDay`, `buildColorAccessor` domain, legend bucketing.

### QA-02 — Fiscal year start appears to do nothing in the calendar layout
- **Status:** BY DESIGN (documented: `docs/settings-contract-map.md:149`)
- The Desktop tester flagged Data → Fiscal year as a no-op. It is scoped, not dead:
  `timeIntel.fiscalStart` feeds **`computeInsights` only** (fiscal framing of the
  year-over-year comparison; `src/visual.ts:488`). It never touches `dateGrid` or any
  grid drawer, and the YoY insight needs ≥2 years of data to fire at all.
- **Do not** "fix" this by re-plumbing it into the grid without a product decision;
  consider relabeling/help-text in the gear instead.

### QA-03 — Facet panel titles vanish on small panels
- **Status:** BY DESIGN (`src/render/facets.ts:95-98`)
- Per-panel category titles are shed when the predicted facet cell size drops below
  `MIN_FACET_TITLE_CELL` (4px, `src/render/density.ts:18`) — the title strip is
  reclaimed for cells at sparkline size. Harness confirms titles render (`.facet-title`
  = Alpha/Beta/Gamma) on a roomy viewport.

---

## Fix batch: 2026-07-14 — QA-report issues (the "SHIP AFTER FIXES" list)

### QA-01 — status change: FIXED
- **Fix:** `src/model/dataTransform.ts` `aggregateByDay` — the skip guard is now
  `v == null || !Number.isFinite(v)`, so ±Infinity is treated exactly like null
  (a day with only non-finite rows renders as no-data).
- **Pinned by:** `test/dataTransform.test.ts` — "skips ±Infinity values so they
  cannot poison aggregates (QA-01)".
- **Blast radius:** value AND target aggregation (same helper); linear/log color
  domains; legend bucket edges.

### D1–D3 — orphaned cards wired into the gear — FIXED
- **Symptom (Desktop run, issue #3):** Insights / Small multiples / Facet titles had
  no gear UI — settings persisted and rendered but no user could ever change them.
- **Fix:** `src/interaction/settingsSchema.ts` — KEYS entries `insights.show/.polarity/.count`,
  `facets.columns/.sharedScale`, `typeEntries("facetTitle")`; SB_CATS subs
  Data → "Small multiples", Elements → "Insights", Text → "Facet titles".
- **Pinned by:** `test/interaction/settingsSchemaParity.test.ts` — the D1–D4 ROUND_TRIPS
  block + "Insights card renders…", "Small multiples card renders", "Facet titles text
  card renders". Deleting any binding fails the parity suite.
- **Blast radius:** the gear tree; insights band show/hide now user-reachable (still
  premium-gated in `visual.ts`); facet reflow via columns.

### D4 — mono/theme palette modes unreachable — FIXED
- **Fix:** an explicit "Mode" segText row in Color → Custom colors (KEYS `paletteMode`
  already existed); plus `startColorEntry()` — the Start/hue edit is now mode-aware:
  in mono/theme it keeps/settles on mono instead of kicking the palette to duotone
  (which is what made mono unreachable even by hand). Ramp-mode behavior unchanged
  (edit start → duotone, Z-137 §1 kept).
- **Pinned by:** parity suite — "QA-D4 — mono/theme palette modes are reachable and
  stable" (3 tests) + "Palette Mode row renders in Custom colors (D4)".
- **Blast radius:** `resolvePalette` mono/theme branches now reachable — note
  `monoRamp` assumes `#rrggbb` input (see earlier review); PBI color pickers only
  emit hex, so no validation added yet.

### QA-04 — gear overlapped the grid on tiny tiles — FIXED
- **Symptom (Desktop run, issue #6):** at ~200×150 the gear button overlapped the
  grid corner.
- **Fix:** `src/visual.ts` update() — the gear is force-hidden when the viewport is
  under 300×180 (smaller than the bar's own 282px popover could operate in).
- **Pinned by:** parity suite — "QA-04 — the gear hides on tiles too small for its
  popover".

### QA-05 — gear button appears in Desktop PDF exports
- **Status:** BY DESIGN (partially mitigated by QA-04)
- The gear is a DOM overlay shown in authoring contexts. Power BI Desktop always
  renders in Edit mode, so File → Export captures it. In Service **Reading view** —
  where consumer-facing PDF/PPT exports happen — the gear is already hidden
  (`toolbar.update(…, readingView)`). There is no export-detection API to do better.

### QA-06 — December truncates at extreme-small tile sizes (~200×150)
- **Status:** KNOWN GAP (accepted)
- A 53-column year cannot fit 200px; `planChrome` sheds chrome and clamps cell size,
  then the grid clips at the right edge. Graceful (no overlap/crash) but truncated.
  A "fit-to-width at any cost" mode is a product decision, not a bug fix.

### QA-07 — visual ignores report-theme dataColors
- **Status:** BY DESIGN
- The heatmap keeps its own sequential ramp because theme `dataColors` are categorical
  and would destroy the low→high encoding. Theme awareness exists where it is safe:
  dark-background detection + the reachable-again "Theme" palette mode (tints the
  host accent — D4).

### QA-08 — all-fields-removed showed the platform placeholder, not the branded landing
- **Status:** FIXED
- **Fix:** `capabilities.json` + `supportsLandingPage: true` — the host now calls
  `update()` with no roles bound, which routes to `renderEmptyState` + the branded
  onboarding carousel (the constructor mount stays as the first-paint fallback).
  Also clears the pbiviz "Landing Page" packaging warning.
- **Pinned by:** UNPINNED for the host behavior itself (jsdom cannot emulate the
  host's no-role update call); the landing render path is covered by the existing
  harness empty-state tests. Verify once in Desktop on next side-load.

### QA-09 — every data role was named "… (?)" in the field wells
- **Status:** FIXED (mojibake predating the git baseline — an emoji lost in a
  non-UTF8 write; shipped that way in 1.0.0.0 and 1.1.0.0)
- **Fix:** dropped the dead " (?)" suffix from all five role displayNames
  (`Date`, `Value`, `Split by`, `Target`, `Tooltips`). Role `name`s (the persistence
  contract) untouched.
- **Pinned by:** UNPINNED (cosmetic string; no behavior to test).

---

## QA round: 2026-07-15 — Power BI Service pass (`Zentrix-Heatmap-QA-Feedback.pdf`)

**Headline:** the three certification gates PASSED live in Service (network isolation,
console cleanliness, reading-view behavior). But the run tested a **stale build** —
the published .pbix embedded a pre-1.2 visual (branded landing absent, gear auto-hide
absent, "(?)" visible in field wells), so every v1.2.0.0-fix FAIL from that report is
**VOID pending re-publish**, not a regression.

### QA-10 — the running build version was unreadable at runtime
- **Status:** FIXED (v1.2.1.0)
- **Symptom:** QA could not confirm which build was under test: the version renders
  only on the landing page, the visual lives in a cross-origin sandboxed iframe, and
  Service rejects direct .pbiviz upload. An entire Service QA session was spent
  against the wrong build without any way to detect it.
- **Fix:** `settingsSchema.ts` — a version heading (`Zentrix Calendar Heatmap
  v<VERSION>`) at the bottom of the gear's Accessibility pane, sourced from
  `src/version.ts` so the three-place version bump rule keeps it truthful.
- **Pinned by:** parity suite — "QA-10 — the running build version is readable from
  the gear" (asserts the heading matches `src/version.ts` exactly).

### QA-11 — Service PDF/PPT export renders "This visual does not support exporting"
- **Status:** PLATFORM LIMITATION (not fixable in code)
- Server-side export (Service PDF/PowerPoint, email subscriptions, print) renders
  **certified** custom visuals only; side-loaded/uncertified builds show the
  placeholder. Desktop export is client-side and unaffected (passed 2026-07-14).
- **Resolution path:** Microsoft certification (already planned post-listing).
  Until certified, do not promise Service-export fidelity in listing copy or demos.

### Void results requiring re-run after 1.2.1.0 is republished
- Branded landing on all-fields-removed (QA-08) — FAILED on the stale build only.
- Gear auto-hide below 300×180 (QA-04) — same.
- "Gear shows only 4 categories" — observed once on the stale build on a narrow
  visual; SB_CATS in source has 6. Re-check on 1.2.1.0 at normal size.
- Full gear control audit (blocked by an automation iframe-click failure, not a
  product defect) + bookmarks / pin / page filter / slicer / Inf-linear re-run.

---

## Feature: Summary table view (2026-07-15)

New `summaryTable` card (Elements → Summary table, gear-only): a full-screen
alternate VIEW — the table replaces the calendar entirely, never shares the
canvas with it. A floating Visual/Table switch (bottom-right,
`src/interaction/viewToggle.ts`) flips between the two. New drawer:
`src/render/summaryTable.ts` (per-month rows, or per-group when a Split-by is
bound, + an all-rows Total). Wiring: `visual.ts` `render()` early-returns into
the table before any chrome planning.

### ST-A — enabling the summary table renders ZERO day cells
- **Status:** BY DESIGN
- **Symptom-to-be:** "the heatmap is blank / all cells disappeared when the
  summary table is on." That is the feature: calendar XOR table, per the CEO
  request ("at a time either calendar heatmap or summary table … whole screen").
  Do not "fix" the missing cells by rendering both.
- **Mechanics:** `src/visual.ts` `render()` — when `summaryTable.show` is on and
  the session view is the table, it draws `renderSummaryTable` and returns before
  the grid/chrome path. The sweep harness encodes the exception as
  `noCells: true` on `summaryTable.show` (`test/harness/sweep.ts`) — the ONLY
  setting allowed to blank the cell layer.
- **Pinned by:** `test/render/summaryTable.test.ts` → *ST-01* (table on → 0
  cells, N rows; calendar back → 0 rows), plus the sweep candidate
  `summaryTable.show → true` (SVG must change, no failure).

### ST-B — the Visual/Table flip is session-local, deliberately unpersisted
- **Status:** BY DESIGN
- **Symptom-to-be:** "the bottom-right switch doesn't save its state / resets
  after re-enabling the option." Intended: the switch must work for report
  READERS in Reading view, where `persistProperties` writes don't survive — so
  the flip is an in-memory `tableView` field replayed through
  `rerenderFromSettings()`, and only the author-set `summaryTable.show` default
  is persisted. Turning the option off re-arms the default (next enable opens on
  the table). A host update() while the option stays on does NOT reset the flip.
- **Pinned by:** `test/render/summaryTable.test.ts` → *ST-02* (flip both ways
  with no persistence; chosen view survives a host `update()`), *ST-03* (switch
  hidden while the option is off; re-enable re-arms to table).
- **Blast radius:** `render()`'s early-return skips grid, badges, annotations,
  insights, legend, tooltip/panel context, and `wireInteractions` while the
  table is up — a future feature added ONLY below the early return will
  silently not apply in table view. The gear is parked top-right in table view
  so it can't collide with the bottom-right switch.

---

## Merge reconciliation: local ↔ Zentrix-Studio/Calendar-Heatmap (2026-07-15)

**Context.** The local working folder had diverged from the GitHub remote with no
shared git history (fresh `git init` locally). Remote `main` was an older
v1.0.0.0 export + Windows-QA edits; the local tree was newer (annotations/Z-152,
`aggMode`, this ledger). The reconciliation grafted real remote history under the
local tree (branch `sync/local-source-of-truth`) and re-integrated two features
the local refactor had dropped while remote still had them. Method: ported
remote's own implementation onto local's structure, then pinned with remote's
own tests (adapted to local's API).

### HL-01 — `capabilities.supportsHighlight:true` was declared but NOT implemented
- **Status:** FIXED
- **Symptom:** External cross-highlight was a no-op. When another visual filtered
  the report, this visual did not dim its un-highlighted days — yet
  `capabilities.json` advertised `"supportsHighlight": true` (a cert/quality red
  flag: claiming an interaction you don't perform).
- **Evidence:** local `dataTransform.ts` never read `valueColumn.highlights`;
  `DayCell` had no `isHighlighted`/`highlightValue`; `states.ts` had no
  `applyHighlight`. Remote had all three (dropped in the local refactor).
- **Root cause:** two-way divergence — the highlight-consumption code lived only
  on remote `main` (`src/model/dataTransform.ts`, `src/render/states.ts`,
  `src/types.ts`).
- **Fix:** `src/model/dataTransform.ts` — `ParsedRow.highlight`,
  `ParsedDataView.hasHighlights`, `parseDataView` reads `values[].highlights[]`,
  `assembleModel` aggregates highlights with the SAME `aggMode` as values and sets
  `DayCell.highlightValue`/`isHighlighted` + `CalendarModel.hasHighlights`.
  `src/render/states.ts` — `applyHighlight()` (reuses `applyCrossHighlight`'s dim).
  `src/visual.ts` — `applyState()` calls `applyHighlight(cells)` when
  `model.hasHighlights && !selectionManager.hasSelection()` (user selection wins;
  host highlight is the idle dim). The no-highlight path is byte-identical — all
  329 sweep snapshots unchanged.
- **Pinned by:** `test/highlights.test.ts` (model: hasHighlights flag +
  highlightValue/isHighlighted, incl. same-mode aggregation) and
  `test/highlightRender.test.ts` (render: `applyHighlight` dims to
  `STATE.dimOpacity`, matches `applyCrossHighlight`).
- **Blast radius:** `aggregateByDay` now runs a third time when highlights are
  present; highlight fields are `undefined` in the normal path so any code reading
  them must treat undefined as "no highlight". Do NOT remove
  `supportsHighlight` from `capabilities.json` without also removing this code.

### KB-01 — keyboard had no context-menu affordance (ContextMenu / Shift+F10)
- **Status:** FIXED
- **Symptom:** A keyboard-only user could navigate + select cells but could not
  open the host context menu on the focused day (accessibility gap; mouse users
  had right-click via `bindSelection`).
- **Root cause:** local `KeyboardParams` had no `onContextMenu`; `bindKeyboard`
  ignored the `ContextMenu`/`F10` keys. Remote had both.
- **Fix:** `src/interaction/keyboard.ts` — `onContextMenu?` param + a
  `ContextMenu`/`Shift+F10` case (bare F10 ignored). `src/visual.ts` — wired to
  `selectionManager.showContextMenu` anchored at the focused cell's
  `getBoundingClientRect()`, mirroring the right-click path.
- **Pinned by:** `test/keyboard.test.ts` (ContextMenu key + Shift+F10 open the
  menu with `preventDefault`; bare F10 does not).
- **Blast radius:** `keyboard.test.ts`'s `CalendarModel` literal now needs
  `aggMode` (local made it required). The keyboard handler swallows F10 only when
  Shift is held — bare F10 stays available to the host/browser.
