"use strict";

/**
 * Public entry point for the deterministic insight engine.
 * Pure: DailySeries in -> ranked Insight[] out. The host builds the series via
 * insights/series.ts#extractSeries, then calls this.
 */

import { DailySeries, InsightConfig, DEFAULT_INSIGHT_CONFIG, Insight } from "./types";
import { computeStreaks } from "./streaks";
import { computeWeekdayPatterns } from "./weekdayPatterns";
import { computeAnomalies } from "./anomalies";
import { computeComparisons } from "./comparisons";
import { generateInsights } from "./narratives";
import { rankInsights } from "./rank";

/** Does the series run up to yesterday or later? Only then is a streak "current". */
export function reachesToday(series: DailySeries, now: Date = new Date()): boolean {
    const last = series.data[series.data.length - 1]?.date;
    if (!last) return false;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
    return new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime() >= yesterday;
}

export function computeInsights(
    series: DailySeries,
    config: InsightConfig = DEFAULT_INSIGHT_CONFIG,
    topN = 3,
): Insight[] {
    // Multi-year when the full series range crosses a calendar-year boundary —
    // drives year-stamping on dated insights so "Sep 15" can't mean two Sept 15ths.
    const firstYear = series.data[0]?.date.getFullYear();
    const multiYear = series.data.some(d => d.date.getFullYear() !== firstYear);
    const candidates = generateInsights({
        valueName: series.valueName,
        streaks: computeStreaks(series, config),
        weekdays: computeWeekdayPatterns(series),
        anomalies: computeAnomalies(series),
        comparison: computeComparisons(series, config.fiscalStartMonth) ?? undefined,
        polarity: config.polarity,
        multiYear,
        formatNumber: config.formatNumber,
        current: reachesToday(series, config.today),
    });
    return rankInsights(candidates, topN);
}

export * from "./types";
export { extractSeries } from "./series";
export { computeStreaks } from "./streaks";
export { computeWeekdayPatterns } from "./weekdayPatterns";
export { computeAnomalies } from "./anomalies";
export { computeComparisons } from "./comparisons";
export { generateInsights } from "./narratives";
export { rankInsights, scoreInsight } from "./rank";
