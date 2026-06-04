"use strict";

/**
 * Insight ranking. Importance is the primary sort, kind breaks ties between
 * equally-important insights (a strong anomaly edges out an equally strong
 * weekday pattern), and a bounded magnitude term orders within a tier.
 * Pure: imports only ./types.
 */

import { Insight, InsightKind, Level } from "./types";

/**
 * Composite score. `magnitude` is a per-kind 0..10 hint (z-score, streak length
 * scaled, |delta%| scaled) — clamped below the tier gap so it can only ever
 * break ties, never override importance or kind.
 */
export function scoreInsight(kind: InsightKind, importance: Level, magnitude: number): number {
    const base = importance === "high" ? 300 : importance === "medium" ? 200 : 100;
    const kindBias = kind === "anomaly" ? 30 : kind === "comparison" ? 20 : kind === "streak" ? 20 : 10;
    const mag = Math.min(Math.max(magnitude, 0), 9.99);
    return base + kindBias + mag;
}

/** Sort by score desc, deterministic id tie-break, then take the top N. */
export function rankInsights(insights: readonly Insight[], topN = 3): Insight[] {
    return [...insights]
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
        .slice(0, topN);
}
