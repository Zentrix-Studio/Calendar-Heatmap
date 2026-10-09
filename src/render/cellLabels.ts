"use strict";

/**
 * Labels › Cell values (HM-V2-32) — the day's number printed inside its cell.
 *
 * Every family visual labels its marks; this is the heatmap's version. Three rules
 * keep a 365-cell grid readable:
 *
 *   · It never measures text. Width is estimated from the character count (0.6 em per
 *     glyph, the same arithmetic-layout rule the rest of the render path follows), so
 *     the jsdom sweep keeps working and a label that would spill is simply not drawn.
 *   · It sheds per cell, not all-or-nothing: a cell too small for its number drops
 *     the label and keeps its colour; a bigger cell in the same grid keeps its label.
 *   · The ink is picked per cell from two candidates by contrast against that cell's
 *     own fill, so a label stays legible from the palette's light end to its dark end.
 *     High contrast passes the host's two colours as the candidates.
 *
 * Pointer-transparent: the cell underneath keeps its hover, click and focus.
 */

import { GroupSel } from "./grid";

/** Anything drawn as a square cell: a day, or an Hours-layout bucket. */
export interface LabelledCell {
    value: number | null;
    px?: number;
    py?: number;
    ps?: number;
}

export interface CellLabelOptions<C extends LabelledCell> {
    /** The author's size; shrunk to fit a cell, never grown past it. */
    fontSize: number;
    fontFamily: string;
    /** The fill each cell was painted with (the colour accessor). */
    fillOf(cell: C): string;
    /** Two ink candidates; the one with more contrast against the fill wins. */
    inkA: string;
    inkB: string;
    format(n: number): string;
    /** Cells that must stay unlabelled (a badge sits at the centre). */
    skip?(cell: C): boolean;
}

/** Smallest legible label, in px. Below it the cell keeps its colour only. */
export const MIN_LABEL_PX = 6;

/** "#rrggbb" / "#rgb" / "rgb(r, g, b)" → [r, g, b], or null when unparseable. */
export function parseColor(c: string): [number, number, number] | null {
    const s = (c || "").trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) return [0, 1, 2].map(i => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
    m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
    return null;
}

/** WCAG relative luminance (0 = black, 1 = white). */
function luminance([r, g, b]: [number, number, number]): number {
    const lin = (v: number): number => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The candidate ink with the higher contrast against `fill` (the first one when the
 *  fill can't be read — a pattern url or a named colour). */
export function inkFor(fill: string, inkA: string, inkB: string): string {
    const f = parseColor(fill), a = parseColor(inkA), b = parseColor(inkB);
    if (!f || !a || !b) return inkA;
    return contrast(f, b) > contrast(f, a) ? inkB : inkA;
}

/**
 * The size a label can take in a cell of `ps` px, or 0 when it does not fit. The
 * label may use at most half the cell's height and the cell's width less a 1px gutter
 * on each side.
 */
export function fitLabel(text: string, ps: number, wanted: number): number {
    if (!text || !(ps > 0)) return 0;
    const byHeight = Math.floor(ps * 0.5);
    const byWidth = Math.floor((ps - 2) / (0.6 * text.length));
    const size = Math.min(Math.round(wanted), byHeight, byWidth);
    return size >= MIN_LABEL_PX ? size : 0;
}

/** Draw every label that fits. Returns how many were drawn. */
export function drawCellLabels<C extends LabelledCell>(group: GroupSel, cells: readonly C[], opts: CellLabelOptions<C>): number {
    const layer = group.append("g").classed("cell-labels", true).attr("pointer-events", "none").attr("aria-hidden", "true");
    let drawn = 0;
    for (const c of cells) {
        if (c.value == null || !Number.isFinite(c.value)) continue;
        if (opts.skip && opts.skip(c)) continue;
        const ps = c.ps ?? 0;
        const text = opts.format(c.value);
        const size = fitLabel(text, ps, opts.fontSize);
        if (!size) continue;
        layer.append("text")
            .classed("cell-label", true)
            .attr("x", (c.px ?? 0) + ps / 2)
            .attr("y", (c.py ?? 0) + ps / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-family", opts.fontFamily)
            .attr("font-size", `${size}px`)
            .attr("font-weight", "600")
            .attr("fill", inkFor(opts.fillOf(c), opts.inkA, opts.inkB))
            .text(text);
        drawn++;
    }
    return drawn;
}
