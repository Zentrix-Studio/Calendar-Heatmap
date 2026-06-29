"use strict";

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewValueColumn = powerbi.DataViewValueColumn;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { CalendarModel, DayCell, MonthLabel, Facet, FacetedRender } from "../types";
import { enumerateDays, layout, monthLabels } from "./dateGrid";
import { extractSeries } from "../insights/series";

export type AggregationMode = "sum" | "avg" | "min" | "max" | "count";

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
        if (v == null || isNaN(v)) continue;
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
    annotation?: string;  // Annotation note, if any
    category?: string;    // Split-by value, if the role is bound
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
    /** True when the host supplied a `values[].highlights[]` array on the Value
     * column (cross-highlight is active). When false, the render path is identical
     * to today — no dimming, no highlight model fields. */
    hasHighlights: boolean;
}

function findCategory(dataView: DataView, role: string): DataViewCategoryColumn | null {
    return dataView.categorical?.categories?.find(c => c.source.roles?.[role]) ?? null;
}

/** Parse the DataView into flat rows (one per date×category tuple) + column refs. */
function parseDataView(dataView: DataView): ParsedDataView | null {
    const dateCategory = findCategory(dataView, "date");
    const valueColumn = dataView.categorical?.values?.find(v => v.source.roles?.["value"]) ?? null;
    if (!dateCategory || !valueColumn) return null;

    const targetColumn = dataView.categorical?.values?.find(v => v.source.roles?.["target"]) ?? null;
    const tooltipColumns = (dataView.categorical?.values ?? []).filter(v => v.source.roles?.["tooltips"]);
    const annotationColumn = findCategory(dataView, "annotation");
    const categoryColumn = findCategory(dataView, "category");

    // capabilities.json declares supportsHighlight:true, so the host supplies a
    // parallel highlights[] on the Value column when another visual cross-highlights
    // this one. Absent that interaction the array is undefined → normal render.
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
        const ann = annotationColumn ? annotationColumn.values[i] : null;
        const cat = categoryColumn ? categoryColumn.values[i] : null;
        rows.push({
            date,
            value: v == null ? NaN : Number(v),
            target: t == null ? NaN : Number(t),
            highlight: h == null ? NaN : Number(h),
            annotation: ann == null || ann === "" ? undefined : String(ann),
            category: categoryColumn ? (cat == null ? "" : String(cat)) : undefined,
            origIndex: i,
        });
    }
    return { rows, dateCategory, valueColumn, targetColumn, tooltipColumns, categoryColumn, hasHighlights };
}

/** Inclusive [min,max] day extent over a set of rows (assumes non-empty). */
function dateExtent(rows: ParsedRow[]): [Date, Date] {
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
    // in the same units as its color. Only built when the host supplied the array.
    const highlightByDay = p.hasHighlights ? aggregateByDay(dates, rows.map(r => r.highlight), aggMode) : null;

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
        const annotation = noData ? undefined : rows[agg!.firstIndex].annotation;
        // Highlight: when the host supplied a highlights[] array, a day is
        // highlighted iff its aggregated highlight is present and non-zero.
        const hAgg = highlightByDay?.get(date.getTime());
        const highlightValue = !highlightByDay ? undefined : (noData || !hAgg ? null : hAgg.value);
        const isHighlighted = !highlightByDay ? undefined : (highlightValue != null && highlightValue !== 0);
        return {
            date, value, noData,
            col: cols[i], row: gridRows[i],
            selectionId,
            sourceIndex: origIndex,
            highlightValue, isHighlighted,
            tooltips, target, annotation,
            facetKey: a.facetKey,
            facetIndex: a.facetIndex ?? 0,
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
        targetName: p.targetColumn?.source.displayName,
        totalDays,
        series,
        hasHighlights: p.hasHighlights,
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
