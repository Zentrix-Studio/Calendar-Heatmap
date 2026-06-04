"use strict";

/**
 * Narrative layer — turns the stat summaries into ranked, human Insight objects.
 * This is the only place "what it likely means" lives; the stat modules stay
 * purely factual. Pure: imports the summaries + ./rank + ./types.
 *
 * House rules (AppSource / enterprise trust):
 *  - Descriptive by default. Escalate to assertive ("consistently … a repeatable
 *    weekly pattern") ONLY when the data supports it (enough count, large enough
 *    delta, low enough volatility).
 *  - NEVER use causal language ("caused by", "because", "due to"). The engine
 *    can't know the cause; it asserts repeatability, not reasons.
 */

import { Insight, InsightKind, Level, Tone, Polarity } from "./types";
import { StreakSummary } from "./streaks";
import { WeekdayPatterns } from "./weekdayPatterns";
import { AnomalySummary } from "./anomalies";
import { ComparisonResult } from "./comparisons";
import { scoreInsight } from "./rank";

/**
 * Map an event direction to a good/bad/neutral tone given the metric's polarity.
 * "up" = more/active/high; "down" = less/inactive/low. Shared by the card dots
 * and (mirrored) by the tooltip so color always agrees.
 */
export function valence(dir: "up" | "down", polarity: Polarity): Tone {
    if (polarity === "neutral") return "neutral";
    const good = polarity === "good" ? dir === "up" : dir === "down";
    return good ? "positive" : "negative";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Sep 15", or "Sep 15 2025" when the series spans multiple years (disambiguates which Sep 15). */
function fmtDay(d: Date, showYear = false): string {
    return showYear ? `${MONTHS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function fmtRange(a: Date, b: Date, showYear = false): string {
    // Cross-year ranges always carry both years; same-year ranges add the year only
    // when the overall data is multi-year (so "May 1–May 7" can't mean two Mays).
    if (a.getFullYear() !== b.getFullYear()) return `${fmtDay(a, true)}–${fmtDay(b, true)}`;
    return showYear ? `${fmtDay(a)}–${fmtDay(b)} ${a.getFullYear()}` : `${fmtDay(a)}–${fmtDay(b)}`;
}
function pct(frac: number): number { return Math.round(Math.abs(frac) * 100); }
function round1(x: number): number { return Math.round(x * 10) / 10; }
/** Coefficient of variation; Infinity when the mean is 0 (treated as volatile). */
function cv(stddev: number, mean: number): number {
    const m = Math.abs(mean);
    return m === 0 ? Infinity : stddev / m;
}

function make(
    id: string, kind: InsightKind, title: string, body: string,
    importance: Level, confidence: Level, tone: Tone, magnitude: number,
    detail?: Record<string, number | string>,
): Insight {
    return { id, kind, title, body, importance, confidence, tone, score: scoreInsight(kind, importance, magnitude), detail };
}

function streakImportance(len: number): Level {
    return len >= 7 ? "high" : len >= 3 ? "medium" : "low";
}

export function narrateStreaks(s: StreakSummary, polarity: Polarity = "neutral", showYear = false): Insight[] {
    const out: Insight[] = [];
    // An all-active series has a trivially long active streak — don't over-emphasise it.
    const trivialAllActive = s.activeDaysPct === 1;

    const la = s.longestActive;
    if (la.length >= 2 && la.start && la.end) {
        out.push(make(
            "streak-active-longest", "streak", "Longest active streak",
            `Active streak reached ${la.length} consecutive days (${fmtRange(la.start, la.end, showYear)}).`,
            trivialAllActive ? "low" : streakImportance(la.length), "high", valence("up", polarity), la.length / 5,
            { length: la.length },
        ));
    }
    const li = s.longestInactive;
    if (li.length >= 2 && li.start && li.end) {
        out.push(make(
            "streak-inactive-longest", "streak", "Longest inactive streak",
            `Longest inactive streak lasted ${li.length} days (${fmtRange(li.start, li.end, showYear)}).`,
            streakImportance(li.length), "high", valence("down", polarity), li.length / 5,
            { length: li.length },
        ));
    }
    if (s.currentInactive >= 2) {
        out.push(make(
            "streak-current-inactive", "streak", "Current inactivity",
            `No activity for ${s.currentInactive} straight days.`,
            streakImportance(s.currentInactive), "high", valence("down", polarity), s.currentInactive / 5,
            { length: s.currentInactive },
        ));
    } else if (s.currentActive >= 2 && !trivialAllActive) {
        out.push(make(
            "streak-current-active", "streak", "Current streak",
            `Activity has continued for ${s.currentActive} straight days.`,
            s.currentActive >= 7 ? "medium" : "low", "high", valence("up", polarity), s.currentActive / 5,
            { length: s.currentActive },
        ));
    }
    return out;
}

export function narrateWeekday(w: WeekdayPatterns): Insight[] {
    const out: Insight[] = [];
    const s = w.strongest;
    if (s) {
        const dir = s.deltaPct >= 0 ? "above" : "below";
        const wd = WEEKDAYS[s.weekday];
        const stable = s.count >= 4 && Math.abs(s.deltaPct) >= 0.15 && cv(s.stddev, s.mean) < 0.5;
        const medium = s.count >= 3 && Math.abs(s.deltaPct) >= 0.10;
        const confidence: Level = stable ? "high" : medium ? "medium" : "low";
        const importance: Level = stable && Math.abs(s.deltaPct) >= 0.20 ? "high" : medium ? "medium" : "low";
        const body = stable
            ? `${wd}s consistently averaged ${pct(s.deltaPct)}% ${dir} baseline — a repeatable weekly pattern.`
            : `${wd}s averaged ${pct(s.deltaPct)}% ${dir} baseline.`;
        out.push(make(
            "weekday-strongest", "weekday", `${wd} ${dir} baseline`, body,
            importance, confidence, "neutral", (Math.abs(s.deltaPct) * 100) / 5,
            { weekday: s.weekday, deltaPct: round1(s.deltaPct * 100), count: s.count },
        ));
    }
    const wk = w.weakest;
    if (wk && wk !== s && Math.abs(wk.deltaPct) >= 0.15) {
        const dir = wk.deltaPct >= 0 ? "above" : "below";
        const wd = WEEKDAYS[wk.weekday];
        out.push(make(
            "weekday-weakest", "weekday", `${wd} ${dir} baseline`,
            `${wd}s averaged ${pct(wk.deltaPct)}% ${dir} baseline.`,
            "medium", wk.count >= 3 ? "medium" : "low", "neutral", (Math.abs(wk.deltaPct) * 100) / 5,
            { weekday: wk.weekday, deltaPct: round1(wk.deltaPct * 100), count: wk.count },
        ));
    }
    return out;
}

export function narrateAnomalies(a: AnomalySummary, polarity: Polarity = "neutral", showYear = false): Insight[] {
    const out: Insight[] = [];
    const top = a.strongest;
    if (top) {
        const z = round1(Math.abs(top.score));
        // Plain language — the raw modified-z stays in `detail` / the tooltip, not the sentence.
        const mag = top.severity === "strong" ? "well " : "";
        const dirWord = top.direction === "high" ? "above" : "below";
        out.push(make(
            "anomaly-top", "anomaly", `${fmtDay(top.date, showYear)} stood out`,
            `${fmtDay(top.date, showYear)} stood out at ${top.value} — ${mag}${dirWord} a typical day.`,
            top.severity === "strong" ? "high" : "medium",
            top.severity === "strong" ? "high" : "medium",
            valence(top.direction === "high" ? "up" : "down", polarity),
            Math.abs(top.score),
            { date: fmtDay(top.date, showYear), value: top.value, z, method: a.method },
        ));
    }
    const count = a.countModerate + a.countStrong;
    if (count >= 3) {
        out.push(make(
            "anomaly-count", "anomaly", "Multiple unusual days",
            `${count} unusual days stand out in this period.`,
            "medium", "medium", "neutral", Math.min(count, 9),
            { count },
        ));
    }
    return out;
}

/** Month abbreviation for a calendar month/day ordinal (m*100+d). */
function monthName(ordinal: number): string { return MONTHS[Math.floor(ordinal / 100) - 1]; }

export function narrateComparison(c: ComparisonResult, valueName: string, polarity: Polarity = "neutral"): Insight[] {
    const out: Insight[] = [];
    const up = c.totalDeltaPct >= 0;
    const dir: "up" | "down" = up ? "up" : "down";
    const yr = (y: number) => (c.fiscal ? `FY${y}` : `${y}`);
    // Fiscal years wrap the calendar, so a calendar month name would mislead - only
    // name the cutoff month for calendar-year (non-fiscal) comparisons.
    const when = c.partial ? (c.fiscal ? " so far" : ` so far (through ${monthName(c.window.toOrdinal)})`) : "";
    out.push(make(
        "comparison-yoy", "comparison", `${yr(c.currentYear)} vs ${yr(c.priorYear)}`,
        `${valueName} is ${up ? "up" : "down"} ${pct(c.totalDeltaPct)}% vs ${yr(c.priorYear)}${when}.`,
        Math.abs(c.totalDeltaPct) >= 0.20 ? "high" : Math.abs(c.totalDeltaPct) >= 0.10 ? "medium" : "low",
        "high", valence(dir, polarity), (Math.abs(c.totalDeltaPct) * 100) / 5,
        {
            currentYear: c.currentYear, priorYear: c.priorYear,
            totalDeltaPct: round1(c.totalDeltaPct * 100), avgDeltaPct: round1(c.avgDeltaPct * 100),
        },
    ));
    if (c.byQuarter.length) {
        let top = c.byQuarter[0];
        for (const q of c.byQuarter) if (Math.abs(q.deltaPct) > Math.abs(top.deltaPct)) top = q;
        if (Math.abs(top.deltaPct) >= 0.15) {
            const qUp = top.deltaPct >= 0;
            out.push(make(
                "comparison-quarter", "comparison", `Q${top.q} ${qUp ? "up" : "down"} YoY`,
                `Q${top.q} ${qUp ? "rose" : "fell"} ${pct(top.deltaPct)}% vs ${yr(c.priorYear)}.`,
                "medium", "medium", valence(qUp ? "up" : "down", polarity), (Math.abs(top.deltaPct) * 100) / 5,
                { q: top.q, deltaPct: round1(top.deltaPct * 100) },
            ));
        }
    }
    return out;
}

export interface InsightInputs {
    valueName: string;
    streaks?: StreakSummary;
    weekdays?: WeekdayPatterns;
    anomalies?: AnomalySummary;
    comparison?: ComparisonResult;
    polarity?: Polarity;
    /** True when the series spans 2+ calendar years — stamps the year on dated insights. */
    multiYear?: boolean;
}

/** Build all candidate insights (unranked) from whichever summaries are present. */
export function generateInsights(input: InsightInputs): Insight[] {
    const out: Insight[] = [];
    const polarity = input.polarity ?? "neutral";
    const showYear = input.multiYear ?? false;
    if (input.streaks) out.push(...narrateStreaks(input.streaks, polarity, showYear));
    if (input.weekdays) out.push(...narrateWeekday(input.weekdays));
    if (input.anomalies) out.push(...narrateAnomalies(input.anomalies, polarity, showYear));
    if (input.comparison) out.push(...narrateComparison(input.comparison, input.valueName, polarity));
    return out;
}
