"use strict";

/**
 * What the Export menu writes (HM-V2-30) — the calendar's counterpart to the Sankey's
 * `exportCsv.ts` (nodes + flows) and the Network Graph's (nodes + edges).
 *
 * The tables mirror the Table view, so a file says what the screen says:
 *   · Days   — one row per day with data: date, weekday, value, vs average, and the
 *              Target / Holiday / Event columns when those fields are bound.
 *   · Months — the Table's month grain: total, average per day, best, lowest, days,
 *              share of the total.
 *   · Groups — the Table's group grain, only when a Split-by is bound.
 *
 * Raw numbers, not display strings: a spreadsheet must be able to sum the Value
 * column, so Labels › Numbers (units, decimals) is deliberately NOT applied here.
 * Dates are ISO (YYYY-MM-DD, local) so Excel and every CSV reader parse them as dates.
 *
 * Pure string assembly: no DOM, no Power BI imports, no network. The result goes to
 * the host's downloadService (privilege `ExportContent`); the tenant's export policy
 * is enforced host-side. RFC-4180 quoting.
 */

import { DayCell, FacetedRender } from "../types";
import { aggregateRows, statsOf } from "../render/summaryTable";
import { WEEKDAY_LONG } from "../render/viewChrome";

export type ExportRow = (string | number | null)[];
export interface ExportTable { name: string; rows: ExportRow[]; }

/**
 * Neutralise a text cell a spreadsheet would run as a formula (zentrix-qa#14, OWASP
 * "CSV injection"): a leading = + - @ tab or CR gets a ' in front, which Excel and
 * Sheets treat as "this is text". Quoting alone does not stop a leading "=". Numbers are
 * written as numbers and never touched — a negative value stays a negative value.
 */
export function safeText(s: string): string {
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Quote a CSV cell when needed (comma, quote, newline). */
function cell(v: string | number | null | undefined): string {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v) : safeText(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text, with a UTF-8 byte-order mark so Excel opens हिन्दी, 日本語 and emoji as
 *  written instead of guessing a legacy code page (zentrix-qa#14). */
export function toCsv(rows: ExportRow[]): string {
    return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

/** Round to two places for a file — averages printed 100.85714285714286 (zentrix-qa#5). */
function round2(n: number | null): number | null { return n == null ? null : Math.round(n * 100) / 100; }

function isoDate(d: Date): string {
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
}

/** Share / change as a percentage with one decimal (18.4 means 18.4 %). */
function pct(frac: number): number { return Math.round(frac * 1000) / 10; }

function hasValue(d: DayCell): boolean { return !d.noData && d.value != null && Number.isFinite(d.value); }

/** The Days table — the Table view's day grain. */
export function buildDayRows(input: FacetedRender): ExportRow[] {
    const c = input.combined;
    const days = c.days.filter(hasValue);
    const mean = days.length ? days.reduce((a, d) => a + (d.value as number), 0) / days.length : 0;
    const head: ExportRow = ["Date", "Weekday", c.valueName || "Value", "vs average (%)"];
    if (c.targetName) head.push(c.targetName, "vs target (%)");
    if (c.holidayName) head.push(c.holidayName);
    if (c.eventName) head.push(c.eventName);
    const rows: ExportRow[] = [head];
    for (const d of days) {
        const v = d.value as number;
        const row: ExportRow = [isoDate(d.date), WEEKDAY_LONG[d.date.getDay()], v, mean ? pct(v / mean - 1) : null];
        if (c.targetName) row.push(d.target ?? null, d.target ? pct(v / d.target - 1) : null);
        if (c.holidayName) row.push(d.holiday ?? "");
        if (c.eventName) row.push((d.events ?? []).join("; "));
        rows.push(row);
    }
    return rows;
}

/** A grouped table (Months / Groups) — the Table view's aggregate columns. */
function buildAggRows(input: FacetedRender, grain: "month" | "group", firstDayOfWeek: number, label: string): ExportRow[] {
    const groups = aggregateRows(input, grain, firstDayOfWeek);
    const stats = groups.map((g) => statsOf(g.days));
    const grand = stats.reduce((a, s) => a + s.total, 0);
    const rows: ExportRow[] = [[label, "Total", "Avg / day", "Best day", "Best day date", "Lowest", "Days with data", "% of total"]];
    groups.forEach((g, i) => {
        const s = stats[i];
        rows.push([g.label, s.total, round2(s.avg), s.max, s.best ? isoDate(s.best) : null, s.min, s.n, grand ? pct(s.total / grand) : null]);
    });
    return rows;
}

/** Every table the export writes, in order. */
export function buildExportTables(input: FacetedRender, firstDayOfWeek: number, categoryName?: string): ExportTable[] {
    const tables: ExportTable[] = [
        { name: "Days", rows: buildDayRows(input) },
        { name: "Months", rows: buildAggRows(input, "month", firstDayOfWeek, "Month") },
    ];
    if (input.facets.length > 1) {
        tables.push({ name: "Groups", rows: buildAggRows(input, "group", firstDayOfWeek, categoryName || "Group") });
    }
    return tables;
}

/** A file-name stem from the value field: "Ticket count" → "ticket-count". */
export function fileStem(valueName: string | undefined): string {
    const s = (valueName || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    return s ? `calendar-${s}` : "calendar-heatmap";
}
