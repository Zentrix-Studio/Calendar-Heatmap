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
