# Windows Desktop QA — Handoff (Mac → Windows → back to Mac)

**Read this first.** This briefs a *fresh* Claude Code session on the Windows PC — it has none of the
Mac's memory or company board, so everything it needs is here. Point it at this file:
*"Read WINDOWS-QA-HANDOFF.md, then walk me through side-loading this visual into Power BI Desktop and
running through the QA areas below."*

> This repo is the **Zentrix Calendar Heatmap** visual source **only** — the buildable pbiviz project
> (`src/`, `capabilities.json`, `pbiviz.json`, …). No business/strategy docs live here, by design (this
> is also the form a certification source review would expect). This `WINDOWS-QA-HANDOFF.md` is the one
> non-source file — a QA helper; it can be deleted before any certification submission.

## What this is
- A Power BI custom visual (pbiviz, TypeScript + D3). **Version `1.0.0.0`** — first public release.
- **State (verified on Mac):** `tsc` clean · **Jest 408/408 green** · ESLint clean · `pbiviz package
  --certification-audit` → **"No external requests found"**.
- **Not yet done — the whole reason for this machine:** it has never been QA'd on real **Power BI
  Desktop**. The Mac can't side-load; this machine can. That's the last blocker before AppSource submit.

## Setup (Windows, one-time)
1. Install **Node.js LTS** (18/20) and **PowerShell 7**, and **Power BI Desktop** (free).
2. In PowerShell 7, from the repo root:
   ```powershell
   npm install
   npx pbiviz install-cert   # trust the dev certificate when prompted
   ```
3. In Power BI Desktop, enable developer mode: *File → Options → Security → Enable Developer Mode*
   (wording varies by build).

## Load it (either path)
- **Live debug (best for QA):** `npx pbiviz start`, then add the **"Developer Visual"** in Desktop and bind fields.
- **Side-load a package:** `npx pbiviz package` produces `dist/*.pbiviz`; in Desktop use *Import a visual
  from a file*.

## What to test (Desktop)
Work these areas and note pass/fail + any repro:
- **Data type conversions** — numeric/date/text in the Values & Category wells; bad/empty/null data; large data.
- **Interactions** — cross-filtering and highlighting both directions with other visuals; selection persists.
- **Format pane** — toggle every setting; stress odd combos; confirm no console errors and clean re-render.
- **View modes / resize** — focus mode, small/large tiles, aspect changes, very small viewport.
- **Persistence** — save/reopen the .pbix; settings survive.
- **Service** — publish to Power BI Service and re-check rendering + interactions in-browser.
- **Accessibility** — colour-vision (`accessibility.patternOnThreshold` pattern mode), keyboard, contrast.

**Re-confirm these specific fixes hold visually on Desktop** (they pass in unit tests):
- Polarity defaults to **neutral** — a spike must NOT render green out of the box until direction is set.
- Multi-year month-block layout stamps the **year** ("Jan 2024 … Dec, Jan 2025 …"), no ambiguous repeat.
- KPI header is **not clipped** at the top edge (e.g. "Peak day", not "Peak uay").
- Peak-day chip shows pipe + year: "27 | 15 Sept 2025".
- Insight-card dates include the year when data spans 2+ years.

**Z-137 — colors/cells controls batch (new; pass in unit tests, verify visually):**
- **Manual colors work via the in-visual gear (NOT the native Format pane).** The native *Format → Colors*
  card is intentionally force-hidden — all color editing lives in the **in-visual gear → Color**. Test there:
  - **gear → Color → Custom colors:** edit **Split low / Split mid / Split high** → the grid recolors
    immediately (the overlay auto-switches to a custom *split* palette). Edit **Start/hue** or **End** →
    grid recolors as a *duotone*. No edit should read as inert.
  - **gear → Color → Palette:** a built-in ramp shows a check **only while a ramp is the active palette**.
    After you hand-edit any Custom color, return to **Palette** → **no ramp is checked** (you've moved to a
    custom split/duotone palette). Click a ramp again → it re-checks and the grid switches back to it.
  - **gear → Color → Custom colors** shows the caption **"Edits here build your own palette"** above the six
    color fields (visible without hovering the info icon).
  - There is **no** native Format-pane Colors card to test — if you see one, that's a regression.
- **Corner radius has real range.** Drag *Cells → Corner radius* 0 → 12 at normal density (e.g. 22px cells):
  cells visibly go from sharp squares to soft/pill. (Previously capped to ~2–4px and read as dead.)
- **Row gap and Column gap move independently.** In the in-visual gear → *Cells → Gaps* there are now two
  steppers, **Row gap** and **Column gap** (0–12px). Increase Column gap only → columns spread horizontally,
  rows unchanged. Increase Row gap only → rows spread vertically, columns unchanged. Both 0 = cells touch.
  Default 3/3 matches the prior look. Check **multi-year** and **month-blocks** layouts: month/weekday labels
  stay aligned to their cells (no label drift), and auto-fit still shrinks cells at small viewports.
- **Reset to defaults.** Open the in-visual gear (settings bar). A **Reset** action sits at the right end of
  the bar. After changing several settings (palette, gaps, radius, labels, fonts…), tap **Reset** → it arms
  to **Confirm**; tap again → palette, gaps, corner radius, labels, etc. all revert to defaults and the grid
  redraws. No console errors. Selection / bound data are unaffected. (Single tap then waiting ~2.6s disarms.)
- **Undo (Ctrl/Cmd+Z) is the host's, by design** — there is no custom undo in the visual. After any setting
  change, the host's Undo should step it back; the Reset action above is the in-visual "revert everything".
  Just confirm Undo behaves normally (host-owned); the visual does not intercept it.
- **Header right-align: no title/chip overlap (B3.1).** In the gear → Elements → Header, set Align to
  **Right**. The title text should be anchored to the right edge. The KPI chips (Total / Peak day) should
  move to the **LEFT** side of the header — they must NOT overlap or sit on top of the title text. Verify
  with a long title ("Sum of very long measure name") at a moderate visual width. At Left/Center align the
  chips remain on the right as before.
- **Legend controls swap with bucket mode (B3.2).** In the gear → Elements → Legend, with any discrete
  bucket setting (3, 5, or 7), only **Swatch size** is visible; the **Gradient length** row is absent. Go
  to Color → Buckets → Continuous, then reopen Elements → Legend: only **Gradient length** is visible;
  **Swatch size** is hidden. The swap is immediate on reopening the sub (no stale state).

> The Mac holds the full 110-item / 14-section QA + certification checklist (`phase-7-qa-report.md`). It
> wasn't included here to keep this a clean source repo — ask the Mac session to paste any section you want.

## Report back to the Mac
1. Write results into a new file in this repo: `QA-RESULTS-windows.md` (pass/fail per area + bugs with
   what-you-did / expected / actual / screenshot).
2. `git add -A && git commit -m "Windows Desktop QA results" && git push`
3. The Mac does `git pull`, QA (Themis) triages, frontend (Daedalus) fixes, repeat until Desktop-green.

## Guardrails (still apply on Windows)
- **Do NOT submit to AppSource, publish, deploy, or change pricing** — that's the CEO's call only.
  Hit something that needs it? Write it in the results file and stop.
- Pushing to this **private** repo is the handoff channel — fine. Don't commit secrets/tokens.
