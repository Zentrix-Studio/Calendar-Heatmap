"use strict";

import { GroupSel } from "./grid";
import { DayCell, FacetedRender } from "../types";
import { applyText, defaultText } from "./text";

/**
 * Summary table — an ALTERNATE full-screen view of the bound data, drawn instead
 * of (never alongside) the calendar grid. One row per month in single-grid mode,
 * one row per group when a Split-by category is bound, plus a bold all-rows Total.
 *
 * Layout is computed mathematically (fixed column shares, font-size-derived row
 * heights) and never measures text — the same constraint the grid drawers obey,
 * so the jsdom test harness keeps working (no getBBox in the render path).
 */

export interface SummaryTableOptions {
    width: number;
    height: number;
    /** Muted text (column headers, the truncation note). */
    labelColor: string;
    /** Primary text (row labels, values) — also the zebra-stripe base. */
    strongColor: string;
    /** Accent for the header underline (token-sourced by the caller). */
    accentColor: string;
    /** Display name of the value field — drives the table title. */
    valueName: string;
    /** Display name of the Split-by field (group mode); undefined = month mode. */
    categoryName?: string;
}

export interface SummaryTableResult {
    /** Rows actually drawn (excluding header and Total). */
    rowsShown: number;
    /** Rows the data produced before any height truncation. */
    rowsTotal: number;
}

interface SummaryRow {
    label: string;
    days: DayCell[];
}

interface RowStats {
    total: number | null;
    avg: number | null;
    max: number | null;
    min: number | null;
    n: number;
}

