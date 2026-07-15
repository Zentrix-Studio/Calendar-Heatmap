/*
 * Hero screenshot harness — renders ONE clean flagship panel per load so we get
 * focused, shareable social images (not the full QA contact sheet).
 * Build: esbuild harness/hero.ts --bundle --outfile=harness/hero.js
 * Screenshot: open harness/hero.html#reveal  or  #compare  in headless Chrome.
 *
 * LinkedIn image variants (1200 x 627):
 *   #multiyear    — Image 1: two-year forest-green grid with shell overlay
 *   #engine-ocean — Image 2: ocean-dark insight card (Z-127)
 *   #cvd / #patterns — Z-149: before/after — real renderGrid heatmap, real
 *                      drawPattern texture (src/render/patterns.ts) on threshold
 *                      cells + a zoom inset; "readable without relying on color".
 */
import { select } from "d3";
import { enumerateDays, layout, monthLabels } from "../src/model/dateGrid";
import { CalendarModel, DayCell } from "../src/types";
import {
    buildColorAccessor, ScaleMode,
    VIOLET_RAMP_LIGHT, NO_DATA_LIGHT,
    NO_DATA_DARK, VIOLET_RAMP_DARK,
} from "../src/render/colors";
import { renderGrid } from "../src/render/grid";
import { renderHeader } from "../src/render/header";
import { renderLegend } from "../src/render/legend";
import { defaultText } from "../src/render/text";
import { drawPattern } from "../src/render/patterns";
import { cellBox } from "../src/render/states";

function seeded(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** Realistic right-skewed year (support-ticket-like) with ~6% gaps. */
function mockModel(year: number): CalendarModel {
    const days = enumerateDays(new Date(year, 0, 1), new Date(year, 11, 31));
    const { rows, cols, weeks } = layout(days, 0);
    const labels = monthLabels(days, cols);
    const rnd = seeded(42);
    let vMin = Infinity, vMax = -Infinity;
    const cells: DayCell[] = days.map((date, i) => {
        const weekday = date.getDay();
        const noData = rnd() < 0.06;
        let value: number | null = null;
        if (!noData) {
            const skew = Math.pow(rnd(), 3) * 400;
            const weekendDamp = weekday === 0 || weekday === 6 ? 0.35 : 1;
            value = Math.round(skew * weekendDamp);
            vMin = Math.min(vMin, value);
            vMax = Math.max(vMax, value);
        }
        return { date, value, noData, col: cols[i], row: rows[i], selectionId: null, sourceIndex: noData ? -1 : i };
    });
    return {
        days: cells, monthLabels: labels,
        range: [days[0], days[days.length - 1]],
        valueDomain: [vMin, vMax], weeks, hasToday: false,
        valueName: "Tickets resolved", totalDays: days.length,
    };
}

/** Small-count daily series (support tickets) scaled to match the Day-03 narrative
 *  numbers — peak in the teens, a Friday lift, and a deliberate ~9-day inactive gap. */
function mockTicketModel(year: number): CalendarModel {
    const days = enumerateDays(new Date(year, 0, 1), new Date(year, 11, 31));
    const { rows, cols, weeks } = layout(days, 0);
    const labels = monthLabels(days, cols);
    const rnd = seeded(7);
    let vMin = Infinity, vMax = -Infinity;
    const cells: DayCell[] = days.map((date, i) => {
        const weekday = date.getDay();
        const inStreak = i >= 175 && i <= 183; // 9 consecutive inactive days (late June)
        const noData = inStreak || rnd() < 0.05;
        let value: number | null = null;
        if (!noData) {
            const weekendDamp = weekday === 0 || weekday === 6 ? 0.4 : 1;
            const fridayBoost = weekday === 5 ? 1.35 : 1;
            value = Math.round(Math.pow(rnd(), 1.7) * 13 * weekendDamp * fridayBoost);
            vMin = Math.min(vMin, value);
            vMax = Math.max(vMax, value);
        }
        return { date, value, noData, col: cols[i], row: rows[i], selectionId: null, sourceIndex: noData ? -1 : i };
    });
    return {
        days: cells, monthLabels: labels,
        range: [days[0], days[days.length - 1]],
        valueDomain: [vMin, vMax], weeks, hasToday: false,
        valueName: "Tickets", totalDays: days.length,
    };
}

function card(W: number): HTMLDivElement {
    const el = document.createElement("div");
    el.style.cssText = `width:${W}px;padding:24px 28px;border-radius:16px;background:#FFFFFF;` +
        `box-shadow:0 8px 30px rgba(20,16,60,.10);font-family:Segoe UI,-apple-system,sans-serif;`;
    return el;
}

const ACCENT = "#7C5CFF", TEXT = "#1A1A22", MUTED = "#70707F";

/** Flagship: Direction C continuous year grid + framed KPI header. */
function reveal(root: HTMLElement): void {
    const W = 980, H = 250;
    const c = card(W); root.appendChild(c);
    const svg = select(c).append("svg").attr("width", W).attr("height", H);
    const g = svg.append("g");
    const model = mockModel(2025);
    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5, ramp: VIOLET_RAMP_LIGHT, noData: NO_DATA_LIGHT,
    });
    const headerH = renderHeader(g as any, model, {
        width: W, title: "Support throughput · 2025", align: "left",
        headline: { ...defaultText(16, TEXT), bold: true },
        stat: { ...defaultText(15, TEXT), bold: true },
        ruleShow: true, ruleColor: ACCENT, ruleWidth: 2,
        textColor: TEXT, mutedColor: MUTED,
    });
    const { geo } = renderGrid(g as any, model, {
        width: W, height: H - 24, cellSize: 14, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor: MUTED, topOffset: headerH + 8,
    });
    renderLegend(g as any, {
        x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 16, gradientWidth: 120,
        colors, labelColor: MUTED, showNoData: true, idSuffix: "hero",
    });
}

