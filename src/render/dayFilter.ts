"use strict";

import { DayCell } from "../types";
import { ColorAccessor } from "./colors";

/** Filter › Show — the family's ranking vocabulary (SETTINGS-TAXONOMY.md). */
export type DayFilterMode = "off" | "top" | "bottom";

/**
 * Filter › Top N / Bottom N days (HM-V2-20).
 *
 * A calendar cannot drop a day the way a bar chart drops a bar — the grid IS the
 * dates, and a hole would read as "no data". So the filter keeps the N highest (or
 * lowest) days in colour and paints every other day in the no-data colour. The days
 * stay in place, keep their tooltip, and stay clickable; the legend, the Table and the
 * Insight page still read every day.
 *
 * Ranked across everything drawn (all panels when a Split-by is bound). Days without
 * a value never rank. Ties break by date (earlier first) so the cut is deterministic
 * — the same data always keeps the same days. Returns null when the filter is off,
 * so the caller can skip wrapping altogether.
 */
export function rankedDays(days: readonly DayCell[], mode: DayFilterMode, n: number): Set<DayCell> | null {
    if (mode !== "top" && mode !== "bottom") return null;
    const count = Math.max(1, Math.floor(Number(n) || 0));
    const valued = days.filter(d => d.value != null && Number.isFinite(d.value));
    const dir = mode === "top" ? -1 : 1;
    valued.sort((a, b) => dir * ((a.value as number) - (b.value as number)) || a.date.getTime() - b.date.getTime());
    return new Set(valued.slice(0, count));
}

/** Wrap a colour accessor so days outside the kept set paint as no-data. Swatches,
 *  stops and the bucket count are untouched, so the legend still describes the scale. */
export function filterColors(acc: ColorAccessor, keep: Set<DayCell> | null): ColorAccessor {
    if (!keep) return acc;
    return { ...acc, of: (cell: DayCell) => (keep.has(cell) ? acc.of(cell) : acc.noData) };
}