/** Compact, deterministic number formatting (mirrors the KPI-chip scale). */
function fmt(n: number | null): string {
    if (n == null || !isFinite(n)) return "–";
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    const isInt = Math.abs(n - Math.round(n)) < 1e-9;
    if (isInt) return Math.round(n).toLocaleString("en-US");
    return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function statsOf(days: DayCell[]): RowStats {
    let total = 0, max = -Infinity, min = Infinity, n = 0;
    for (const d of days) {
        if (d.value == null) continue;
        total += d.value;
        if (d.value > max) max = d.value;
        if (d.value < min) min = d.value;
        n++;
    }
    if (!n) return { total: null, avg: null, max: null, min: null, n: 0 };
    return { total, avg: total / n, max, min, n };
}

/** Group the drawn data into table rows: per facet (Split-by bound) or per month. */
function buildRows(input: FacetedRender): SummaryRow[] {
    if (input.facets.length > 1) {
        return input.facets.map(f => ({ label: f.key, days: f.model.days }));
    }
    const combined = input.combined;
    const multiYear = combined.range[0].getFullYear() !== combined.range[1].getFullYear();
    const byMonth = new Map<string, SummaryRow>();
    for (const d of combined.days) {
        const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        let row = byMonth.get(key);
        if (!row) {
            const month = d.date.toLocaleDateString("en-US", { month: "short" });
            row = { label: multiYear ? `${month} ${d.date.getFullYear()}` : month, days: [] };
            byMonth.set(key, row); // days are chronological → insertion order is row order
        }
        row.days.push(d);
    }
    return [...byMonth.values()];
}

const MARGIN = 16;
const TITLE_H = 30;
const HEADER_H = 24;
const ROW_H = 22;

export function renderSummaryTable(
    group: GroupSel, input: FacetedRender, opts: SummaryTableOptions,
): SummaryTableResult {
    const g = group.append("g").classed("summary-table", true);
    const rows = buildRows(input);

    const innerW = Math.max(120, opts.width - MARGIN * 2);
    const x0 = MARGIN;
    // Column plan: row label takes the biggest share; the five numeric columns
    // split the rest evenly and right-align on their column's right edge.
    const headers = [opts.categoryName || "Month", "Total", "Avg/day", "Max", "Min", "Days"];
    const labelW = Math.max(80, innerW * 0.24);
    const numW = (innerW - labelW) / (headers.length - 1);
    const colRight = (i: number) => x0 + labelW + i * numW + numW - 6;

    const titleStyle = defaultText(14, opts.strongColor);
    titleStyle.bold = true;
    const headStyle = defaultText(10, opts.labelColor);
    headStyle.bold = true;
    const bodyStyle = defaultText(11, opts.strongColor);
    const totalStyle = defaultText(11, opts.strongColor);
    totalStyle.bold = true;

    applyText(
        g.append("text").attr("x", x0).attr("y", MARGIN + 12).text(`${opts.valueName} — Summary`),
        titleStyle, opts.strongColor);

    // Header row + accent underline.
    const headY = MARGIN + TITLE_H;
    applyText(g.append("text").attr("x", x0).attr("y", headY + 14).text(headers[0]), headStyle, opts.labelColor);
    for (let i = 1; i < headers.length; i++) {
        applyText(g.append("text").attr("x", colRight(i - 1)).attr("y", headY + 14)
            .attr("text-anchor", "end").text(headers[i]), headStyle, opts.labelColor);
    }
    g.append("rect").attr("x", x0).attr("y", headY + HEADER_H - 4)
        .attr("width", innerW).attr("height", 2).attr("rx", 1)
        .attr("fill", opts.accentColor).attr("fill-opacity", 0.6);

    // How many data rows fit above the reserved Total row (+ truncation note line).
    const bodyY = headY + HEADER_H;
    const reservedBottom = ROW_H + MARGIN + 14; // Total row + note line + bottom margin
    const fit = Math.max(1, Math.floor((opts.height - bodyY - reservedBottom) / ROW_H));
    const shown = rows.slice(0, fit);

    const drawCells = (into: GroupSel, y: number, label: string, st: RowStats, style: typeof bodyStyle) => {
        const values = [fmt(st.total), fmt(st.avg), fmt(st.max), fmt(st.min), st.n ? String(st.n) : "–"];
        applyText(into.append("text").classed("sum-cell", true)
            .attr("x", x0).attr("y", y).text(label), style, opts.strongColor);
        values.forEach((v, i) => {
            applyText(into.append("text").classed("sum-cell", true)
                .attr("x", colRight(i)).attr("y", y).attr("text-anchor", "end").text(v),
            style, opts.strongColor);
        });
    };

    shown.forEach((row, i) => {
        const top = bodyY + i * ROW_H;
        if (i % 2 === 1) {
            g.append("rect").attr("x", x0).attr("y", top)
                .attr("width", innerW).attr("height", ROW_H).attr("rx", 2)
                .attr("fill", opts.strongColor).attr("fill-opacity", 0.05);
        }
        const rowG = g.append("g").classed("sum-row", true) as unknown as GroupSel;
        drawCells(rowG, top + 15, row.label, statsOf(row.days), bodyStyle);
    });

    // All-rows Total, separated by a hairline. Computed over EVERY row (not just
    // the drawn ones) so a truncated table never lies about the grand total.
    const allDays = rows.flatMap(r => r.days);
    const totalY = bodyY + shown.length * ROW_H;
    g.append("rect").attr("x", x0).attr("y", totalY)
        .attr("width", innerW).attr("height", 1)
        .attr("fill", opts.strongColor).attr("fill-opacity", 0.25);
    drawCells(g.append("g").classed("sum-total", true) as unknown as GroupSel,
        totalY + 16, "Total", statsOf(allDays), totalStyle);

    // Honest note (spec §8 — never silently truncate).
    if (shown.length < rows.length) {
        applyText(g.append("text").classed("sum-note", true)
            .attr("x", x0 + innerW).attr("y", totalY + ROW_H + 14)
            .attr("text-anchor", "end")
            .text(`Showing first ${shown.length} of ${rows.length} rows`),
        defaultText(10, opts.labelColor), opts.labelColor);
    }

    return { rowsShown: shown.length, rowsTotal: rows.length };
}