/** Before/after: linear-continuous (mostly pale) vs quantile 5-bucket (readable). */
function compare(root: HTMLElement): void {
    const W = 980, GRID_H = 190, LEGEND_H = 28;
    const make = (title: string, mode: ScaleMode, buckets: number) => {
        const c = card(W); c.style.marginBottom = "20px"; root.appendChild(c);
        const h = document.createElement("div");
        h.textContent = title;
        h.style.cssText = `font-weight:600;font-size:16px;margin-bottom:14px;color:${TEXT}`;
        c.appendChild(h);
        const svg = select(c).append("svg").attr("width", W).attr("height", GRID_H + LEGEND_H);
        const g = svg.append("g");
        const model = mockModel(2025);
        const colors = buildColorAccessor(model, { mode, buckets, ramp: VIOLET_RAMP_LIGHT, noData: NO_DATA_LIGHT });
        const { geo } = renderGrid(g as any, model, {
            width: W, height: GRID_H, cellSize: 14, gapX: 3, gapY: 3, radius: 2,
            firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true, labelColor: MUTED,
        });
        renderLegend(g as any, {
            x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 16, gradientWidth: 120,
            colors, labelColor: MUTED, showNoData: true, idSuffix: `cmp-${mode}-${buckets}`,
        });
    };
    make("Linear scale — skewed data stays mostly pale", "linear", 0);
    make("Quantile, 5 buckets — the same data, finally readable", "quantile", 5);
}

/**
 * Day 03 — "the engine speaks": flagship year grid + the deterministic insight
 * card (generated sentences) + a YoY self-test chip showing the leap-year fix.
 * The four lines are the post's real generated output; the grid uses the real
 * render layer on seeded sample data.
 */
