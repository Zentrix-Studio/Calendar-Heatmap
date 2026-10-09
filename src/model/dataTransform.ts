"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { CalendarModel, DayCell, MonthLabel, Facet, FacetedRender, AggregationMode, HourCell, HourModel } from "../types";
import { enumerateDays, layout, monthLabels } from "./dateGrid";
import { extractSeries } from "../insights/series";

export type { AggregationMode };

/** Render cap: beyond ~6 years, render the most recent window and surface a
 * "showing N of M" note (spec §8 — no silent truncation). */
const MAX_RENDER_DAYS = 2200;
/** Hard cap on facets so a high-cardinality Split-by can't melt the canvas;
 * excess categories are dropped with an honest note (no silent truncation). */
export const MAX_FACETS = 24;

/** Aggregated bucket for a single calendar day. */
interface DayAgg {
    value: number;
    /** First contributing row index (into the array passed to aggregateByDay). */
    firstIndex: number;
}

/** Normalize a raw category value (Date | epoch ms | ISO string) to local midnight. */
export function normalizeToLocalDay(raw: powerbi.PrimitiveValue): Date | null {
    if (raw == null) return null;
    const d: Date = raw instanceof Date ? raw : new Date(raw as string | number);
    if (isNaN(d.getTime())) return null;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Numeric epoch (local midnight) used as a Map key for a day. */
function dayKey(d: Date): number {
    return d.getTime();
}

/**
 * Collapse duplicate days into one aggregated value per the chosen mode.
 * Nulls are skipped; a day present only as nulls still yields a bucket with
 * value 0 for count, otherwise it is treated as no-data by the caller.
 */
export function aggregateByDay(
    dates: Date[], values: number[], mode: AggregationMode
): Map<number, DayAgg> {
    const sums = new Map<number, number>();
    const counts = new Map<number, number>();
    const firsts = new Map<number, number>();
    const mins = new Map<number, number>();
    const maxs = new Map<number, number>();

    for (let i = 0; i < dates.length; i++) {
        const v = values[i];
        // Non-finite (NaN/±Infinity) is unusable for aggregation AND poisons the
        // vMin/vMax color domain downstream (QA-01) — treat it exactly like null.
        if (v == null || !Number.isFinite(v)) continue;
        const k = dayKey(dates[i]);
        if (!firsts.has(k)) firsts.set(k, i);
        sums.set(k, (sums.get(k) ?? 0) + v);
        counts.set(k, (counts.get(k) ?? 0) + 1);
        mins.set(k, Math.min(mins.get(k) ?? Infinity, v));
        maxs.set(k, Math.max(maxs.get(k) ?? -Infinity, v));
    }

    const out = new Map<number, DayAgg>();
    for (const [k, firstIndex] of firsts) {
        const count = counts.get(k)!;
        let value: number;
        switch (mode) {
            case "avg": value = sums.get(k)! / count; break;
            case "min": value = mins.get(k)!; break;
            case "max": value = maxs.get(k)!; break;
            case "count": value = count; break;
            default: value = sums.get(k)!; // "sum"
        }
        out.set(k, { value, firstIndex });
    }
    return out;
}

/** A single source row, pre-parsed and index-aligned to the original columns. */
interface ParsedRow {
    date: Date;
    value: number;        // NaN when null/blank
    target: number;       // NaN when no Target field or blank
    /** Highlight value for this row from `values[].highlights[]`; NaN when the host
     * supplied no highlight array (the normal, non-cross-highlighted render). */
    highlight: number;
    category?: string;    // Split-by value, if the role is bound
    /** Optional text fields (HM-V2-10/11): trimmed, "" when blank or unbound. */
    holiday: string;
    event: string;
    eventType: string;
    /** Index into the original DataView columns — for selection IDs & tooltip reads. */
    origIndex: number;
}

/** Everything the assembler needs, resolved once from the DataView. */
interface ParsedDataView {
    rows: ParsedRow[];
    dateCategory: DataViewCategoryColumn;
    valueColumn: DataViewValueColumn;
    targetColumn: DataViewValueColumn | null;
    tooltipColumns: DataViewValueColumn[];
    categoryColumn: DataViewCategoryColumn | null;
    /** Optional text fields, null when unbound OR unusable (see `fieldIssues`). */
    holidayColumn: DataViewValueColumn | null;
    eventColumn: DataViewValueColumn | null;
    eventTypeColumn: DataViewValueColumn | null;
    fieldIssues: string[];
    /** True when the host supplied a `values[].highlights[]` array on the Value
     * column (external cross-highlight is active). When false, the render path is
     * identical to today — no dimming, no highlight model fields. */
    hasHighlights: boolean;
}

function findCategory(dataView: DataView, role: string): DataViewCategoryColumn | null {
    return dataView.categorical?.categories?.find(c => c.source.roles?.[role]) ?? null;
}

/**
 * An optional TEXT field (Holiday / Event / Event type). These are Measure roles on
 * purpose: a Grouping role would add a column to the query's GROUP BY, which splits —
 * or, when the text lives in a table with no filter path to the facts, REPEATS — each
 * day's value, silently corrupting Sum and Count. As a measure the host evaluates the
 * text per day, so the value is never touched. The catch: a raw text column dropped in
 * a measure well may arrive summarized as "Count of …" (a number). That is detected
 * from the column's type and reported in plain words rather than drawn as nonsense.
 */
function textColumn(dataView: DataView, role: string, issues: string[]): DataViewValueColumn | null {
    const col = dataView.categorical?.values?.find(v => v.source.roles?.[role]) ?? null;
    if (!col) return null;
    const t = col.source.type;
    // A column whose type the host reports as numeric has been summarized (Count /
    // Count distinct). No type info at all (older hosts, test mocks) → trust it.
    if (t && !t.text && (t.numeric || t.integer)) {
        issues.push(`${col.source.displayName} arrived as a number, so it was ignored. In the field well set it to "First", or bind a text measure.`);
        return null;
    }
    return col;
}

function textAt(col: DataViewValueColumn | null, i: number): string {
    if (!col) return "";
    const v = col.values[i];
    return v == null ? "" : String(v).trim();
}

/** Split one Event value into names: a text measure can list several events per day
 *  (e.g. CONCATENATEX with "; " or "|" or a line break). Commas are NOT separators —
 *  event names contain them. */
export function splitEvents(text: string): string[] {
    return text.split(/\s*(?:;|\||\n| \u00B7 )\s*/).map(t => t.trim()).filter(Boolean);
}

/** Parse the DataView into flat rows (one per date×category tuple) + column refs. */
function parseDataView(dataView: DataView): ParsedDataView | null {
    const dateCategory = findCategory(dataView, "date");
    const valueColumn = dataView.categorical?.values?.find(v => v.source.roles?.["value"]) ?? null;
    if (!dateCategory || !valueColumn) return null;

    const targetColumn = dataView.categorical?.values?.find(v => v.source.roles?.["target"]) ?? null;
    const tooltipColumns = (dataView.categorical?.values ?? []).filter(v => v.source.roles?.["tooltips"]);
    const categoryColumn = findCategory(dataView, "category");
    const fieldIssues: string[] = [];
    const holidayColumn = textColumn(dataView, "holiday", fieldIssues);
    const eventColumn = textColumn(dataView, "event", fieldIssues);
    const eventTypeColumn = textColumn(dataView, "eventType", fieldIssues);

    // capabilities.json declares supportsHighlight:true, so the host supplies a
    // parallel highlights[] on the Value column when another visual cross-highlights
    // this one. Absent (undefined) in the normal render.
    const highlights = valueColumn.highlights;
    const hasHighlights = !!highlights;

    const rows: ParsedRow[] = [];
    const rawDates = dateCategory.values;
    for (let i = 0; i < rawDates.length; i++) {
        const date = normalizeToLocalDay(rawDates[i]);
        if (date == null) continue;
        const v = valueColumn.values[i];
        const t = targetColumn ? targetColumn.values[i] : null;
        const h = highlights ? highlights[i] : null;
        const cat = categoryColumn ? categoryColumn.values[i] : null;
        rows.push({
            date,
            value: v == null ? NaN : Number(v),
            target: t == null ? NaN : Number(t),
            highlight: h == null ? NaN : Number(h),
            category: categoryColumn ? (cat == null ? "" : String(cat)) : undefined,
            holiday: textAt(holidayColumn, i),
            event: textAt(eventColumn, i),
            eventType: textAt(eventTypeColumn, i),
            origIndex: i,
        });
    }
    return {
        rows, dateCategory, valueColumn, targetColumn, tooltipColumns, categoryColumn,
        holidayColumn, eventColumn, eventTypeColumn, fieldIssues, hasHighlights,
    };
}

/** A row that carries ONLY optional text (a holiday / event with no value or target
 *  that day). Such rows decorate days but never define the calendar's range. */
function textOnly(r: ParsedRow): boolean {
    return isNaN(r.value) && isNaN(r.target) && !!(r.holiday || r.event || r.eventType);
}

/**
 * Inclusive [min,max] day extent over a set of rows (assumes non-empty). Text-only
 * rows are left out (HM-V2-10): a holiday measure over a 2020–2030 date table yields
 * a row for every holiday of every year, which would otherwise stretch the calendar
 * across a decade of empty days. Falls back to every row when nothing else is left.
 */
function dateExtent(all: ParsedRow[]): [Date, Date] {
    const withData = all.filter(r => !textOnly(r));
    const rows = withData.length ? withData : all;
    let min = rows[0].date, max = rows[0].date;
    for (const r of rows) { if (r.date < min) min = r.date; if (r.date > max) max = r.date; }
    return [min, max];
}

/** The capped, synthesized day grid for a date range (shared across facets). */
interface DayGrid {
    gridDays: Date[];
    totalDays: number;
    fullRange: [Date, Date];
}

function buildDayGrid(range: [Date, Date]): DayGrid {
    const fullGrid = enumerateDays(range[0], range[1]);
    const totalDays = fullGrid.length;
    const gridDays = totalDays > MAX_RENDER_DAYS ? fullGrid.slice(totalDays - MAX_RENDER_DAYS) : fullGrid;
    return { gridDays, totalDays, fullRange: range };
}

interface AssembleParams {
    rows: ParsedRow[];
    grid: DayGrid;
    host: IVisualHost;
    firstDayOfWeek: number;
    aggMode: AggregationMode;
    p: ParsedDataView;
    /** Compute the (expensive) insight series — only the rendered model(s) need it. */
    computeSeries: boolean;
    facetKey?: string;
    facetIndex?: number;
}

/**
 * Assemble one CalendarModel from a row subset over a shared day grid. Days with
 * no row render as no-data. Selection IDs are built from the original DataView
 * row index so cross-filtering targets the exact date×category tuple.
 */
function assembleModel(a: AssembleParams): CalendarModel {
    const { rows, grid, host, firstDayOfWeek, aggMode, p } = a;
    const { gridDays, totalDays, fullRange } = grid;

    const dates = rows.map(r => r.date);
    const byDay = aggregateByDay(dates, rows.map(r => r.value), aggMode);
    const targetByDay = p.targetColumn ? aggregateByDay(dates, rows.map(r => r.target), aggMode) : null;
    // Highlights ride the same aggregation as the value so a day's highlight reads
    // consistently with its rendered value. Only computed when the host is actually
    // cross-highlighting (p.hasHighlights) — otherwise the highlight fields stay
    // undefined and the render path is byte-identical to the no-highlight case.
    const highlightByDay = p.hasHighlights ? aggregateByDay(dates, rows.map(r => r.highlight), aggMode) : null;

    // Optional text fields, per day. Collected from EVERY row — including rows whose
    // value is blank — so a holiday or event on a day with no measure still shows.
    const holidayByDay = new Map<number, string>();
    const eventsByDay = new Map<number, string[]>();
    const typeByDay = new Map<number, string>();
    if (p.holidayColumn || p.eventColumn || p.eventTypeColumn) {
        for (const r of rows) {
            const k = r.date.getTime();
            if (r.holiday && !holidayByDay.has(k)) holidayByDay.set(k, r.holiday);
            if (r.event) {
                const list = eventsByDay.get(k) ?? [];
                for (const e of splitEvents(r.event)) if (!list.includes(e)) list.push(e);
                eventsByDay.set(k, list);
            }
            if (r.eventType && !typeByDay.has(k)) typeByDay.set(k, r.eventType);
        }
    }
    const eventTypes: string[] = [];
    for (const t of typeByDay.values()) if (!eventTypes.includes(t)) eventTypes.push(t);

    const { rows: gridRows, cols, weeks } = layout(gridDays, firstDayOfWeek);
    const labels: MonthLabel[] = monthLabels(gridDays, cols);

    let vMin = Infinity, vMax = -Infinity;
    const days: DayCell[] = gridDays.map((date, i) => {
        const agg = byDay.get(date.getTime());
        const noData = agg === undefined;
        const value = noData ? null : agg!.value;
        if (value != null) { vMin = Math.min(vMin, value); vMax = Math.max(vMax, value); }
        // Map the day's first contributing row back to its original column index.
        const origIndex = noData ? -1 : rows[agg!.firstIndex].origIndex;
        const selectionId = noData ? null : host.createSelectionIdBuilder()
            .withCategory(p.dateCategory, origIndex)
            .createSelectionId();
        const tooltips = noData ? undefined : p.tooltipColumns.map(c => ({
            name: c.source.displayName,
            value: String(c.values[origIndex] ?? ""),
        }));
        const tAgg = targetByDay?.get(date.getTime());
        const target = noData || !tAgg ? null : tAgg.value;
        // Highlight: when the host supplied a highlights[] array, a day is highlighted
        // iff its aggregated highlight is present and non-zero. undefined (not null)
        // when no highlight is in effect so the render path can cheaply skip dimming.
        const hAgg = highlightByDay?.get(date.getTime());
        const highlightValue = !highlightByDay ? undefined : (noData || !hAgg ? null : hAgg.value);
        const isHighlighted = !highlightByDay ? undefined : (highlightValue != null && highlightValue !== 0);
        return {
            date, value, noData,
            col: cols[i], row: gridRows[i],
            selectionId,
            sourceIndex: origIndex,
            tooltips, target,
            highlightValue, isHighlighted,
            facetKey: a.facetKey,
            facetIndex: a.facetIndex ?? 0,
            holiday: holidayByDay.get(date.getTime()),
            events: eventsByDay.get(date.getTime()),
            eventType: eventsByDay.has(date.getTime()) ? typeByDay.get(date.getTime()) : undefined,
        };
    });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hasToday = today >= gridDays[0] && today <= gridDays[gridDays.length - 1];

    let series;
    if (a.computeSeries) {
        // Full (pre-cap) daily series for the insight engine — spans the entire
        // data extent so YoY/streaks see every day, not the capped window.
        const aggValues = new Map<number, number>();
        for (const [k, ag] of byDay) aggValues.set(k, ag.value);
        series = extractSeries({
            aggregatedByDay: aggValues,
            min: fullRange[0], max: fullRange[1],
            valueName: p.valueColumn.source.displayName,
            referenceDate: today,
        });
    }

    return {
        days, monthLabels: labels,
        range: [gridDays[0], gridDays[gridDays.length - 1]],
        valueDomain: [vMin === Infinity ? 0 : vMin, vMax === -Infinity ? 0 : vMax],
        weeks, hasToday,
        valueName: p.valueColumn.source.displayName,
        aggMode,
        targetName: p.targetColumn?.source.displayName,
        totalDays,
        hasHighlights: p.hasHighlights,
        series,
        holidayName: p.holidayColumn?.source.displayName,
        eventName: p.eventColumn?.source.displayName,
        eventTypeName: p.eventTypeColumn?.source.displayName,
        eventTypes,
        fieldIssues: p.fieldIssues.length ? p.fieldIssues : undefined,
    };
}

/**
 * Build the fully-resolved CalendarModel from a DataView (single-grid case).
 * Synthesizes every day in [min,max] (spec DECISION 3): days with no underlying
 * row render as no-data cells and are not selectable.
 */
export function buildCalendarModel(
    dataView: DataView,
    host: IVisualHost,
    firstDayOfWeek: number,
    aggMode: AggregationMode
): CalendarModel | null {
    const parsed = parseDataView(dataView);
    if (!parsed || parsed.rows.length === 0) return null;
    const grid = buildDayGrid(dateExtent(parsed.rows));
    return assembleModel({
        rows: parsed.rows, grid, host, firstDayOfWeek, aggMode, p: parsed, computeSeries: true,
    });
}

/**
 * Build the faceted render plan. When a Split-by field is bound, rows are grouped
 * by category and each group becomes a small-multiple panel over a SHARED date
 * grid (so panels align) with a SHARED value domain (so colors compare). The
 * all-categories rollup (`combined`) drives the header / insights / legend chrome.
 *
 * With no Split-by field, returns a single facet whose model === combined — the
 * caller renders it exactly like the classic single grid.
 */
export function buildFacetedModel(
    dataView: DataView,
    host: IVisualHost,
    firstDayOfWeek: number,
    aggMode: AggregationMode
): FacetedRender | null {
    const parsed = parseDataView(dataView);
    if (!parsed || parsed.rows.length === 0) return null;

    // Shared grid + combined rollup span the whole data extent (all categories).
    const grid = buildDayGrid(dateExtent(parsed.rows));
    const combined = assembleModel({
        rows: parsed.rows, grid, host, firstDayOfWeek, aggMode, p: parsed, computeSeries: true,
    });

    if (!parsed.categoryColumn) {
        // No Split-by → one facet that is the combined model itself.
        return {
            facets: [{ key: "", model: combined }],
            combined,
            sharedDomain: combined.valueDomain,
            totalCategories: 1,
        };
    }

    // Group rows by category value, preserving first-seen (DataView) order.
    const groups = new Map<string, ParsedRow[]>();
    for (const r of parsed.rows) {
        const k = r.category ?? "";
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(r);
    }
    const totalCategories = groups.size;
    const keys = [...groups.keys()].slice(0, MAX_FACETS);

    const facets: Facet[] = keys.map((key, idx) => ({
        key,
        model: assembleModel({
            rows: groups.get(key)!, grid, host, firstDayOfWeek, aggMode, p: parsed,
            computeSeries: false, facetKey: key, facetIndex: idx,
        }),
    }));

    // Shared color domain = extent across every panel's day values.
    let sMin = Infinity, sMax = -Infinity;
    for (const f of facets) {
        const [lo, hi] = f.model.valueDomain;
        if (lo < sMin) sMin = lo;
        if (hi > sMax) sMax = hi;
    }
    const sharedDomain: [number, number] = [sMin === Infinity ? 0 : sMin, sMax === -Infinity ? 0 : sMax];

    return {
        facets,
        combined,
        sharedDomain,
        categoryName: parsed.categoryColumn.source.displayName,
        totalCategories,
    };
}

/**
 * Hours layout (HM-V2-12): fold every row into a weekday × hour-of-day grid. Reads
 * the time of day from the RAW Date value (the calendar path normalizes to midnight).
 * The Aggregate setting applies across all rows in a bucket — Sum adds every Monday
 * 9 AM, Average averages them. Built only when the Hours layout is on: it creates one
 * selection id per row so a click can cross-filter everything in the bucket.
 */
export function buildHourModel(
    dataView: DataView, host: IVisualHost, firstDayOfWeek: number, aggMode: AggregationMode,
): HourModel | null {
    const dateCategory = findCategory(dataView, "date");
    const valueColumn = dataView.categorical?.values?.find(v => v.source.roles?.["value"]) ?? null;
    if (!dateCategory || !valueColumn) return null;

    const n = 7 * 24;
    const sums = new Array<number>(n).fill(0), counts = new Array<number>(n).fill(0);
    const mins = new Array<number>(n).fill(Infinity), maxs = new Array<number>(n).fill(-Infinity);
    const ids: ISelectionIdLike[][] = Array.from({ length: n }, () => []);
    let hasTime = false, any = false;
    const raw = dateCategory.values;
    for (let i = 0; i < raw.length; i++) {
        const r = raw[i];
        if (r == null) continue;
        const d: Date = r instanceof Date ? r : new Date(r as string | number);
        if (isNaN(d.getTime())) continue;
        any = true;
        if (d.getHours() || d.getMinutes() || d.getSeconds()) hasTime = true;
        const v = valueColumn.values[i];
        const num = v == null ? NaN : Number(v);
        if (!Number.isFinite(num)) continue;
        const k = d.getDay() * 24 + d.getHours();
        sums[k] += num; counts[k]++;
        if (num < mins[k]) mins[k] = num;
        if (num > maxs[k]) maxs[k] = num;
        ids[k].push(host.createSelectionIdBuilder().withCategory(dateCategory, i).createSelectionId());
    }
    if (!any) return null;

    let vMin = Infinity, vMax = -Infinity;
    const cells: HourCell[] = [];
    for (let wd = 0; wd < 7; wd++) {
        for (let h = 0; h < 24; h++) {
            const k = wd * 24 + h, c = counts[k];
            let value: number | null = null;
            if (c) {
                switch (aggMode) {
                    case "avg": value = sums[k] / c; break;
                    case "min": value = mins[k]; break;
                    case "max": value = maxs[k]; break;
                    case "count": value = c; break;
                    default: value = sums[k];
                }
                vMin = Math.min(vMin, value); vMax = Math.max(vMax, value);
            }
            cells.push({
                weekday: wd, hour: h, value, rows: c,
                selectionIds: ids[k] as HourCell["selectionIds"],
                row: (wd - firstDayOfWeek + 7) % 7, col: h,
            });
        }
    }
    return {
        cells, hasTime,
        valueDomain: [vMin === Infinity ? 0 : vMin, vMax === -Infinity ? 0 : vMax],
        valueName: valueColumn.source.displayName, aggMode, firstDayOfWeek,
    };
}

type ISelectionIdLike = powerbi.visuals.ISelectionId;
