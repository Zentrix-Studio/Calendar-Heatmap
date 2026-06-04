"use strict";

/**
 * Weekday-rhythm analytics — the "Fridays run 18% above baseline" insight.
 * Pure: consumes a DailySeries, returns WeekdayPatterns. No config needed.
 *
 * Operates on RAW non-null values (magnitude), not the active/inactive
 * classification: a recorded 0 is a genuine low-volume day and belongs in the
 * means; only gaps (null) are excluded — consistent with the streak model's
 * gap handling. Weekday index is Date.getDay() (0=Sun..6=Sat), absolute and
 * independent of the visual's first-day-of-week (that only affects display).
 *
 * Descriptive only. Action-framed narration ("…recurring staffing gap") is the
 * narrative layer's job (Step 5); this exposes weekday + deltaPct + volatility
 * so that framing has something to stand on.
 */

import { DailySeries } from "./types";
import { mean, stddev, nonNullValues, groupByWeekday } from "./stats";

export interface WeekdayMetric {
    /** 0=Sun … 6=Sat (Date.getDay). */
    weekday: number;
    mean: number;
    /** (mean − baseline) / baseline; 0 when baseline is 0 (no divide-by-zero). */
    deltaPct: number;
    /** Number of considered (non-null) days for this weekday. */
    count: number;
    /** Population stddev of the weekday's values (volatility / consistency). */
    stddev: number;
}

export interface WeekdayPatterns {
    /** Mean of all considered (non-null) values; 0 when none. */
    baseline: number;
    /** One metric per weekday with ≥1 considered day, ascending by weekday. */
    byWeekday: WeekdayMetric[];
    /** Highest-delta weekday; undefined when there's no spread (all equal). */
    strongest?: WeekdayMetric;
    /** Lowest-delta weekday; undefined when there's no spread. */
    weakest?: WeekdayMetric;
}

const EPS = 1e-9;

export function computeWeekdayPatterns(series: DailySeries): WeekdayPatterns {
    const all = nonNullValues(series.data);
    const baseline = all.length ? mean(all) : 0;
    const buckets = groupByWeekday(series.data);

    const byWeekday: WeekdayMetric[] = [];
    for (let wd = 0; wd < 7; wd++) {
        const vals = buckets[wd];
        if (vals.length === 0) continue; // weekday with no data is omitted, not NaN
        const m = mean(vals);
        byWeekday.push({
            weekday: wd,
            mean: m,
            deltaPct: baseline === 0 ? 0 : (m - baseline) / baseline,
            count: vals.length,
            stddev: stddev(vals, m),
        });
    }

    let strongest: WeekdayMetric | undefined;
    let weakest: WeekdayMetric | undefined;
    if (byWeekday.length > 0) {
        let hi = byWeekday[0], lo = byWeekday[0];
        for (const m of byWeekday) {
            if (m.deltaPct > hi.deltaPct) hi = m;
            if (m.deltaPct < lo.deltaPct) lo = m;
        }
        // No meaningful peak/trough when every weekday sits at the baseline.
        if (hi.deltaPct - lo.deltaPct > EPS) { strongest = hi; weakest = lo; }
    }

    return { baseline, byWeekday, strongest, weakest };
}
