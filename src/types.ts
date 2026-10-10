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
    /** `raw` + `format` let a numeric field go through the number formatter at display
     *  time (its own format string, the author's units) — zentrix-qa#2/#19. */
    tooltips?: { name: string; value: string; raw?: unknown; format?: string }[];
    /** Aggregated Target-role goal for this day, or null when none is bound/present. */
    target?: number | null;
    // NB (Z-152): there is deliberately no `annotation` field. Annotations used to
    // come from a bound column; they are now AUTHOR-WRITTEN and live in the
    // persisted note store (notes/store.ts), keyed by ISO date rather than carried
    // on the cell. Look them up with `NoteStore.get(cell)`.
    /** Holiday name from the optional Holiday field (HM-V2-10); undefined = not a holiday. */
    holiday?: string;
    /** Event names from the optional Event field (HM-V2-11), in data order; undefined = none. */
    events?: string[];
    /** Event type from the optional Event type field — colours the event marker. */
    eventType?: string;
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
    /** True on a model rebuilt from another visual's cross-highlight (zentrix-qa#12):
     *  the Table and Insight views say so. */
    highlighted?: boolean;
    /** Full (pre-cap) daily series for the insight engine; gaps as null. */
    series?: DailySeries;
    /** Display names of the optional text fields, when bound AND usable. */
    holidayName?: string;
    eventName?: string;
    eventTypeName?: string;
    /** Distinct event types in first-seen order (drives marker colours + the key). */
    eventTypes?: string[];
    /** Plain-words problems with a bound field (e.g. a text field summarized as
     *  "Count of"), surfaced honestly instead of silently ignored. */
    fieldIssues?: string[];
}

/** One weekday × hour bucket of the Hours layout (HM-V2-12). */
export interface HourCell {
    /** 0 = Sunday … 6 = Saturday (Date.getDay). */
    weekday: number;
    /** 0 … 23, local time. */
    hour: number;
    /** Aggregated value (per the Aggregate setting) or null when no row fell here. */
    value: number | null;
    /** Rows that contributed (non-null values). */
    rows: number;
    /** Selection ids of every contributing row — a click cross-filters them all. */
    selectionIds: ISelectionId[];
    /** Grid position, by the week-start setting: row = weekday slot, col = hour. */
    row: number;
    col: number;
    px?: number;
    py?: number;
    ps?: number;
}

export interface HourModel {
    cells: HourCell[];
    valueDomain: [number, number];
    /** False when every timestamp sits at midnight — the Date field carries no time
     *  of day, so an hour view would be one meaningless column. */
    hasTime: boolean;
    valueName: string;
    aggMode: AggregationMode;
    firstDayOfWeek: number;
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
    /**
     * EVERY Split-by group with its aggregated days over the calendar's window — not
     * just the panels that fit (zentrix-qa#23). The Table's group grain and the Insight
     * page's Groups card rank these, so "largest group" and "% of total" share the
     * Total card's basis. Undefined without a Split-by.
     */
    groups?: { key: string; days: DayCell[] }[];
}

/** Why the visual could not render a grid (drives the empty/instructional state). */
export type EmptyReason =
    | "noData"        // nothing bound
    | "missingDate"   // value but no date
    | "missingValue"  // date but no value
    | "noValues"      // both bound, but nothing to draw under the current filters
    | "notADate";     // the Date well holds something that isn't a date
