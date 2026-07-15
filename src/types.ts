"use strict";

import type powerbi from "powerbi-visuals-api";
import type { DailySeries } from "./insights/types";
type ISelectionId = powerbi.visuals.ISelectionId;

/**
 * Shared domain types for the Zentrix Calendar Heatmap.
 * The data pipeline (milestone 2) produces a CalendarModel; render/interaction
 * layers consume it. Keeping these in one place keeps the update loop honest.
 */

/** One day in the synthesized calendar grid. */
export interface DayCell {
    /** Midnight-local date for this cell. */
    date: Date;
    /** Aggregated value, or null when the day has no underlying row. */
    value: number | null;
    /** True when no model row exists for this day (renders as No-data). */
    noData: boolean;
    /** Column index = week index within the rendered range. */
    col: number;
    /** Row index = weekday (0..6), ordered by first-day-of-week. */
    row: number;
    /** Selection id for cross-filtering; null for no-data days. */
    selectionId: ISelectionId | null;
    /** Index into the source category (for highlights); -1 for no-data. */
    sourceIndex: number;
    /** Aggregated highlight value when the host supplies a `values[].highlights[]`
     * array (cross-highlight from another visual). null when this day is not part
     * of the active highlight; undefined when no highlight is in effect. */
    highlightValue?: number | null;
    /** True when a highlight array is present AND this day is highlighted (non-null,
     * non-zero). Drives the cross-highlight dim; undefined in the normal path. */
    isHighlighted?: boolean;
    /** Pixel box assigned by the active renderer (continuous or month-block). */
    px?: number;
    py?: number;
    ps?: number;
    /** Extra Tooltips-role fields to surface, e.g. [{name:"SLA Breaches", value:"3"}]. */
    tooltips?: { name: string; value: string }[];
    /** Aggregated Target-role goal for this day, or null when none is bound/present. */
    target?: number | null;
    // NB (Z-152): there is deliberately no `annotation` field. Annotations used to
    // come from a bound column; they are now AUTHOR-WRITTEN and live in the
    // persisted note store (notes/store.ts), keyed by ISO date rather than carried
    // on the cell. Look them up with `NoteStore.get(cell)`.
    /** Category value of the facet this cell belongs to (small multiples); undefined in single-grid mode. */
    facetKey?: string;
    /** Zero-based facet index, in render order. 0 for the single-grid case. */
    facetIndex?: number;
}

/** How multiple rows on the same day are combined into one cell value. */
export type AggregationMode = "sum" | "avg" | "min" | "max" | "count";

/** A month label anchored to the first week column containing that month. */
export interface MonthLabel {
    /** Short month name, e.g. "Jan". */
    label: string;
    /** Column index where the label is drawn. */
    col: number;
}

/** The fully-resolved model handed from data pipeline to renderers. */
export interface CalendarModel {
    days: DayCell[];
    monthLabels: MonthLabel[];
    /** Inclusive date range actually rendered. */
    range: [Date, Date];
    /** Value extent over non-null days, [min, max]. */
    valueDomain: [number, number];
    /** Number of week columns. */
    weeks: number;
    /** True only when today falls within `range` (spec DECISION 5). */
    hasToday: boolean;
    /** Display name of the value field, for tooltip/legend/header. */
    valueName: string;
    /** How day values were aggregated — lets the tooltip/panel use count-appropriate
     *  wording and suppress target comparisons that don't apply to a row count. */
    aggMode: AggregationMode;
    /** Display name of the Target field, for the tooltip; undefined when none is bound. */
    targetName?: string;
    /** Total days in the data extent before any render cap was applied. */
    totalDays: number;
    /** True when the host supplied a `values[].highlights[]` array (external
     * cross-highlight active). Drives whether the render path dims un-highlighted
     * cells; false/undefined = normal render, identical to the no-highlight path. */
    hasHighlights?: boolean;
    /** Full (pre-cap) daily series for the insight engine; gaps as null. */
    series?: DailySeries;
}

/** One small-multiple panel: a category value and its own calendar model. */
export interface Facet {
    /** Category value shown as the panel title. */
    key: string;
    /** Fully-resolved model for this panel, over the shared date range. */
    model: CalendarModel;
}

/**
 * What the visual renders for one update. In single-grid mode `facets` has one
 * entry and `combined === facets[0].model`. With a Split-by field bound, `facets`
 * holds one panel per category and `combined` is the all-categories rollup used
 * for the header / insights / legend chrome.
 */
export interface FacetedRender {
    facets: Facet[];
    /** All-categories daily rollup — drives header KPI, insights, and the cap note. */
    combined: CalendarModel;
    /** Value extent across every panel's day values — the shared color scale domain. */
    sharedDomain: [number, number];
    /** Display name of the Split-by field; undefined in single-grid mode. */
    categoryName?: string;
    /** Distinct category count before any facet cap was applied. */
    totalCategories: number;
}

/** Why the visual could not render a grid (drives the empty/instructional state). */
export type EmptyReason =
    | "noData"        // nothing bound
    | "missingDate"   // value but no date
    | "missingValue"; // date but no value
