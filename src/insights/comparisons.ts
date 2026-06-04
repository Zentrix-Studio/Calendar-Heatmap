"use strict";

/**
 * Year-over-year / period-over-period comparison engine (Phase 5B, step 6),
 * fiscal-year aware (free v1.1 time-intelligence).
 *
 * Consumes the FULL pre-cap series (never the render-capped grid) so a multi-year
 * range can compare the current (fiscal) year to the prior one. Comparisons are
 * always like-for-like: a partial current year is compared only to the SAME
 * window of the prior year, never to a full 12 months (the partial-period guard).
 *
 * fiscalStartMonth (1=Jan default .. 12=Dec) shifts both the year boundary and
 * the quarter boundaries. With the default (1) the fiscal ordinals equal calendar
 * ordinals, so calendar behaviour is unchanged.
 *
 * Pure: imports only ./types. No Power BI, no d3.
 */

import { DailySeries } from "./types";

export interface QuarterDelta {
    /** Fiscal quarter number, 1..4. */
    q: number;
    /** Fractional change vs the prior year's same quarter window. */
    deltaPct: number;
}

export interface ComparisonResult {
    /** Latest (fiscal) year that has data. */
    currentYear: number;
    /** The prior year it is compared against (currentYear - 1). */
    priorYear: number;
    /** True when the fiscal year start month is not January (drives "FY" labelling). */
    fiscal: boolean;
    /** True when the current year hasn't reached its 12th fiscal month. */
    partial: boolean;
    /** Inclusive fiscal window compared, as fiscal-month/day ordinals (m*100+d, m=1..12). */
    window: { fromOrdinal: number; toOrdinal: number };
    /** Sum-based YoY change: (curTotal - prevTotal) / abs(prevTotal). */
    totalDeltaPct: number;
    /** Active-day-average YoY change. */
    avgDeltaPct: number;
    curTotal: number;
    prevTotal: number;
    /** Per-quarter deltas, only for quarters fully inside the compared window. */
    byQuarter: QuarterDelta[];
}

/** Fiscal year a date belongs to: months before the start month roll into the prior year. */
function fiscalYearOf(date: Date, startMonth: number): number {
    return (date.getMonth() + 1) >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
}

/**
 * Fiscal-relative ordinal: (fiscalMonthIndex+1)*100 + day, where fiscalMonthIndex
 * is 0 for the start month. Orders correctly within a fiscal year even when it
 * wraps the calendar boundary. With startMonth=1 this equals the calendar ordinal.
 */
function fiscalOrdinal(date: Date, startMonth: number): number {
    const fmi = (date.getMonth() - (startMonth - 1) + 12) % 12; // 0..11
    return (fmi + 1) * 100 + date.getDate();
}

/** Fiscal quarter (1..4) for a fiscal-month-ordinal (m*100+d, m=1..12). */
function quarterOf(monthOrdinal: number): number {
    const month = Math.floor(monthOrdinal / 100);
    return Math.floor((month - 1) / 3) + 1;
}

/** Last fiscal-month/day ordinal fully covered by a quarter (Q1=0331 .. Q4=1231). */
const QUARTER_END_ORDINAL = [331, 630, 930, 1231];

interface Row { o: number; v: number; leap: boolean; }

/**
 * Compute a YoY comparison from the full daily series, or null when there isn't
 * a prior (fiscal) year to compare against. Only non-null days contribute; the
 * current year's last populated day fixes the like-for-like cutoff for both years.
 */
export function computeComparisons(series: DailySeries, fiscalStartMonth = 1): ComparisonResult | null {
    const startMonth = Math.min(12, Math.max(1, Math.round(fiscalStartMonth || 1)));

    // Bucket non-null values by fiscal year. Calendar Feb 29 is flagged so it can
    // be excluded from like-for-like sums (leap years would otherwise add a day).
    const byYear = new Map<number, Row[]>();
    for (const d of series.data) {
        if (d.value == null) continue;
        const fy = fiscalYearOf(d.date, startMonth);
        if (!byYear.has(fy)) byYear.set(fy, []);
        byYear.get(fy)!.push({
            o: fiscalOrdinal(d.date, startMonth),
            v: d.value,
            leap: d.date.getMonth() === 1 && d.date.getDate() === 29,
        });
    }
    if (byYear.size < 2) return null;

    const currentYear = Math.max(...byYear.keys());
    const priorYear = currentYear - 1;
    if (!byYear.has(priorYear)) return null;

    const cur = byYear.get(currentYear)!;
    const prev = byYear.get(priorYear)!;

    const toOrdinal = cur.reduce((mx, x) => Math.max(mx, x.o), 0);
    const fromOrdinal = 101; // first day of the fiscal year
    // Partial when the current year hasn't reached its 12th fiscal month yet
    // (month-based so a fiscal year ending in a 30-day month still reads complete).
    const partial = Math.floor(toOrdinal / 100) < 12;

    const accumulate = (rows: Row[]): { total: number; activeCount: number } => {
        let total = 0, activeCount = 0;
        for (const r of rows) {
            if (r.o < fromOrdinal || r.o > toOrdinal || r.leap) continue;
            total += r.v;
            activeCount++;
        }
        return { total, activeCount };
    };

    const c = accumulate(cur);
    const p = accumulate(prev);
    if (p.activeCount === 0) return null; // nothing comparable in the prior year

    const pct = (now: number, before: number): number =>
        before === 0 ? (now === 0 ? 0 : 1) : (now - before) / Math.abs(before);

    const curAvg = c.activeCount ? c.total / c.activeCount : 0;
    const prevAvg = p.activeCount ? p.total / p.activeCount : 0;

    const byQuarter: QuarterDelta[] = [];
    for (let q = 1; q <= 4; q++) {
        const qEnd = QUARTER_END_ORDINAL[q - 1];
        if (qEnd > toOrdinal) break; // quarter not fully covered yet
        const qStart = q === 1 ? 101 : QUARTER_END_ORDINAL[q - 2] + 1;
        const inQ = (rows: Row[]) =>
            rows.filter(r => quarterOf(r.o) === q && r.o >= qStart && r.o <= qEnd && !r.leap)
                .reduce((s, r) => s + r.v, 0);
        const cQ = inQ(cur), pQ = inQ(prev);
        if (pQ === 0 && cQ === 0) continue;
        byQuarter.push({ q, deltaPct: pct(cQ, pQ) });
    }

    return {
        currentYear, priorYear,
        fiscal: startMonth !== 1,
        partial,
        window: { fromOrdinal, toOrdinal },
        totalDeltaPct: pct(c.total, p.total),
        avgDeltaPct: pct(curAvg, prevAvg),
        curTotal: c.total, prevTotal: p.total,
        byQuarter,
    };
}
