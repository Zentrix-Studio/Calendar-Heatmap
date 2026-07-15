"use strict";

import { GroupSel, GridOptions, GridGeometry, CellSel, renderGrid, predictGridSize } from "./grid";
import { renderMonthBlocks, predictMonthBlocksSize } from "./monthBlocks";
import { Facet, DayCell } from "../types";
import { ColorAccessor } from "./colors";
import { TextStyle, applyText } from "./text";
import { MIN_FACET_TITLE_CELL } from "./density";

/** Base grid options shared by every panel (per-panel box + colors are filled in). */
type GridBase = Omit<GridOptions, "width" | "height" | "originX" | "originY" | "colors" | "topOffset">;

export interface FacetLayoutOptions {
    /** Absolute canvas rect the panels tile into. */
    region: { x: number; y: number; w: number; h: number };
    /** Fixed panel columns; 0 = auto-fit for the largest cells. */
    columns: number;
    /** Use the month-block renderer per panel (else the continuous grid). */
    monthLayout: boolean;
    titleStyle: TextStyle;
    titleColor: string;
    gridBase: GridBase;
    /** Color accessor for panel i (shared scale → same accessor for all). */
    colorsFor: (i: number) => ColorAccessor;
}

const PANEL_GAP = 14;

/** Tile geometry shared by the predictor and the renderer (column count + tile box). */
function facetTiles(facets: Facet[], o: FacetLayoutOptions): { cols: number; rows: number; tileW: number; tileH: number; titleH: number } {
    const { region } = o;
    const titleH = Math.round(o.titleStyle.size + 8);
    const aspect = naturalAspect(facets[0], o.monthLayout);
    const cols = o.columns && o.columns > 0
        ? Math.min(o.columns, facets.length)
        : pickColumns(facets.length, region.w, region.h, titleH, aspect);
    const rows = Math.ceil(facets.length / cols);
    const tileW = (region.w - PANEL_GAP * (cols - 1)) / cols;
    const tileH = (region.h - PANEL_GAP * (rows - 1)) / rows;
    return { cols, rows, tileW, tileH, titleH };
}

/** Cell size each panel would get (titles assumed shown) — drives chrome reservation. */
export function predictFacetSize(facets: Facet[], o: FacetLayoutOptions): number {
    const { tileW, tileH, titleH } = facetTiles(facets, o);
    const gridOpts = { ...o.gridBase, width: tileW, height: tileH - titleH, originX: 0, originY: 0, topOffset: 0 } as GridOptions;
    return o.monthLayout
        ? predictMonthBlocksSize(facets[0].model, gridOpts, tileW, tileH - titleH)
        : predictGridSize(facets[0].model, gridOpts, tileW, tileH - titleH);
}

/** Estimate a panel's natural grid aspect from its model (rough — only used to
 * pick the column count; the renderer fits the cells exactly afterwards). */
function naturalAspect(f: Facet, monthLayout: boolean): { w: number; h: number } {
    const [start, end] = f.model.range;
    const years = end.getFullYear() - start.getFullYear() + 1;
    if (monthLayout) {
        const months = Math.max(1, Math.round((f.model.totalDays) / 30));
        const side = Math.ceil(Math.sqrt(months));
        return { w: side * 6, h: side * 7 };
    }
    return { w: Math.min(53, Math.max(1, f.model.weeks)), h: 7 * years };
}

/** Choose the panel column count that lets cells grow largest in the region. */
function pickColumns(n: number, regionW: number, regionH: number, titleH: number, aspect: { w: number; h: number }): number {
    let best = 1, bestSize = -Infinity;
    for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const tileW = (regionW - PANEL_GAP * (cols - 1)) / cols;
        const tileH = (regionH - PANEL_GAP * (rows - 1)) / rows - titleH;
        if (tileW <= 0 || tileH <= 0) continue;
        const size = Math.min(tileW / aspect.w, tileH / aspect.h);
        if (size > bestSize + 0.001) { bestSize = size; best = cols; }
    }
    return best;
}

/** Truncate a label to roughly fit `widthPx` at the given font size. */
function fit(text: string, widthPx: number, fontSize: number): string {
    const maxChars = Math.max(1, Math.floor(widthPx / (fontSize * 0.62)));
    return text.length <= maxChars ? text : text.slice(0, Math.max(1, maxChars - 1)) + "…";
}

/**
 * Render small-multiple panels — one calendar per facet — tiled into `region`.
 * Each panel draws into its own <g> (so the per-panel cell data-join is isolated)
 * at absolute coordinates, so the shared overlay layers (hover / selection / today)
 * line up via each cell's px/py. Returns the union cell selection + the block geo.
 */
export function renderFacets(group: GroupSel, facets: Facet[], o: FacetLayoutOptions): { geo: GridGeometry; cells: CellSel } {
    const { region } = o;
    const { cols, tileW, tileH, titleH } = facetTiles(facets, o);

    // Drop the per-panel titles once panels shrink to sparkline size — the cells
    // are the signal there, and the title strip is reclaimed for them.
    const showTitles = predictFacetSize(facets, o) >= MIN_FACET_TITLE_CELL;
    const effTitleH = showTitles ? titleH : 0;

    facets.forEach((f, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x = region.x + c * (tileW + PANEL_GAP);
        const y = region.y + r * (tileH + PANEL_GAP);

        const fg = group.append("g").classed("facet", true);

        // Panel title (category value), truncated to the panel width.
        if (showTitles) {
            applyText(fg.append("text").classed("facet-title", true)
                .attr("x", x + 2).attr("y", y + effTitleH - 6)
                .text(fit(f.key || "—", tileW - 4, o.titleStyle.size)),
                o.titleStyle, o.titleColor);
        }

        const gridOpts: GridOptions = {
            ...o.gridBase,
            colors: o.colorsFor(i),
            width: tileW,
            height: tileH - effTitleH,
            originX: x,
            originY: y + effTitleH,
            topOffset: 0,
        };
        if (o.monthLayout) renderMonthBlocks(fg, f.model, gridOpts);
        else renderGrid(fg, f.model, gridOpts);
    });

    // Union of every panel's cells (datum already bound at creation).
    const cells = group.selectAll<SVGRectElement, DayCell>("rect.cell");
    const geo: GridGeometry = {
        size: 0, stepX: 0, stepY: 0,
        marginLeft: region.x, marginTop: region.y,
        gridWidth: region.w, gridHeight: region.h,
    };
    return { geo, cells };
}
