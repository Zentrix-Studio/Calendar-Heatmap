"use strict";

import { GroupSel, GridOptions, GridGeometry, CellSel, RenderResult } from "./grid";
import { CalendarModel, DayCell } from "../types";
import { weekdayRow } from "../model/dateGrid";
import { applyText, defaultText } from "./text";
import { MIN_MONTHLABEL_CELL } from "./density";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = 7;
const MAX_WEEKS = 6; // a month spans at most 6 week-columns

interface MonthGroup { key: string; label: string; days: DayCell[]; }

/**
 * Pick how many month panels go in a row. Rather than a fixed 4-wide grid
 * (which leaves the right half of a wide viewport empty), try every column
 * count and keep the one that lets panels grow largest for this aspect ratio —
 * so the panels spread to fill the canvas. Returns the chosen column count.
 */
function pickColumns(count: number, availW: number, availH: number, panelGap: number, labelH: number): number {
    let best = 1, bestSize = -Infinity;
    for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const panelInnerW = (availW - panelGap * (cols - 1)) / cols;
        const panelInnerH = (availH - panelGap * (rows - 1)) / rows - labelH;
        if (panelInnerW <= 0 || panelInnerH <= 0) continue;
        const fitW = panelInnerW / MAX_WEEKS;
        const fitH = panelInnerH / WEEKDAYS;
        const size = Math.min(fitW, fitH);
        // Prefer the largest cell; on ties prefer fewer columns (more compact).
        if (size > bestSize + 0.01) { bestSize = size; best = cols; }
    }
    return best;
}

/** Pure size/column fit for the month-block layout (mirrors renderMonthBlocks). */
function fitFor(monthsLen: number, opts: GridOptions, width: number, height: number, labelH: number): { size: number; cols: number } {
    const panelGap = 14, marginLeft = 2;
    const marginTop = (opts.topOffset ?? 0) + 2;
    const availW = width - marginLeft - 4;
    const availH = height - marginTop - 4;
    const cols = pickColumns(monthsLen, availW, availH, panelGap, labelH);
    const rowsOfPanels = Math.ceil(monthsLen / cols);
    const panelInnerW = (availW - panelGap * (cols - 1)) / cols;
    const panelInnerH = (availH - panelGap * (rowsOfPanels - 1)) / rowsOfPanels - labelH;
    const fitW = (panelInnerW + opts.gap) / MAX_WEEKS - opts.gap;
    const fitH = (panelInnerH + opts.gap) / WEEKDAYS - opts.gap;
    const size = Math.max(3, Math.min(opts.cellSize, fitW, fitH));
    return { size, cols };
}

/** Predict the month-block cell size for this box — including the month-label
 * auto-hide — so chrome can be reserved without a trial render. */
export function predictMonthBlocksSize(model: CalendarModel, opts: GridOptions, width: number, height: number): number {
    const monthsLen = groupByMonth(model.days).length;
    let { size } = fitFor(monthsLen, opts, width, height, opts.showMonthLabels ? 16 : 2);
    if (opts.showMonthLabels && size < MIN_MONTHLABEL_CELL) size = fitFor(monthsLen, opts, width, height, 2).size;
    return size;
}

/**
 * Group the model's days into months in render order. When the data spans more
 * than one calendar year, the year is stamped on the first month of each year
 * ("Jan 2024 … Dec, Jan 2025 … Dec") so the repeated month names stay
 * unambiguous; single-year data is labelled by month name only.
 * Exported for testing.
 */
export function groupByMonth(days: DayCell[]): MonthGroup[] {
    const groups: MonthGroup[] = [];
    if (days.length === 0) return groups;
    const firstYear = days[0].date.getFullYear();
    const multiYear = days.some(d => d.date.getFullYear() !== firstYear);
    let last = "";
    let stampedYear: number | null = null;
    for (const d of days) {
        const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        if (key !== last) {
            const y = d.date.getFullYear(), m = d.date.getMonth();
            // First month of a new year in a multi-year range carries the year.
            const stamp = multiYear && y !== stampedYear;
            groups.push({ key, label: stamp ? `${MONTH_NAMES[m]} ${y}` : MONTH_NAMES[m], days: [] });
            if (stamp) stampedYear = y;
            last = key;
        }
        groups[groups.length - 1].days.push(d);
    }
    return groups;
}

