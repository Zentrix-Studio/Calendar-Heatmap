"use strict";

/**
 * Pure responsive-density helpers — no Power BI / d3 imports so they're shared
 * by the renderers and the responsive planner without an import cycle.
 *
 * The heatmap cells are the hero: as the available cell size shrinks, the
 * surrounding labels degrade (thin out, then hide) instead of letting cells
 * collapse to an unreadable floor or letting labels overlap. These constants
 * are the per-element cut-offs, expressed in final cell-edge px.
 */

/** Below this cell size the Mon/Wed/Fri rail rows touch — drop the rail. */
export const MIN_WEEKDAY_CELL = 7;
/** Below this, a month panel is too small to caption — drop month-block labels. */
export const MIN_MONTHLABEL_CELL = 5;
/** Below this, small-multiple panels are sparkline-sized — drop facet titles. */
export const MIN_FACET_TITLE_CELL = 4;

/** Rough advance width of a string at `fontPx` (matches the estimator used for
 * truncation elsewhere — Segoe UI averages ~0.62em per glyph). */
export function estTextWidth(text: string, fontPx: number): number {
    return text.length * fontPx * 0.62;
}

export interface ColLabel {
    label: string;
    col: number;
}

/**
 * Greedy left→right thinning for column-anchored labels (e.g. month names on
 * the continuous grid). Keeps a label only when its anchor clears the previously
 * *kept* label's estimated right edge + pad. A kept label is never moved, so the
 * surviving names stay correctly aligned to their columns. As `step` shrinks the
 * cadence naturally coarsens (every month → quarterly → a couple of anchors),
 * which is exactly the "show Jan, hide Feb/Mar, show Apr…" behavior we want —
 * the cells stay, only the redundant captions drop.
 */
export function thinMonthLabels<T extends ColLabel>(
    labels: T[], step: number, fontPx: number, padPx = 4,
): T[] {
    const kept: T[] = [];
    let lastRight = -Infinity;
    for (const l of labels) {
        const x = l.col * step;
        if (x >= lastRight + padPx) {
            kept.push(l);
            lastRight = x + estTextWidth(l.label, fontPx);
        }
    }
    return kept;
}
