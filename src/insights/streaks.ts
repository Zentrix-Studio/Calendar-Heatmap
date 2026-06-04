"use strict";

/**
 * Streak analytics — the first shippable premium insight.
 * Pure: consumes a DailySeries + InsightConfig, returns a StreakSummary.
 *
 * Semantics (both decided in roadmap/phase-5b-insight-engine-plan.md):
 *  - A streak is a run of calendar-consecutive days of the SAME class. An
 *    "ignore" day (e.g. a gap under inactiveMeans:"zero") breaks BOTH an active
 *    and an inactive run — you can't claim a streak continued through a day you
 *    were told to ignore.
 *  - The current streak anchors at the latest series day whose date is
 *    <= referenceDate, so it still reads when data lags (refDate = today,
 *    data ends yesterday). refDate before all data → 0. Staleness gating is a
 *    host concern (analogous to model.hasToday).
 */

import { DailySeries, InsightConfig } from "./types";
import { classifyDay, DayClass, longestRun } from "./stats";

/** A located streak: its length and the dates it spans (null when length 0). */
export interface StreakSpan {
    length: number;
    start: Date | null;
    end: Date | null;
}

export interface StreakSummary {
    longestActive: StreakSpan;
    longestInactive: StreakSpan;
    /** Consecutive active days ending at the anchor (0 if the anchor isn't active). */
    currentActive: number;
    /** Consecutive inactive days ending at the anchor (0 if the anchor isn't inactive). */
    currentInactive: number;
    activeDays: number;
    inactiveDays: number;
    /** activeDays / (activeDays + inactiveDays); 0 when no day is considered. */
    activeDaysPct: number;
}

function midnight(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function computeStreaks(series: DailySeries, config: InsightConfig): StreakSummary {
    const data = series.data;
    const classes: DayClass[] = data.map(d => classifyDay(d, config));

    const la = longestRun(classes.map(c => c === "active"));
    const li = longestRun(classes.map(c => c === "inactive"));
    const toSpan = (r: { start: number; length: number }): StreakSpan =>
        r.length === 0
            ? { length: 0, start: null, end: null }
            : { length: r.length, start: data[r.start].date, end: data[r.start + r.length - 1].date };

    // Anchor = latest index whose date is on or before referenceDate (data is ascending).
    const refT = midnight(series.referenceDate).getTime();
    let anchor = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i].date.getTime() <= refT) anchor = i;
    }
    const countBack = (target: DayClass): number => {
        if (anchor < 0 || classes[anchor] !== target) return 0;
        let n = 0;
        for (let i = anchor; i >= 0 && classes[i] === target; i--) n++;
        return n;
    };

    let activeDays = 0, inactiveDays = 0;
    for (const c of classes) {
        if (c === "active") activeDays++;
        else if (c === "inactive") inactiveDays++;
    }
    const considered = activeDays + inactiveDays;

    return {
        longestActive: toSpan(la),
        longestInactive: toSpan(li),
        currentActive: countBack("active"),
        currentInactive: countBack("inactive"),
        activeDays,
        inactiveDays,
        activeDaysPct: considered === 0 ? 0 : activeDays / considered,
    };
}
