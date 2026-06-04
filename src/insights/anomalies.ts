"use strict";

/**
 * Anomaly detection — the "Aug 18 spiked 4.1σ above normal" insight.
 * Pure: consumes a DailySeries, returns an AnomalySummary. Deterministic, no ML.
 *
 * Robust by default: modified z-score = 0.6745·(x − median)/MAD. Because daily
 * ops data is right-skewed, MAD beats mean/stddev (it won't let a few huge days
 * inflate the spread and mask everything). When MAD collapses to 0 (>50% of
 * values identical) it falls back to the Iglewicz–Hoaglin MeanAD form and flags
 * `method: "meanad"` so the choice is visible for narration/debugging.
 *
 * Gaps (null) are ignored; recorded zeros are kept (a 0 amid a high baseline is
 * a genuine low anomaly). Scores are signed; |score| sets severity.
 */

import { DailySeries } from "./types";
import { median, mad, meanAbsDev, modifiedZ, nonNullValues } from "./stats";

export type AnomalySeverity = "moderate" | "strong";
export type AnomalyDirection = "high" | "low";

export interface AnomalyPoint {
    date: Date;
    value: number;
    /** Signed robust z-score (positive = above normal). */
    score: number;
    direction: AnomalyDirection;
    severity: AnomalySeverity;
}

export interface AnomalySummary {
    /** Anomalous days, strongest |score| first. */
    anomalies: AnomalyPoint[];
    strongest?: AnomalyPoint;
    countModerate: number;
    countStrong: number;
    /** Which scoring path was used — "meanad" when MAD degenerated. */
    method: "mad" | "meanad";
}

const MODERATE = 2.5;
const STRONG = 3.5;
/** Iglewicz–Hoaglin consistency constant for the MeanAD fallback. */
const MEANAD_K = 1.253314;

export function computeAnomalies(series: DailySeries): AnomalySummary {
    const empty: AnomalySummary = {
        anomalies: [], strongest: undefined, countModerate: 0, countStrong: 0, method: "mad",
    };
    const values = nonNullValues(series.data);
    if (values.length === 0) return empty;

    const med = median(values);
    const madv = mad(values, med);

    let scoreOf: (x: number) => number;
    let method: "mad" | "meanad";
    if (madv > 0) {
        scoreOf = x => modifiedZ(x, med, madv);
        method = "mad";
    } else {
        const mAD = meanAbsDev(values, med);
        if (mAD <= 0) return empty; // every value identical → no spread, no anomalies
        scoreOf = x => (x - med) / (MEANAD_K * mAD);
        method = "meanad";
    }

    const anomalies: AnomalyPoint[] = [];
    for (const d of series.data) {
        if (d.value == null) continue; // gaps ignored
        const score = scoreOf(d.value);
        const abs = Math.abs(score);
        if (abs < MODERATE) continue;
        anomalies.push({
            date: d.date,
            value: d.value,
            score,
            direction: score >= 0 ? "high" : "low",
            severity: abs >= STRONG ? "strong" : "moderate",
        });
    }
    anomalies.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

    let countModerate = 0, countStrong = 0;
    for (const a of anomalies) { if (a.severity === "strong") countStrong++; else countModerate++; }

    return { anomalies, strongest: anomalies[0], countModerate, countStrong, method };
}
