/*
 * Hero screenshot harness — renders ONE clean flagship panel per load so we get
 * focused, shareable social images (not the full QA contact sheet).
 * Build: esbuild harness/hero.ts --bundle --outfile=harness/hero.js
 * Screenshot: open harness/hero.html#reveal  or  #compare  in headless Chrome.
 */
import { select } from "d3";
import { enumerateDays, layout, monthLabels } from "../src/model/dateGrid";
import { CalendarModel, DayCell } from "../src/types";
import {
    buildColorAccessor, ScaleMode,
    VIOLET_RAMP_LIGHT, NO_DATA_LIGHT,
} from "../src/render/colors";
import { renderGrid } from "../src/render/grid";
import { renderHeader } from "../src/render/header";
import { renderLegend } from "../src/render/legend";
import { defaultText } from "../src/render/text";

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
        width: W, height: H - 24, cellSize: 14, gap: 3, radius: 2,
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
            width: W, height: GRID_H, cellSize: 14, gap: 3, radius: 2,
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
        width: W - 8, height: gridH - 24, cellSize: 13, gap: 3, radius: 2,
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

const root = document.getElementById("root")!;
const which = (location.hash || "#reveal").slice(1);
try {
    if (which === "compare") compare(root);
    else if (which === "engine") engine(root);
    else reveal(root);
} catch (e) {
    const el = document.getElementById("err");
    if (el) el.textContent = "CAUGHT: " + (e instanceof Error ? e.message + "\n" + e.stack : String(e));
}