/**
 * Direction B — month-block layout. Each month is a mini calendar (weeks ×
 * weekdays); panels flow left→right, top→bottom in an adaptive grid whose
 * column count is chosen to fill the viewport (see pickColumns). Stronger
 * month boundaries, better for fiscal/quarter reads (design ref panel B).
 * Assigns each cell's pixel box (px/py/ps) so interactions work unchanged.
 */
export function renderMonthBlocks(group: GroupSel, model: CalendarModel, opts: GridOptions): RenderResult {
    const months = groupByMonth(model.days);

    const oX = opts.originX ?? 0, oY = opts.originY ?? 0;
    const panelGap = 14;
    const marginLeft = 2, marginTop = (opts.topOffset ?? 0) + 2;

    const availW = opts.width - marginLeft - 4;
    const availH = opts.height - marginTop - 4;

    // Adaptive grid: choose the panels-per-row that fills this viewport best,
    // then auto-fit cell size to it (capped at the preferred cellSize). When the
    // panels get too small to caption, drop the month labels and reclaim the
    // label strip for the cells (re-fit with a minimal label height).
    let showMonth = opts.showMonthLabels;
    let labelH = showMonth ? 16 : 2;
    let fit = fitFor(months.length, opts, opts.width, opts.height, labelH);
    if (showMonth && fit.size < MIN_MONTHLABEL_CELL) {
        showMonth = false;
        labelH = 2;
        fit = fitFor(months.length, opts, opts.width, opts.height, labelH);
    }
    const { size, cols } = fit;
    const rowsOfPanels = Math.ceil(months.length / cols);
    const step = size + opts.gap;
    const radius = Math.min(opts.radius, size * 0.18);
    const panelW = MAX_WEEKS * step - opts.gap;
    const panelH = WEEKDAYS * step - opts.gap;
    const cellPx = (panelW + panelGap), cellPy = (panelH + labelH + panelGap);

    // Center the panel block in the available area so leftover space (e.g. when
    // cells hit the cellSize cap) is balanced on both sides, not dumped on the right.
    const usedCols = Math.min(cols, months.length);
    const gridW = usedCols * cellPx - panelGap;
    const gridH = rowsOfPanels * cellPy - panelGap;
    const originX = oX + marginLeft + Math.max(0, (availW - gridW) / 2);
    const originY = oY + marginTop + Math.max(0, (availH - gridH) / 2);

    // Assign each day's pixel box within its month panel.
    months.forEach((m, mi) => {
        const panelX = originX + (mi % cols) * cellPx;
        const panelY = originY + Math.floor(mi / cols) * cellPy + labelH;
        let col = 0;
        m.days.forEach((d, di) => {
            const row = weekdayRow(d.date, opts.firstDayOfWeek);
            if (di > 0 && row === 0) col++;
            d.px = panelX + col * step;
            d.py = panelY + row * step;
            d.ps = size;
        });
    });

    // Cells.
    const join = group.selectAll<SVGRectElement, DayCell>("rect.cell").data(model.days);
    join.exit().remove();
    const cells = join.enter().append("rect").classed("cell", true).merge(join)
        .attr("x", d => d.px!).attr("y", d => d.py!)
        .attr("width", size).attr("height", size)
        .attr("rx", radius).attr("ry", radius)
        .attr("fill", d => opts.colors.of(d))
        .attr("stroke", opts.cellStroke ?? null)
        .attr("stroke-width", opts.cellStroke ? 1 : null) as CellSel;

    // Month labels.
    if (showMonth) {
        const labels = months.map((m, mi) => ({
            label: m.label,
            x: originX + (mi % cols) * cellPx,
            y: originY + Math.floor(mi / cols) * cellPy + labelH - 4,
        }));
        const monthStyle = opts.monthStyle ?? defaultText(10);
        const ml = group.selectAll<SVGTextElement, typeof labels[0]>("text.month").data(labels);
        const merged = ml.enter().append("text").classed("month", true).merge(ml)
            .attr("x", d => d.x).attr("y", d => d.y)
            .text(d => d.label);
        applyText(merged as any, monthStyle, opts.labelColor);
        ml.exit().remove();
    }

    const geo: GridGeometry = {
        size, step, marginLeft: originX, marginTop: originY,
        gridWidth: gridW,
        gridHeight: gridH,
    };
    return { geo, cells };
}
