"use strict";

/**
 * Responsive chrome planner — decides which surrounding bands (KPI header,
 * legend, insights) survive so the heatmap cells stay legible.
 *
 * The visual used to reserve every band up front and let the grid clamp its
 * cells to a 3px floor, which produced overlapping labels and unreadable cells
 * on small canvases. Instead, this planner starts with everything on, predicts
 * the cell size the grid would get, and — while that size is below a legibility
 * floor — drops the lowest-priority band and re-predicts. Monotone (it only ever
 * drops, in a fixed order) so it converges and never oscillates.
 *
 * Drop order (first dropped → kept longest): insights count → insights off →
 * legend → header. KPI chips / rule / legend labels are clutter-only (no height
 * reclaim) so they're gated purely on the final cell size, not the drop loop.
 *
 * Pure: takes a `predict(top, bottom)` callback (px of reserved chrome above /
 * below the grid → resulting cell size) so it's agnostic to single vs faceted
 * vs month-block layout — the caller wires the right predictor.
 */

export interface PlanInput {
    /** Reserved band height (px) when the KPI header is shown; 0 if not requested. */
    headerH: number;
    /** Reserved band height (px) when the legend is shown; 0 if not requested. */
    legendH: number;
    /** Legend docks above the grid (true) or below (false). */
    legendTop: boolean;
    /** Requested number of insight lines (0 if insights are off/unavailable). */
    insightsCount: number;
    /** Per-insight-line height and fixed card overhead (header label + padding). */
    insightsLineH: number;
    insightsOverhead: number;
    /** Resulting cell size for a given (top, bottom) reserved-px split. */
    predict: (top: number, bottom: number) => number;
    /** Keep dropping chrome until the cell size reaches this floor (or we run out). */
    floor: number;
}

export interface ChromePlan {
    showHeader: boolean;
    /** Total / Peak chips (only when the header is shown and cells are large enough). */
    showHeaderChips: boolean;
    /** The accent rule under the header. */
    showHeaderRule: boolean;
    showLegend: boolean;
    /** Less/More + value labels on the legend. */
    legendLabels: boolean;
    /** Insight lines actually rendered (0 = card hidden). */
    insightsCount: number;
    /** Predicted final cell size, for callers that want to gate their own detail. */
    size: number;
}

/** Cell-size cut-offs for clutter-only elements (px of final cell edge). */
const CHIPS_MIN = 8;
const RULE_MIN = 6;
const LEGEND_LABELS_MIN = 7;

export function planChrome(input: PlanInput): ChromePlan {
    const insightsH = (n: number) => (n > 0 ? input.insightsOverhead + n * input.insightsLineH : 0);

    const state = {
        header: input.headerH > 0,
        legend: input.legendH > 0,
        insights: input.insightsCount,
    };

    const reserve = () => {
        const top = (state.header ? input.headerH : 0) + (state.legend && input.legendTop ? input.legendH : 0);
        const bottom = (state.legend && !input.legendTop ? input.legendH : 0) + insightsH(state.insights);
        return { top, bottom };
    };

    let { top, bottom } = reserve();
    let size = input.predict(top, bottom);

    // Lowest-priority → highest. Each step trims one band; insights shed a line
    // at a time before vanishing. We advance to the next step only once the
    // current one can give no more (so insights fully drains before the legend).
    const steps: Array<() => boolean> = [
        () => { if (state.insights > 0) { state.insights--; return true; } return false; },
        () => { if (state.legend) { state.legend = false; return true; } return false; },
        () => { if (state.header) { state.header = false; return true; } return false; },
    ];

    let i = 0;
    while (size < input.floor && i < steps.length) {
        if (steps[i]()) {
            ({ top, bottom } = reserve());
            size = input.predict(top, bottom);
        } else {
            i++;
        }
    }

    return {
        showHeader: state.header,
        showHeaderChips: state.header && size >= CHIPS_MIN,
        showHeaderRule: state.header && size >= RULE_MIN,
        showLegend: state.legend,
        legendLabels: state.legend && size >= LEGEND_LABELS_MIN,
        insightsCount: state.insights,
        size,
    };
}
