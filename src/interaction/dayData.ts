"use strict";

import { CalendarModel, DayCell, AggregationMode } from "../types";

/**
 * dayData.ts — shared day-level derivations for the hover tooltip AND the
 * persistent day-detail panel (Z-145). The tooltip historically owned this
 * logic inline; it was factored out here so the panel reuses the SAME math
 * (no copy-paste of the value-map / variance / format code — see Z-145 §2).
 */

export const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Stable key for a day within a facet, so panels/tooltips sharing a date don't collide. */
export function dayKey(d: { facetKey?: string; date: Date }): string {
    return `${d.facetKey ?? ""}|${d.date.getTime()}`;
}

/**
 * Build the `${facetKey}|${epoch} → value` lookup used for day-over-day deltas.
 * Only real (non-noData, non-null) days are indexed.
 */
export function buildValueByDay(model: CalendarModel): Map<string, number> {
    const m = new Map<string, number>();
    for (const d of model.days) {
        if (!d.noData && d.value != null) m.set(dayKey(d), d.value);
    }
    return m;
}

/** Number formatter shared by tooltip + panel (locale-aware, ≤2 fraction digits). */
export function formatNum(n: number): string {
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Strip a leading host aggregation prefix ("Sum of Tickets" → "Tickets") so a
 *  re-labelled metric doesn't read "Count of Sum of Tickets". */
export function baseFieldName(name: string): string {
    return name.replace(/^(sum|average|avg|count|min|max|first|last|median|std(?:dev)?|var(?:iance)?)\s+of\s+/i, "").trim() || name;
}

/** Metric label honoring the aggregation mode. Count is a row count, not the
 *  field's magnitude, so it gets count-appropriate copy ("Count of Tickets");
 *  every other mode shows the field name as-is. */
export function metricLabel(valueName: string, aggMode: AggregationMode): string {
    return aggMode === "count" ? `Count of ${baseFieldName(valueName)}` : valueName;
}

/** Product-grade auto header title (issue #2) used when the author leaves the
 *  Header › Title blank: "<Value> by <Split-by>" when a category is bound, else
 *  the value field name — both stripped of the host "Sum of …" prefix. */
export function autoHeaderTitle(valueName: string, categoryName?: string): string {
    const base = baseFieldName(valueName);
    return categoryName ? `${base} by ${baseFieldName(categoryName)}` : base;
}

/** Uppercase date label, e.g. `WED · JUN 4, 2025`. */
export function dateLabel(date: Date): string {
    return `${WEEKDAY[date.getDay()]} · ${date.toLocaleDateString(undefined,
        { month: "short", day: "numeric", year: "numeric" })}`.toUpperCase();
}

export interface DeltaResult {
    /** Signed absolute difference vs the previous calendar day. */
    diff: number;
    /** True when diff >= 0 (up / non-decreasing). */
    up: boolean;
    /** Percentage magnitude string, e.g. "8.0". */
    pct: string;
    /** Short weekday name of the compared previous day, e.g. "Mon". */
    prevWeekday: string;
}

/** Day-over-day delta vs the previous calendar day; null when no prior value. */
export function dayOverDay(d: DayCell, valueByDay: Map<string, number>): DeltaResult | null {
    if (d.value == null) return null;
    const prev = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate() - 1);
    const prevVal = valueByDay.get(`${d.facetKey ?? ""}|${prev.getTime()}`);
    if (prevVal == null || prevVal === 0) return null;
    const diff = d.value - prevVal;
    return {
        diff,
        up: diff >= 0,
        pct: Math.abs((diff / prevVal) * 100).toFixed(1),
        prevWeekday: WEEKDAY[prev.getDay()],
    };
}

export interface VarianceResult {
    /** Signed difference value − target. */
    diff: number;
    /** True when value >= target (at/over goal). */
    over: boolean;
    /** Human label, e.g. "8.0% over" / "under". */
    label: string;
}

/** Target variance for a day; null when no finite target is bound. */
export function targetVariance(d: DayCell): VarianceResult | null {
    if (d.value == null || d.target == null || !isFinite(d.target)) return null;
    const diff = d.value - d.target;
    const over = diff >= 0;
    const label = d.target !== 0
        ? `${Math.abs((diff / d.target) * 100).toFixed(1)}% ${over ? "over" : "under"}`
        : (over ? "over" : "under");
    return { diff, over, label };
}

export interface TopContributor {
    /** Facet (Split-by) category contributing the most on this date. */
    category: string;
    /** Share of the date's total value, 0..100, rounded to a whole percent. */
    share: number;
}

/**
 * Top contributor (Z-145 §4.6) — feasible ONLY for faceted reports. Across all
 * facets sharing the clicked day's date, the facet with the max value, plus its
 * share of the date's total. Returns null for non-faceted data or when the
 * comparison set has ≤1 member (honest omission — never fabricated).
 */
export function topContributor(d: DayCell, allDays: DayCell[]): TopContributor | null {
    if (d.facetKey == null) return null;
    const epoch = d.date.getTime();
    let total = 0;
    let best: { key: string; value: number } | null = null;
    let members = 0;
    for (const o of allDays) {
        if (o.facetKey == null || o.noData || o.value == null) continue;
        if (o.date.getTime() !== epoch) continue;
        members++;
        total += o.value;
        if (!best || o.value > best.value) best = { key: o.facetKey, value: o.value };
    }
    if (members <= 1 || !best || total <= 0) return null;
    return { category: best.key, share: Math.round((best.value / total) * 100) };
}

// ---------------------------------------------------------------------------
// Small DOM builders shared by the tooltip + the day-detail panel.
// ---------------------------------------------------------------------------

/** Remove all children of an element. */
export function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

/** Build a <div> with inline cssText and optional textContent. */
export function div(style: string, text?: string): HTMLDivElement {
    const d = document.createElement("div");
    d.style.cssText = style;
    if (text != null) d.textContent = text;
    return d;
}

/** Build a <span> with inline cssText and textContent. */
export function span(style: string, text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.style.cssText = style;
    s.textContent = text;
    return s;
}
