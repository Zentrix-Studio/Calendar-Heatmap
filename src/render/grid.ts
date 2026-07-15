"use strict";

import { Selection } from "d3";
import { CalendarModel, DayCell } from "../types";
import { ColorAccessor } from "./colors";
import { layout, monthLabels, MonthLabel, isoWeek, fiscalYearOf } from "../model/dateGrid";
import { TextStyle, applyText, defaultText } from "./text";
import { MIN_WEEKDAY_CELL, thinMonthLabels } from "./density";

/** A d3 selection of the <g> the grid draws into (host-agnostic). */
export type GroupSel = Selection<SVGGElement, unknown, any, any>;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Rows shown by default (GitHub convention): Mon / Wed / Fri. */
const SHOWN_WEEKDAY_OFFSETS = [1, 3, 5];

export interface GridOptions {
    width: number;
    height: number;
    /** Preferred cell edge in px; auto-fit shrinks (never grows) to fit. */
    cellSize: number;
    /** Horizontal gap between week columns. */
    gapX: number;
    /** Vertical gap between weekday rows. */
    gapY: number;
    radius: number;
    firstDayOfWeek: number;
    colors: ColorAccessor;
    showMonthLabels: boolean;
    showWeekdayLabels: boolean;
    /** ISO-8601 week numbers along each band's bottom edge (MVP-A). Auto-dropped
     * with the weekday rail when cells shrink past legibility. Default off. */
    showWeekNumbers?: boolean;
    /** Fiscal year start month 1..12 (MVP-B). >1 groups the year bands by fiscal
     * year (bands split at this month, labeled "FY yyyy"). 1/undefined = calendar. */
    fiscalStartMonth?: number;
    /** Label text color (theme-aware). */
    labelColor: string;
    /** Strong text color for year labels / emphasis. */
    strongColor?: string;
    /** Optional cell outline (used for high-contrast mode). */
    cellStroke?: string;
    /** Vertical offset (e.g. for a KPI header drawn above the grid). */
    topOffset?: number;
    /** Absolute canvas origin of the drawing box (for small-multiple tiles).
     * All cell/label coordinates are emitted relative to this so overlays — which
     * read the cells' absolute px/py — stay aligned. Defaults to 0,0. */
    originX?: number;
    originY?: number;
    /** Per-group text styles (fall back to sensible defaults if omitted). */
    monthStyle?: TextStyle;
    weekdayStyle?: TextStyle;
    yearStyle?: TextStyle;
}

export interface GridGeometry {
    size: number;
    /** Column pitch (size + gapX) and row pitch (size + gapY). */
    stepX: number;
    stepY: number;
    marginLeft: number;
    marginTop: number;
    /** Total drawn width/height of the cell area. */
    gridWidth: number;
    gridHeight: number;
}

export type CellSel = Selection<SVGRectElement, DayCell, SVGGElement, unknown>;

export interface RenderResult {
    geo: GridGeometry;
    /** The cell rects, for interaction/state binding. */
    cells: CellSel;
}

interface Band {
    year: number;
    days: DayCell[];
    rows: number[];
    cols: number[];
    weeks: number;
    labels: MonthLabel[];
}

/** Split the model's days into one band per year — calendar years by default, or
 * fiscal years when fiscalStartMonth > 1 (bands split at the fiscal start month,
 * MVP-B). Each band lays out its own weeks. */
function buildBands(model: CalendarModel, firstDayOfWeek: number, fiscalStartMonth = 1): Band[] {
    const byYear = new Map<number, DayCell[]>();
    for (const d of model.days) {
        const y = fiscalYearOf(d.date, fiscalStartMonth);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(d);
    }
    return [...byYear.keys()].sort((a, b) => a - b).map(year => {
        const days = byYear.get(year)!;
        const dates = days.map(d => d.date);
        const { rows, cols, weeks } = layout(dates, firstDayOfWeek);
        return { year, days, rows, cols, weeks, labels: monthLabels(dates, cols) };
    });
}

interface GridFit {
    size: number;
    stepX: number;
    stepY: number;
    marginLeft: number;
    headerH: number;
    /** Height reserved under each band for the ISO week-number rail (0 when off). */
    footerH: number;
}

/** Left margin for the band year tags. Fiscal tags ("FY 2024") are ~2× wider than
 * a bare year, and the tag shares its baseline row with the month rail — without
 * extra margin it paints over the band's first month label (UAT-4). Estimated
 * arithmetically (no getBBox: the render path must stay measurement-free). */
function yearTagMargin(base: number, multiYear: boolean, fiscalStart: number, yearSize: number): number {
    if (!multiYear || fiscalStart <= 1) return base;
    return Math.max(base, Math.ceil("FY 0000".length * yearSize * 0.62) + 10);
}

