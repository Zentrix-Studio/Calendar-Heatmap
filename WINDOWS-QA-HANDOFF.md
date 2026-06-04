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
