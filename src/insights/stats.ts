"use strict";

/**
 * Pure math + small reusable utilities for the insight engine.
 * No Power BI, no d3 — only `./types`. Fully Jest-testable.
 *
 * Robust statistics (median + MAD) are the house default because daily ops
 * data is right-skewed by design — mean/stddev over-flag the high tail (the
 * same reason quantile beats linear for color, spec DECISION-1).
 */

import { DailyDatum, InsightConfig } from "./types";

/** Arithmetic mean. Empty → NaN. */
export function mean(xs: readonly number[]): number {
    if (xs.length === 0) return NaN;
    let s = 0;
    for (const x of xs) s += x;
    return s / xs.length;
}

/** Median via a sorted copy. Empty → NaN. */
export function median(xs: readonly number[]): number {
    const n = xs.length;
    if (n === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = n >> 1;
    return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolated quantile, p in [0,1]. Empty → NaN. */
export function quantile(xs: readonly number[], p: number): number {
    const n = xs.length;
    if (n === 0) return NaN;
    if (n === 1) return xs[0];
    const s = [...xs].sort((a, b) => a - b);
    const idx = p * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

/** Population standard deviation. Empty → NaN. */
export function stddev(xs: readonly number[], m: number = mean(xs)): number {
    if (xs.length === 0) return NaN;
    let s = 0;
    for (const x of xs) s += (x - m) * (x - m);
    return Math.sqrt(s / xs.length);
}

/** Median absolute deviation: median(|x − median(x)|). Empty → NaN. */
export function mad(xs: readonly number[], med: number = median(xs)): number {
    if (xs.length === 0) return NaN;
    return median(xs.map(x => Math.abs(x - med)));
}

/**
 * Mean absolute deviation about the median: mean(|x − median(x)|). Empty → NaN.
 * The MAD-collapse fallback (>50% identical values) for robust z-scores.
 */
export function meanAbsDev(xs: readonly number[], med: number = median(xs)): number {
    if (xs.length === 0) return NaN;
    return mean(xs.map(x => Math.abs(x - med)));
}

/**
 * Modified (robust) z-score: 0.6745 · (value − median) / MAD.
 * When MAD is 0 (more than half the values identical) the score is undefined;
 * returns 0 here and the anomaly layer applies the MeanAD fallback.
 */
export function modifiedZ(value: number, med: number, madValue: number): number {
    if (!isFinite(madValue) || madValue === 0) return 0;
    return (0.6745 * (value - med)) / madValue;
}

/** Non-null values from a series, in order. */
export function nonNullValues(data: readonly DailyDatum[]): number[] {
    const out: number[] = [];
    for (const d of data) if (d.value != null) out.push(d.value);
    return out;
}

/**
 * Group non-null values by weekday. Returns 7 buckets indexed by
 * `Date.getDay()` (0 = Sunday … 6 = Saturday) — weekday-absolute, independent
 * of the visual's first-day-of-week (that only affects display).
 */
export function groupByWeekday(data: readonly DailyDatum[]): number[][] {
    const buckets: number[][] = [[], [], [], [], [], [], []];
    for (const d of data) {
        if (d.value != null) buckets[d.date.getDay()].push(d.value);
    }
    return buckets;
}

/** Per-day classification for streaks — the gap-vs-zero fork lives here. */
export type DayClass = "active" | "inactive" | "ignore";

export function classifyDay(d: DailyDatum, config: InsightConfig): DayClass {
    if (d.value != null && d.value > config.activeThreshold) return "active";
    const isGap = d.value == null;
    const inactiveByGap = config.inactiveMeans === "gap" || config.inactiveMeans === "either";
    const inactiveByZero = config.inactiveMeans === "zero" || config.inactiveMeans === "either";
    if (isGap) return inactiveByGap ? "inactive" : "ignore";
    return inactiveByZero ? "inactive" : "ignore";
}

/**
 * Longest consecutive run of `true` in a boolean array.
 * Returns the run's start index and length; {start:-1,length:0} when none.
 */
export function longestRun(flags: readonly boolean[]): { start: number; length: number } {
    let bestStart = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let i = 0; i < flags.length; i++) {
        if (flags[i]) {
            if (curLen === 0) curStart = i;
            curLen++;
            if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else {
            curLen = 0;
        }
    }
    return { start: bestStart, length: bestLen };
}