/** Pure cell-size fit for the stacked-year grid. Mirrors renderGrid's geometry
 * exactly so the responsive planner can predict the size without drawing.
 * Width is paced by the column gap (gapX), height by the row gap (gapY). */
function gridFit(bandsLen: number, maxWeeks: number, opts: GridOptions, width: number, height: number): GridFit {
    const { gapX, gapY } = opts;
    const multiYear = bandsLen > 1;
    const marginLeft = yearTagMargin(
        opts.showWeekdayLabels ? 32 : (multiYear ? 30 : 2),
        multiYear, opts.fiscalStartMonth ?? 1, (opts.yearStyle ?? { size: 11 }).size);
    const headerH = (opts.showMonthLabels || multiYear) ? 16 : 2;
    // Week-number rail: a per-band footer strip (MVP-A). Folded into the fit so
    // the predictor reserves it BEFORE drawing — the same no-trial-render contract
    // as every other chrome band.
    const footerH = opts.showWeekNumbers ? 13 : 0;
    const bandGap = 12;
    const top = opts.topOffset ?? 0;
    const availW = width - marginLeft - 4;
    const availH = height - top - 4;
    // Cell size: bounded by width (widest year, gapX) and total stacked height (gapY).
    const totalRows = bandsLen * 7;
    const headerTotal = bandsLen * (headerH + footerH) + (bandsLen - 1) * bandGap;
    const fitW = (availW + gapX) / maxWeeks - gapX;
    const fitH = (availH - headerTotal + gapY) / totalRows - gapY;
    const size = Math.max(3, Math.min(opts.cellSize, fitW, fitH));
    return { size, stepX: size + gapX, stepY: size + gapY, marginLeft, headerH, footerH };
}

/** One retry pass shared by predict + render: when cells shrink past legibility,
 * drop the weekday rail AND the week-number rail together and reclaim their space. */
function fitWithAutoDrop(bandsLen: number, maxWeeks: number, opts: GridOptions, width: number, height: number): { f: GridFit; opts: GridOptions } {
    let effective = opts;
    let f = gridFit(bandsLen, maxWeeks, effective, width, height);
    if ((effective.showWeekdayLabels || effective.showWeekNumbers) && f.size < MIN_WEEKDAY_CELL) {
        effective = { ...effective, showWeekdayLabels: false, showWeekNumbers: false };
        f = gridFit(bandsLen, maxWeeks, effective, width, height);
    }
    return { f, opts: effective };
}

/** Predict the cell size renderGrid would choose for this box — including the
 * weekday/week-number rail auto-drop — so chrome can be reserved without a trial render. */
export function predictGridSize(model: CalendarModel, opts: GridOptions, width: number, height: number): number {
    const bands = buildBands(model, opts.firstDayOfWeek, opts.fiscalStartMonth ?? 1);
    const maxWeeks = Math.max(1, ...bands.map(b => b.weeks));
    return fitWithAutoDrop(bands.length, maxWeeks, opts, width, height).f.size;
}

/**
 * Render the calendar grid (Direction C). Each calendar year is its own
 * vertically-stacked band — so a multi-year range reads as labeled year rows
 * (no repeating month strip), fills the available height, and the cells grow
 * larger than a single flat strip would allow. The whole stack is centered
 * vertically. Pure: no Power BI host; rings are drawn as overlays elsewhere.
 */
