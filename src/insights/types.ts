"use strict";

/**
 * Shared types for the deterministic insight engine (Phase 5B).
 * See roadmap/phase-5b-insight-engine-plan.md.
 *
 * IMPORT-BAN: nothing in `src/insights/**` may import `powerbi-visuals-api`
 * or `d3`. That ban is what keeps this layer reusable across future Zentrix
 * visuals, exports, and a headless API. Pure data in → insights out.
 */

/**
 * One day of the FULL pre-cap series.
 * `value === null` means no underlying row (a gap). A real recorded `0` is
 * deliberately distinct from a gap — see {@link InactiveMeaning}.
 */
export interface DailyDatum {
    /** Local midnight, same normalization as the data pipeline. */
    date: Date;
    /** Aggregated value for the day, or null when the day has no row (gap). */
    value: number | null;
}

/**
 * The full daily series handed to the engine — NEVER the render-capped grid.
 * Insights computed off the capped grid would silently miss prior periods
 * (YoY) and break long streaks; the engine always consumes the full extent.
 */
export interface DailySeries {
    /** Contiguous [min..max] inclusive; gaps present as `value: null`. */
    data: DailyDatum[];
    /** Display name of the value field, for narration ("Support tickets"). */
    valueName: string;
    /** Injected "today" — the engine never calls `new Date()` (determinism). */
    referenceDate: Date;
}

export type InsightKind = "streak" | "weekday" | "anomaly" | "comparison";
/** Emphasis — drives ordering and visual weight. */
export type Level = "low" | "medium" | "high";
/** UI color cue. Separate from importance so a high-emphasis insight can still read neutral. */
export type Tone = "positive" | "negative" | "neutral";

/** A single computed, narrated, ranked insight. UI consumes this uniformly. */
export interface Insight {
    /** Stable, deterministic id, e.g. "anomaly-top". */
    id: string;
    kind: InsightKind;
    /** Short headline, e.g. "Friday above baseline". */
    title: string;
    /** Full narrated sentence. Descriptive by default; assertive only when supported. */
    body: string;
    /** Ranking weight (see rank.ts). */
    score: number;
    /** How much to emphasise it. */
    importance: Level;
    /** How assertive the body is allowed to be (gated on data support). */
    confidence: Level;
    tone: Tone;
    /** Structured facts for tooltip / export. */
    detail?: Record<string, number | string>;
}

/**
 * What counts as "inactive" for streaks — varies by vertical:
 *  - "zero": a recorded 0 is inactive; gaps are ignored (deployments).
 *  - "gap":  a missing day is inactive; recorded 0s are not (some HR feeds).
 *  - "either": both count as inactive (most activity use-cases — default).
 */
export type InactiveMeaning = "zero" | "gap" | "either";

/**
 * Whether higher values are good, bad, or neither. Drives tone/color: the
 * engine can't know if "more" is desirable (sales) or undesirable (breaches),
 * so the user declares it. Default "neutral" — we never color insights
 * good/bad until the user picks a direction, so an error/outage spike is
 * never shown green out of the box. Pick "good"/"bad" to enable green/red cues.
 */
export type Polarity = "good" | "bad" | "neutral";

export interface InsightConfig {
    inactiveMeans: InactiveMeaning;
    /** A day is active when `value > activeThreshold`. */
    activeThreshold: number;
    /** "mad" (robust, default) handles right-skewed data; "stddev" is the fallback. */
    anomalyMethod: "mad" | "stddev";
    /** How many insights to surface (keeps the card clean). */
    maxInsights: number;
    /** Fiscal year start month (1=Jan default .. 12=Dec); shifts YoY year + quarter boundaries. */
    fiscalStartMonth: number;
    /** Good/bad direction of value — drives positive/negative tone. */
    polarity: Polarity;
}

export const DEFAULT_INSIGHT_CONFIG: InsightConfig = {
    inactiveMeans: "either",
    activeThreshold: 0,
    anomalyMethod: "mad",
    maxInsights: 3,
    fiscalStartMonth: 1,
    polarity: "neutral",
};