function engine(root: HTMLElement): void {
    const W = 980;
    const c = card(W);
    root.appendChild(c);

    // --- Top: flagship year grid + framed KPI header (same render layer as the visual) ---
    const gridH = 240;
    const svg = select(c).append("svg").attr("width", W - 8).attr("height", gridH);
    const g = svg.append("g");
    const model = mockTicketModel(2025);
    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5, ramp: VIOLET_RAMP_LIGHT, noData: NO_DATA_LIGHT,
    });
    const headerH = renderHeader(g as any, model, {
        width: W - 8, title: "Support tickets · 2025", align: "left",
        headline: { ...defaultText(16, TEXT), bold: true },
        stat: { ...defaultText(15, TEXT), bold: true },
        ruleShow: true, ruleColor: ACCENT, ruleWidth: 2,
        textColor: TEXT, mutedColor: MUTED,
    });
    const { geo } = renderGrid(g as any, model, {
        width: W - 8, height: gridH - 24, cellSize: 13, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor: MUTED, topOffset: headerH + 8,
    });
    renderLegend(g as any, {
        x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 14, gradientWidth: 120,
        colors, labelColor: MUTED, showNoData: true, idSuffix: "engine",
    });

    // --- Divider ---
    const hr = document.createElement("div");
    hr.style.cssText = "height:1px;background:#ECEAF3;margin:20px 0 16px;";
    c.appendChild(hr);

    // --- Lower row: insight card (left) + YoY self-test chip (right) ---
    const lower = document.createElement("div");
    lower.style.cssText = "display:flex;gap:28px;align-items:center;";

    const leftCol = document.createElement("div");
    leftCol.style.cssText = "flex:1 1 auto;max-width:640px;";
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "INSIGHTS · generated, not hand-written";
    eyebrow.style.cssText = `font-size:11px;letter-spacing:.12em;font-weight:700;color:${ACCENT};margin-bottom:13px;`;
    leftCol.appendChild(eyebrow);
    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:11px;";
    const lines = [
        "Fridays consistently averaged 22% above baseline — a repeatable weekly pattern.",
        "Aug 18 stood out at 14 — well above a typical day.",
        "Longest inactive streak lasted 9 days.",
        "Tickets are up 14% vs 2024 so far (through May).",
    ];
    lines.forEach((t, i) => {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;align-items:flex-start;gap:11px;font-size:15px;color:${TEXT};line-height:1.45;`;
        const dot = document.createElement("span");
        dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:50%;margin-top:6px;background:${i === 3 ? ACCENT : "#B9A8FF"};`;
        const span = document.createElement("span");
        span.textContent = t;
        row.appendChild(dot); row.appendChild(span);
        list.appendChild(row);
    });
    leftCol.appendChild(list);

    const chip = document.createElement("div");
    chip.style.cssText = "flex:0 0 auto;min-width:212px;background:#F8F7FD;border:1px solid #ECEAF3;" +
        "border-radius:12px;padding:14px 16px;box-shadow:0 4px 14px rgba(20,16,60,.06);";
    const chipLabel = document.createElement("div");
    chipLabel.textContent = "YoY UNIT TEST";
    chipLabel.style.cssText = `font-size:10px;letter-spacing:.12em;font-weight:700;color:${MUTED};margin-bottom:9px;`;
    const chipRow = document.createElement("div");
    chipRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:17px;font-weight:700;";
    const bad = document.createElement("span");
    bad.textContent = "+99.45%";
    bad.style.cssText = "color:#D64545;text-decoration:line-through;";
    const arrow = document.createElement("span");
    arrow.textContent = "→";
    arrow.style.cssText = `color:${MUTED};font-weight:400;`;
    const good = document.createElement("span");
    good.textContent = "+100.0%";
    good.style.cssText = "color:#1F9D55;";
    const check = document.createElement("span");
    check.textContent = "✓";
    check.style.cssText = "color:#1F9D55;font-size:15px;";
    chipRow.append(bad, arrow, good, check);
    const chipCap = document.createElement("div");
    chipCap.textContent = "leap year fixed · 134 tests green";
    chipCap.style.cssText = `font-size:11px;color:${MUTED};margin-top:9px;`;
    chip.append(chipLabel, chipRow, chipCap);

    lower.append(leftCol, chip);
    c.appendChild(lower);
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-127 — LinkedIn Image 1: Multi-Year Forest
// Canvas: 1200 x 627, 48 px safe margin.  Hash: #multiyear
// ─────────────────────────────────────────────────────────────────────────────
function multiyear(root: HTMLElement): void {
    const FOREST_RAMP = ["#E8F5E9", "#A5D6A7", "#66BB6A", "#388E3C", "#1B5E20"];
    const NO_DATA = "#E6E6EC";
    const TEXT_COL = "#1A1A22";
    const MUTED = "#70707F";

    // Reset body so no host padding/gradient shows through
    document.body.style.cssText = "margin:0;padding:0;background:#FFFFFF;";

    // Full-canvas shell — 1200 x 627 white card
    const shell = document.createElement("div");
    shell.style.cssText = [
        "width:1200px", "height:627px", "box-sizing:border-box",
        "padding:48px", "background:#FFFFFF",
        "font-family:Segoe UI,-apple-system,sans-serif",
        "display:flex", "flex-direction:column",
        "position:relative", "overflow:hidden",
    ].join(";");
    root.appendChild(shell);

    // Eyebrow
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "ZENTRIX CALENDAR HEATMAP";
    eyebrow.style.cssText = `font-size:11px;letter-spacing:0.12em;color:${MUTED};margin-bottom:6px;font-weight:400;`;
    shell.appendChild(eyebrow);

    // Title
    const title = document.createElement("div");
    title.textContent = "Two years. One visual.";
    title.style.cssText = `font-size:22px;font-weight:700;color:${TEXT_COL};margin-bottom:4px;line-height:1.2;`;
    shell.appendChild(title);

    // Subtitle
    const subtitle = document.createElement("div");
    subtitle.textContent = "No more 12-panel workarounds — see 2024 and 2025 side by side.";
    subtitle.style.cssText = `font-size:14px;color:${MUTED};margin-bottom:16px;`;
    shell.appendChild(subtitle);

    // Grid area: inner width 1104px (1200 - 2×48), height 400px
    const W = 1104, GRID_H = 400;
    const svgWrap = document.createElement("div");
    svgWrap.style.cssText = "flex:1 1 auto;";
    shell.appendChild(svgWrap);

    // Build two-year model with "Daily commits" label
    const days2yr = enumerateDays(new Date(2024, 0, 1), new Date(2025, 11, 31));
    const { rows, cols, weeks } = layout(days2yr, 0);
    const labels = monthLabels(days2yr, cols);
    const rnd2 = seeded(7);
    let vMin = Infinity, vMax = -Infinity;
    const cells2yr: DayCell[] = days2yr.map((date, i) => {
        const value = Math.round(Math.pow(rnd2(), 3) * 400);
        vMin = Math.min(vMin, value); vMax = Math.max(vMax, value);
        return { date, value, noData: false, col: cols[i], row: rows[i], selectionId: null, sourceIndex: i };
    });
    const model2yr: CalendarModel = {
        days: cells2yr, monthLabels: labels,
        range: [days2yr[0], days2yr[days2yr.length - 1]],
        valueDomain: [vMin, vMax], weeks, hasToday: false,
        valueName: "Daily commits", totalDays: days2yr.length,
    };

    const colors = buildColorAccessor(model2yr, {
        mode: "quantile", buckets: 5, ramp: FOREST_RAMP, noData: NO_DATA,
    });
    const svg = select(svgWrap).append("svg").attr("width", W).attr("height", GRID_H);
    const g = svg.append("g");
    const { geo } = renderGrid(g as any, model2yr, {
        width: W, height: GRID_H - 30, cellSize: 14, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor: MUTED, strongColor: TEXT_COL,
        yearStyle: { family: "Segoe UI,sans-serif", size: 14, bold: true, italic: false, underline: false, color: TEXT_COL },
    });
    renderLegend(g as any, {
        x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 12,
        availableWidth: geo.gridWidth, align: "start",
        swatchSize: 12, gradientLength: 120,
        colors, labelColor: MUTED,
        showLabels: true, lessLabel: "Less", moreLabel: "More",
        showNoData: true, noDataSide: "right", title: "",
        idSuffix: "multiyear",
    });

    // Callout pill — lower-right, inside safe margin
    const pill = document.createElement("div");
    pill.textContent = "730 days  |  1 visual  |  0 duplicates";
    pill.style.cssText = [
        "position:absolute", "right:48px", "bottom:48px",
        "background:#E8F5E9", "border:1px solid #A5D6A7",
        "border-radius:9999px", "padding:8px 18px",
        "font-size:13px", "font-weight:600", "color:#388E3C",
        "font-family:Segoe UI,-apple-system,sans-serif",
        "white-space:nowrap",
    ].join(";");
    shell.appendChild(pill);
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-127 — LinkedIn Image 2: Insight Card (Ocean Dark)
// Canvas: 1200 x 627, 48 px safe margin.  Hash: #engine-ocean
// ─────────────────────────────────────────────────────────────────────────────
function engineOcean(root: HTMLElement): void {
    const OCEAN_RAMP = ["#0E2233", "#16466B", "#2E7DC4", "#5BAEE0", "#A8D5F2"];
    const NO_DATA = NO_DATA_DARK;     // "#1C1C26"
    const BG = "#0F0F16";
    const TEXT_COL = "#F4F4F6";
    const MUTED = "#8A8A99";
    const ACCENT = "#5BAEE0";

    // Reset body so no host padding/gradient shows through
    document.body.style.cssText = "margin:0;padding:0;background:#080810;";

    // Full-canvas shell — 1200 x 627 dark card
    const shell = document.createElement("div");
    shell.style.cssText = [
        "width:1200px", "height:627px", "box-sizing:border-box",
        "padding:48px", `background:${BG}`,
        "font-family:Segoe UI,-apple-system,sans-serif",
        "display:flex", "flex-direction:column",
        "position:relative", "overflow:hidden",
    ].join(";");
    root.appendChild(shell);

    // Eyebrow
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "ZENTRIX CALENDAR HEATMAP";
    eyebrow.style.cssText = `font-size:11px;letter-spacing:0.12em;color:${MUTED};margin-bottom:6px;font-weight:400;`;
    shell.appendChild(eyebrow);

    // Title
    const title = document.createElement("div");
    title.textContent = "The calendar that tells you what it found.";
    title.style.cssText = `font-size:22px;font-weight:700;color:${TEXT_COL};margin-bottom:12px;line-height:1.2;`;
    shell.appendChild(title);

    // Grid — full width 1104, single year 2025 ocean-dark
    const W = 1104, GRID_H = 240;
    const svgWrap = document.createElement("div");
    shell.appendChild(svgWrap);

    const model = mockTicketModel(2025);
    // Update valueName to "Support tickets"
    model.valueName = "Support tickets";

    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5, ramp: OCEAN_RAMP, noData: NO_DATA,
    });
    const svg = select(svgWrap).append("svg").attr("width", W).attr("height", GRID_H);
    const g = svg.append("g");
    const headerH = renderHeader(g as any, model, {
        width: W, title: "Support tickets · 2025", align: "left",
        headline: { ...defaultText(16, TEXT_COL), bold: true },
        stat: { ...defaultText(15, TEXT_COL), bold: true },
        ruleShow: true, ruleColor: ACCENT, ruleWidth: 2,
        textColor: TEXT_COL, mutedColor: MUTED,
    });
    const { geo } = renderGrid(g as any, model, {
        width: W, height: GRID_H - 24, cellSize: 13, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor: MUTED, topOffset: headerH + 8,
    });
    renderLegend(g as any, {
        x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 12,
        availableWidth: geo.gridWidth, align: "start",
        swatchSize: 12, gradientLength: 120,
        colors, labelColor: MUTED,
        showLabels: true, lessLabel: "Less", moreLabel: "More",
        showNoData: true, noDataSide: "right", title: "",
        idSuffix: "engine-ocean",
    });

    // Divider
    const divider = document.createElement("div");
    divider.style.cssText = `height:1px;background:rgba(255,255,255,0.08);margin:12px 0;`;
    shell.appendChild(divider);

    // Insight section
    const insightEyebrow = document.createElement("div");
    insightEyebrow.textContent = "INSIGHTS · generated, not hand-written";
    insightEyebrow.style.cssText = `font-size:11px;letter-spacing:0.12em;font-weight:700;color:${ACCENT};margin-bottom:10px;`;
    shell.appendChild(insightEyebrow);

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:10px;";
    const lines = [
        "Fridays consistently averaged 22% above baseline — a repeatable weekly pattern.",
        "Aug 18 stood out at 14 — well above a typical day.",
        "Longest inactive streak lasted 9 days.",
        "Tickets are up 14% vs 2024 so far (through May).",
    ];
    lines.forEach((t, i) => {
        const row = document.createElement("div");
        row.style.cssText = `display:flex;align-items:flex-start;gap:11px;font-size:15px;color:${TEXT_COL};line-height:1.45;`;
        const dot = document.createElement("span");
        dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:50%;margin-top:6px;background:${i === 3 ? ACCENT : "#2E7DC4"};`;
        const span = document.createElement("span");
        span.textContent = t;
        row.appendChild(dot); row.appendChild(span);
        list.appendChild(row);
    });
    shell.appendChild(list);
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-149 — LinkedIn: CVD patterns "before / after" (Hash: #cvd / #patterns)
// Canvas: 1200 x 627 dark.  LEFT = color only, RIGHT = same data, color + texture.
//
// AUTHENTIC RENDER PATH — this is the whole point of the rejected-swatch redo:
//   • the heatmap is drawn by the SHIPPED `renderGrid` on a seeded realistic year;
//   • the texture is the SHIPPED `drawPattern`/`ensurePatternDef` from
//     src/render/patterns.ts, filling the SAME reusable <pattern> def the visual
//     uses, applied to threshold/rule cells via the real `cellBox(d)` geometry.
//   • Nothing here hand-draws pattern geometry. Texture marks threshold cells (a
//     second encoding channel); it does NOT encode intensity.
//
// Legibility: a full year at ~10px won't show texture, so we render a single
// QUARTER (Jul–Sep) at a large cell size on each side, plus a zoom inset of a few
// patterned cells so the hatch reads clearly and survives greyscale.
// ─────────────────────────────────────────────────────────────────────────────
function cvdPatterns(root: HTMLElement): void {
    const BG = "#0A0A0F";          // surfaceBase (token)
    const PANEL = "#16161F";       // surfaceCard (token)
    const BORDER = "#24242F";      // surfaceOverlay (token)
    const TEXT_COL = "#F4F4F6";    // textPrimary (token)
    const MUTED = "#A6A6B5";       // textSecondary (token)
    const FAINT = "#70707F";       // textTertiary (token)
    const ACCENT = "#7C5CFF";      // accent (token)

    document.body.style.cssText = "margin:0;padding:0;background:#080810;";

    const shell = document.createElement("div");
    shell.style.cssText = [
        "width:1200px", "height:627px", "box-sizing:border-box",
        "padding:44px 48px 40px", `background:${BG}`,
        "font-family:Segoe UI,-apple-system,sans-serif",
        "display:flex", "flex-direction:column",
        "position:relative", "overflow:hidden",
    ].join(";");
    root.appendChild(shell);

    // Eyebrow / headline / sub — heatmap is the hero, text is restrained.
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "ZENTRIX CALENDAR HEATMAP · ACCESSIBILITY";
    eyebrow.style.cssText = `font-size:11px;letter-spacing:0.14em;color:${FAINT};font-weight:600;margin-bottom:7px;`;
    shell.appendChild(eyebrow);

    const title = document.createElement("div");
    title.textContent = "Readable without relying on color.";
    title.style.cssText = `font-size:23px;font-weight:700;color:${TEXT_COL};line-height:1.15;margin-bottom:4px;`;
    shell.appendChild(title);

    const sub = document.createElement("div");
    sub.textContent = "The same data — high-value days carry a texture, so the standouts read even in greyscale or for color-blind viewers.";
    sub.style.cssText = `font-size:13px;color:${MUTED};margin-bottom:18px;`;
    shell.appendChild(sub);

    // Two side-by-side panels.
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:24px;flex:1 1 auto;";
    shell.appendChild(row);

    // One quarter, larger cells: Jul 1 – Sep 30. Right-skewed "Tickets resolved",
    // a Friday lift, a couple of gaps — the same generator family as the heroes.
    function quarterModel(): CalendarModel {
        const days = enumerateDays(new Date(2025, 6, 1), new Date(2025, 8, 30));
        const { rows, cols, weeks } = layout(days, 0);
        const labels = monthLabels(days, cols);
        const rnd = seeded(31);
        let vMin = Infinity, vMax = -Infinity;
        const cells: DayCell[] = days.map((date, i) => {
            const weekday = date.getDay();
            const noData = rnd() < 0.05;
            let value: number | null = null;
            if (!noData) {
                const weekendDamp = weekday === 0 || weekday === 6 ? 0.35 : 1;
                const fridayBoost = weekday === 5 ? 1.4 : 1;
                value = Math.round(Math.pow(rnd(), 2.2) * 400 * weekendDamp * fridayBoost);
                vMin = Math.min(vMin, value); vMax = Math.max(vMax, value);
            }
            return { date, value, noData, col: cols[i], row: rows[i], selectionId: null, sourceIndex: noData ? -1 : i };
        });
        return {
            days: cells, monthLabels: labels, range: [days[0], days[days.length - 1]],
            valueDomain: [vMin, vMax], weeks, hasToday: false,
            valueName: "Tickets resolved", totalDays: days.length,
        };
    }

    // Threshold = the "high-value" rule that drives the texture cue. Set to the
    // top ~30% so the hatched set spans the brighter ramp buckets (#7C5CFF and
    // #B59CFF), not just the single palest one — the white hatch reads strongly on
    // #7C5CFF, which keeps both the panel and the zoom inset legible.
    const THRESHOLD_FRACTION = 0.70; // mark days above the 70th percentile of value.
    function thresholdValue(model: CalendarModel): number {
        const vals = model.days.filter(d => !d.noData && d.value != null).map(d => d.value!) .sort((a, b) => a - b);
        return vals[Math.floor(vals.length * THRESHOLD_FRACTION)] ?? Infinity;
    }

    const GRID_W = 528, GRID_H = 300;

    function panel(label: string, withTexture: boolean): { svg: any; geo: any; model: CalendarModel; thr: number; } {
        const col = document.createElement("div");
        col.style.cssText = `flex:1 1 0;background:${PANEL};border:1px solid ${BORDER};border-radius:14px;padding:18px 20px 16px;display:flex;flex-direction:column;`;
        row.appendChild(col);

        const cap = document.createElement("div");
        cap.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:12px;";
        const chip = document.createElement("span");
        chip.textContent = withTexture ? "COLOR + TEXTURE" : "COLOR ONLY";
        chip.style.cssText = `font-size:10px;letter-spacing:0.1em;font-weight:700;padding:3px 9px;border-radius:9999px;` +
            (withTexture
                ? `color:${TEXT_COL};background:${ACCENT};`
                : `color:${MUTED};background:${BORDER};`);
        const capLabel = document.createElement("span");
        capLabel.textContent = label;
        capLabel.style.cssText = `font-size:12px;color:${MUTED};`;
        cap.append(chip, capLabel);
        col.appendChild(cap);

        const svgWrap = document.createElement("div");
        svgWrap.style.cssText = "flex:1 1 auto;";
        col.appendChild(svgWrap);

        const model = quarterModel();
        const colors = buildColorAccessor(model, {
            mode: "quantile", buckets: 5, ramp: VIOLET_RAMP_DARK, noData: NO_DATA_DARK,
        });
        const svg = select(svgWrap).append("svg").attr("width", GRID_W).attr("height", GRID_H);
        const g = svg.append("g");
        const { geo } = renderGrid(g as any, model, {
            width: GRID_W, height: GRID_H, cellSize: 30, gapX: 5, gapY: 5, radius: 3,
            firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
            labelColor: FAINT, strongColor: TEXT_COL,
        });
        renderLegend(g as any, {
            x: geo.marginLeft, y: geo.marginTop + geo.gridHeight + 18,
            availableWidth: geo.gridWidth, align: "start",
            swatchSize: 12, gradientLength: 110,
            colors, labelColor: FAINT,
            showLabels: true, lessLabel: "Less", moreLabel: "More",
            showNoData: true, noDataSide: "right", title: "",
            idSuffix: withTexture ? "cvd-after" : "cvd-before",
        });

        const thr = thresholdValue(model);

        if (withTexture) {
            // REAL pattern path: one <defs>, one reusable <pattern> def per bucket,
            // a single fill-rect overlay per threshold cell — exactly the shipped
            // visual's call. dark=true (dark theme → light hatch).
            const defs = g.append("defs") as any;
            const overlay = g.append("g").attr("class", "pattern-overlay") as any;
            model.days.forEach(d => {
                if (!d.noData && d.value != null && d.value >= thr) {
                    drawPattern(defs, overlay, cellBox(d), true, "diagonal");
                }
            });
        }
        return { svg, geo, model, thr };
    }

    panel("Jul–Sep · Tickets resolved", false);
    const after = panel("Jul–Sep · same data", true);

    // ── Zoom inset (proof the texture reads): take a 3×3 block of cells from the
    // AFTER grid around a patterned high-value day, magnify it, and re-draw using
    // the SAME drawPattern so the hatch is unmistakable at large scale.
    const ZS = 30, ZG = 6;          // inset cell size / gap
    const ZGRID = 3 * ZS + 2 * ZG;  // 3×3 grid extent = 102px
    const inset = document.createElement("div");
    inset.style.cssText = [
        "position:absolute", "right:30px", "bottom:30px",
        `width:${ZGRID + 24}px`,
        `background:${BG}`, `border:1.5px solid ${ACCENT}`,
        "border-radius:12px", "box-shadow:0 10px 28px rgba(0,0,0,0.45)",
        "padding:11px 12px 12px", "box-sizing:border-box",
    ].join(";");
    shell.appendChild(inset);

    const insetLabel = document.createElement("div");
    insetLabel.textContent = "zoom · high-value = hatched";
    insetLabel.style.cssText = `font-size:9px;letter-spacing:0.05em;color:${MUTED};margin-bottom:7px;white-space:nowrap;`;
    inset.appendChild(insetLabel);

    // Pick the threshold cell whose 3×3 neighborhood holds the MOST other
    // threshold cells, so the inset shows several hatched days together (teaches
    // "hatched = high-value"). All cells shown are real threshold cells getting
    // the real drawPattern — no cherry-picking the geometry, only the framing.
    const zcolors = buildColorAccessor(after.model, {
        mode: "quantile", buckets: 5, ramp: VIOLET_RAMP_DARK, noData: NO_DATA_DARK,
    });
    const isThr = (d: DayCell) => !d.noData && d.value != null && d.value! >= after.thr;
    const thrCells = after.model.days.filter(isThr);
    const neighborCount = (c: DayCell) => after.model.days.filter(d =>
        isThr(d) && Math.abs(d.col - c.col) <= 1 && Math.abs(d.row - c.row) <= 1).length;
    // The light-on-dark hatch reads best on MID-tone fills; on the very lightest
    // bucket (#B59CFF) the near-white hatch washes out. So score each candidate by
    // how many of its 3×3 neighbors are *hatched AND mid-tone* (i.e. the texture
    // visibly reads), and center the zoom there. Every cell shown is still a real
    // threshold cell drawn by the real drawPattern — we only pick the framing that
    // makes the accessibility point honestly legible.
    const palest = VIOLET_RAMP_DARK[VIOLET_RAMP_DARK.length - 1].toLowerCase();
    const readsHatched = (c: DayCell) => isThr(c) && zcolors.of(c).toLowerCase() !== palest;
    const legibleNeighbors = (c: DayCell) => after.model.days.filter(d =>
        readsHatched(d) && Math.abs(d.col - c.col) <= 1 && Math.abs(d.row - c.row) <= 1).length;
    // Center the zoom on a hatched cell whose own fill is the high-contrast bucket
    // and that has the most other legible hatched neighbors.
    const peak = thrCells.slice()
        .filter(readsHatched)
        .sort((a, b) => legibleNeighbors(b) - legibleNeighbors(a)
            || neighborCount(b) - neighborCount(a))[0]
        ?? thrCells.slice().sort((a, b) => neighborCount(b) - neighborCount(a))[0];
    const zsvg = select(inset).append("svg").attr("width", ZGRID).attr("height", ZGRID);
    const zg = zsvg.append("g");
    const zdefs = zg.append("defs") as any;
    // Cells first, THEN the pattern overlay on top — same z-order the real grid
    // uses (drawPattern's overlay group is created after the cell rects). If the
    // overlay were created before the cells, the cell fills would paint over the
    // hatch and hide it.
    if (peak) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const cell = after.model.days.find(d => d.col === peak.col + dc && d.row === peak.row + dr);
                const x = (dc + 1) * (ZS + ZG);
                const y = (dr + 1) * (ZS + ZG);
                const fill = cell ? zcolors.of(cell) : NO_DATA_DARK;
                zg.append("rect").attr("x", x).attr("y", y).attr("width", ZS).attr("height", ZS)
                    .attr("rx", 4).attr("ry", 4).attr("fill", fill);
            }
        }
    }
    const zoverlay = zg.append("g") as any;
    if (peak) {
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                const cell = after.model.days.find(d => d.col === peak.col + dc && d.row === peak.row + dr);
                const x = (dc + 1) * (ZS + ZG);
                const y = (dr + 1) * (ZS + ZG);
                if (cell && !cell.noData && cell.value != null && cell.value >= after.thr) {
                    drawPattern(zdefs, zoverlay, { x, y, size: ZS }, true, "diagonal");
                }
            }
        }
    }
    // The inset is a SEPARATE <svg> root, so its drawPattern def shares the
    // deterministic id `zx-pat-diagonal-d-N` with the after-panel's def. Two
    // elements with the same id => every `url(#id)` resolves to the FIRST in
    // document order (the after-panel's, in a different SVG), so the inset's
    // tiling came out empty. Re-namespace the inset's OWN def + its references to
    // a unique id so it resolves locally. The tile geometry is still 100% from
    // the real ensurePatternDef/paintTile — we only rename, never redraw it.
    zdefs.selectAll<SVGPatternElement, unknown>("pattern").each(function () {
        const oldId = this.getAttribute("id")!;
        const newId = `${oldId}-inset`;
        this.setAttribute("id", newId);
        zoverlay.selectAll<SVGRectElement, unknown>("rect").each(function () {
            if (this.getAttribute("fill") === `url(#${oldId})`)
                this.setAttribute("fill", `url(#${newId})`);
        });
    });

    // Footer handle (left, clear of the inset).
    const footer = document.createElement("div");
    footer.textContent = "zentrixstudio.in";
    footer.style.cssText = [
        "position:absolute", "left:48px", "bottom:18px",
        `color:${FAINT}`, "font-size:13px", "font-weight:600", "letter-spacing:0.02em",
    ].join(";");
    shell.appendChild(footer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────────────────────
const root = document.getElementById("root")!;
const which = (location.hash || "#reveal").slice(1);
try {
    if (which === "compare") compare(root);
    else if (which === "engine") engine(root);
    else if (which === "multiyear") multiyear(root);
    else if (which === "engine-ocean") engineOcean(root);
    else if (which === "cvd" || which === "patterns") cvdPatterns(root);
    else reveal(root);
} catch (e) {
    const el = document.getElementById("err");
    if (el) el.textContent = "CAUGHT: " + (e instanceof Error ? e.message + "\n" + e.stack : String(e));
}