export function renderGrid(group: GroupSel, model: CalendarModel, opts: GridOptions): RenderResult {
    const { gapX, gapY } = opts;
    const fiscalStart = opts.fiscalStartMonth ?? 1;
    const bands = buildBands(model, opts.firstDayOfWeek, fiscalStart);
    const multiYear = bands.length > 1;
    const maxWeeks = Math.max(1, ...bands.map(b => b.weeks));
    const bandGap = 12;

    // Auto-drop the Mon/Wed/Fri rail + week-number rail when cells shrink past
    // legibility (the rows would touch) and reclaim their space so cells grow back.
    const fit = fitWithAutoDrop(bands.length, maxWeeks, opts, opts.width, opts.height);
    const showWeekday = fit.opts.showWeekdayLabels;
    const showWeekNums = !!fit.opts.showWeekNumbers;
    const { size, stepX, stepY, marginLeft, headerH, footerH } = fit.f;

    const oX = opts.originX ?? 0, oY = opts.originY ?? 0;
    const top = opts.topOffset ?? 0;
    const availW = opts.width - marginLeft - 4;
    const availH = opts.height - top - 4;
    const radius = Math.min(opts.radius, size * 0.5);

    const bandHeight = headerH + 7 * stepY - gapY + footerH;
    const totalHeight = bands.length * bandHeight + (bands.length - 1) * bandGap;
    const offsetY = oY + top + Math.max(0, (availH - totalHeight) / 2) + 2; // vertical centering
    const strong = opts.strongColor ?? opts.labelColor;

    // Horizontal centering: balance leftover width on both sides instead of a
    // lopsided right gap (visible in fullscreen). contentLeft is the grid's left edge.
    const gridContentW = maxWeeks * stepX - gapX;
    const ox = Math.max(0, (availW - gridContentW) / 2);
    const contentLeft = oX + marginLeft + ox;

    // Assign each day its pixel box within its band.
    bands.forEach((b, bi) => {
        const cellsTop = offsetY + bi * (bandHeight + bandGap) + headerH;
        b.days.forEach((d, i) => {
            d.px = contentLeft + b.cols[i] * stepX;
            d.py = cellsTop + b.rows[i] * stepY;
            d.ps = size;
        });
    });

    // Cells (single join across all bands — positions already assigned).
    const join = group.selectAll<SVGRectElement, DayCell>("rect.cell").data(model.days);
    join.exit().remove();
    const cells = join.enter().append("rect").classed("cell", true).merge(join)
        .attr("x", d => d.px!)
        .attr("y", d => d.py!)
        .attr("width", size).attr("height", size)
        .attr("rx", radius).attr("ry", radius)
        .attr("fill", d => opts.colors.of(d))
        .attr("stroke", opts.cellStroke ?? null)
        .attr("stroke-width", opts.cellStroke ? 1 : null);

    // Labels per band.
    group.selectAll("text.month, text.weekday, text.year, text.weeknum").remove();
    const monthStyle = opts.monthStyle ?? defaultText(10);
    const weekdayStyle = opts.weekdayStyle ?? defaultText(10);
    const yearStyle = opts.yearStyle ?? { ...defaultText(11), bold: true };
    const weekNumStyle = opts.weekdayStyle ?? defaultText(9);
    bands.forEach((b, bi) => {
        const bandTop = offsetY + bi * (bandHeight + bandGap);
        const cellsTop = bandTop + headerH;

        if (multiYear) {
            // Fiscal bands are labeled FY (numbered by the year the fiscal year
            // ends in) so an Apr–Mar band can't be misread as a calendar year.
            applyText(group.append("text").classed("year", true)
                .attr("x", oX + ox + 2).attr("y", bandTop + headerH - 4)
                .text(fiscalStart > 1 ? `FY ${b.year}` : String(b.year)), yearStyle, strong);
        }

        if (opts.showMonthLabels) {
            // Thin labels greedily so names never overlap as cells shrink: keep
            // Jan, drop the months that would collide, keep the next that clears.
            for (const l of thinMonthLabels(b.labels, stepX, monthStyle.size)) {
                applyText(group.append("text").classed("month", true)
                    .attr("x", contentLeft + l.col * stepX).attr("y", bandTop + headerH - 4)
                    .text(l.label), monthStyle, opts.labelColor);
            }
        }

        if (showWeekday) {
            for (const row of SHOWN_WEEKDAY_OFFSETS) {
                applyText(group.append("text").classed("weekday", true)
                    .attr("x", contentLeft - 6).attr("y", cellsTop + row * stepY + size / 2)
                    .attr("text-anchor", "end").attr("dominant-baseline", "middle")
                    .text(WEEKDAY_NAMES[(row + opts.firstDayOfWeek) % 7]), weekdayStyle, opts.labelColor);
            }
        }

        if (showWeekNums) {
            // ISO week number under each week column, keyed to the column's first
            // day. Thinned by a fixed pitch so two-digit labels never collide as
            // cells shrink (mirrors the month-label thinning philosophy).
            const labelEvery = Math.max(1, Math.ceil((weekNumStyle.size * 1.9) / stepX));
            const firstDayIdxByCol = new Map<number, number>();
            b.days.forEach((_, i) => {
                const c = b.cols[i];
                if (!firstDayIdxByCol.has(c)) firstDayIdxByCol.set(c, i);
            });
            const footerY = cellsTop + 7 * stepY - gapY + footerH - 3;
            for (const [c, i] of firstDayIdxByCol) {
                if (c % labelEvery !== 0) continue;
                applyText(group.append("text").classed("weeknum", true)
                    .attr("x", contentLeft + c * stepX + size / 2).attr("y", footerY)
                    .attr("text-anchor", "middle")
                    .text(String(isoWeek(b.days[i].date))), weekNumStyle, opts.labelColor);
            }
        }
    });

    const geo: GridGeometry = {
        size, stepX, stepY, marginLeft: contentLeft, marginTop: offsetY,
        gridWidth: gridContentW,
        gridHeight: totalHeight,
    };
    return { geo, cells };
}
