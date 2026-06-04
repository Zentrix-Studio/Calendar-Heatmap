"use strict";

/**
 * Extract the FULL pre-cap daily series for the insight engine.
 *
 * The render pipeline (model/dataTransform.ts) caps the grid at ~2,200 days
 * and keeps only the most-recent window — correct for rendering, wrong for
 * compute. This re-enumerates the entire data extent and left-joins the
 * aggregated values, so YoY / streaks / seasonality see every day.
 *
 * Host-agnostic: imports only the pure `model/dateGrid` enumerator and
 * `./types`. No Power BI, no d3.
 */

import { enumerateDays } from "../model/dateGrid";
import { DailyDatum, DailySeries } from "./types";

export interface ExtractSeriesParams {
    /**
     * Aggregated value per day, keyed by local-midnight epoch ms
     * (`new Date(y,m,d).getTime()`) — the SAME key the data pipeline uses.
     * Days absent from the map render as gaps (`value: null`).
     */
    aggregatedByDay: ReadonlyMap<number, number>;
    /** Inclusive data extent. */
    min: Date;
    max: Date;
    /** Value field display name, for narration. */
    valueName: string;
    /** Injected "today". */
    referenceDate: Date;
}

export function extractSeries(p: ExtractSeriesParams): DailySeries {
    // enumerateDays returns local-midnight Dates, so getTime() matches the key.
    const days = enumerateDays(p.min, p.max);
    const data: DailyDatum[] = days.map(date => {
        const v = p.aggregatedByDay.get(date.getTime());
        return { date, value: v === undefined ? null : v };
    });
    return { data, valueName: p.valueName, referenceDate: p.referenceDate };
}
