"use strict";

import { Selection } from "d3";
import { GroupSel } from "./grid";
import { CellBox } from "./states";
import { textPrimary as TEXT_PRIMARY, textPrimaryLight as TEXT_PRIMARY_LIGHT } from "../theme/zentrixTokens";

/** A d3 selection of a single SVG element (the <pattern> we paint motifs into). */
type ElemSel = Selection<SVGElement, unknown, any, any>;

/**
 * patterns.ts (Z-149) — the Core-5 cell pattern set, rendered as REUSABLE SVG
 * `<pattern>` defs (define-once, fill rects with `url(#…)`). This REPLACES the
 * old per-cell `<line>` + per-cell `<clipPath>` hatch in states.ts
 * (`drawThresholdPattern`), which created one clip + N lines per cell — a DOM
 * explosion on multi-year reports.
 *
 * Each (style, theme, density-bucket) tuple maps to exactly one `<pattern>` def,
 * created once per render and reused across every matching cell by id. A cell is
 * "patterned" by appending a single fill rect with `fill="url(#id)"`,
 * `pointer-events:none`. The pattern tile clips itself to its `patternUnits` box,
 * so no extra per-cell clipPath is needed — the fill rect bounds the tiling.
 *
 * CVD contrast is preserved from the legacy hatch: the stroke is light on dark
 * themes / dark on light themes, at the same opacity baseline
 * (0.62 on dark, 0.50 on light). Those opacities are applied to the token-sourced
 * neutral (`textPrimary`) via `stroke-opacity` — NO new raw hex literal lives in
 * this file (the eslint hex-ban covers patterns.ts; Z-148/Z-149).
 */

export type PatternStyle = "diagonal" | "dots" | "crosshatch" | "grid" | "stars";

/** Fixed Core-5 order; index 0 (`diagonal`) is the back-compat default. */
export const PATTERN_STYLES: PatternStyle[] = ["diagonal", "dots", "crosshatch", "grid", "stars"];

/** CVD contrast for the hatch overlay, applied to a token-sourced neutral via
 *  `stroke-opacity` (no raw hex literal lives in this file). Softened from the
 *  legacy 0.62/0.50 baseline (issue #5): on dense multi-year layouts the overlay
 *  read as noisy ink, so the opacity is dialled back while staying a clearly
 *  visible non-color cue for colour-vision-deficient users. */
const STROKE_OPACITY_DARK = 0.46;  // light stroke on dark themes
const STROKE_OPACITY_LIGHT = 0.38; // dark stroke on light themes
/** Neutral text tokens: near-white on dark, near-black on light (Z-148 mirror). */
const STROKE_DARK = TEXT_PRIMARY;        // #F4F4F6 — light stroke for dark themes
const STROKE_LIGHT = TEXT_PRIMARY_LIGHT; // #1A1A22 — dark stroke for light themes

/**
 * Quantize a cell edge to a small finite set of density buckets so we emit a
 * handful of pattern defs (not one per pixel size). The bucket drives the tile
 * size + motif scale so dots/stars/grid stay legible when cells are tiny on
 * multi-year reports, and don't look sparse when cells are large.
 */
export function densityBucket(size: number): number {
    return Math.min(8, Math.max(1, Math.round(size / 6)));
}

/** Deterministic, define-once id for a (style, theme, bucket) tuple. */
function patternId(style: PatternStyle, dark: boolean, bucket: number): string {
    return `zx-pat-${style}-${dark ? "d" : "l"}-${bucket}`;
}

/** Tile geometry for a density bucket: larger buckets → larger motifs/tiles. */
function tileSize(bucket: number): number {
    // bucket 1 → ~6px tile (tiny cells, dense), bucket 8 → ~13px tile (large cells).
    return 5 + bucket;
}

interface StrokeStyle { color: string; opacity: number; width: number; }

function strokeFor(dark: boolean): StrokeStyle {
    return {
        // Token-sourced neutral (never a semantic color) so the cue never reads as
        // a value; the legacy opacity carries the CVD contrast baseline.
        color: dark ? STROKE_DARK : STROKE_LIGHT,
        opacity: dark ? STROKE_OPACITY_DARK : STROKE_OPACITY_LIGHT,
        width: 0.9,
    };
}

/** Populate a `<pattern>` element's children for the given style. */
function paintTile(pat: ElemSel, style: PatternStyle, t: number, s: StrokeStyle): void {
    const line = (x1: number, y1: number, x2: number, y2: number) =>
        pat.append("line")
            .attr("x1", x1).attr("y1", y1).attr("x2", x2).attr("y2", y2)
            .attr("stroke", s.color).attr("stroke-opacity", s.opacity).attr("stroke-width", s.width);
    const dot = (cx: number, cy: number, r: number) =>
        pat.append("circle").attr("cx", cx).attr("cy", cy).attr("r", r)
            .attr("fill", s.color).attr("fill-opacity", s.opacity);

    switch (style) {
        case "diagonal":
            // A single 45° stroke across the tile, repeated by tiling — reproduces
            // the legacy hatch look (parallel diagonal lines).
            line(0, t, t, 0);
            line(-1, 1, 1, -1);
            line(t - 1, t + 1, t + 1, t - 1);
            break;
        case "crosshatch":
            // Diagonals in BOTH directions.
            line(0, t, t, 0);
            line(-1, 1, 1, -1);
            line(t - 1, t + 1, t + 1, t - 1);
            line(0, 0, t, t);
            line(t - 1, -1, t + 1, 1);
            line(-1, t - 1, 1, t + 1);
            break;
        case "grid":
            // Orthogonal H + V lines (one of each per tile edge).
            line(0, 0, t, 0);
            line(0, 0, 0, t);
            break;
        case "dots": {
            const r = Math.max(0.8, t * 0.16);
            dot(t / 2, t / 2, r);
            break;
        }
        case "stars": {
            // A small 4-point star glyph centered in each tile (two crossed strokes
            // + diagonals make it read as a sparkle at small sizes).
            const c = t / 2, r = Math.max(1.5, t * 0.42);
            line(c, c - r, c, c + r);
            line(c - r, c, c + r, c);
            const d = r * 0.55;
            line(c - d, c - d, c + d, c + d);
            line(c - d, c + d, c + d, c - d);
            break;
        }
    }
}

/**
 * Ensure a `<pattern>` def exists for (style, theme, density bucket) and return
 * its id. Idempotent: define-once, reused across every cell in the render.
 */
export function ensurePatternDef(
    defs: GroupSel,
    style: PatternStyle,
    dark: boolean,
    sizeBucket: number,
): string {
    const id = patternId(style, dark, sizeBucket);
    if (!defs.select(`#${id}`).empty()) return id;
    const t = tileSize(sizeBucket);
    const pat = defs.append("pattern")
        .attr("id", id)
        .attr("patternUnits", "userSpaceOnUse")
        .attr("width", t).attr("height", t);
    paintTile(pat, style, t, strokeFor(dark));
    return id;
}

/**
 * Draw a pattern over a cell by filling a single rect with `url(#id)` — no
 * per-cell `<line>` loops, no per-cell `<clipPath>`. The def is created once
 * (idempotent) and reused. The rect is `pointer-events:none` so the pattern is a
 * pure non-interactive overlay (keyboard / selection / cross-filter unaffected).
 */
export function drawPattern(
    defs: GroupSel,
    overlay: GroupSel,
    box: CellBox,
    dark: boolean,
    style: PatternStyle = "diagonal",
): void {
    if (box.size <= 0) return;
    const bucket = densityBucket(box.size);
    const id = ensurePatternDef(defs, style, dark, bucket);
    overlay.append("rect")
        .attr("x", box.x).attr("y", box.y)
        .attr("width", box.size).attr("height", box.size)
        .attr("fill", `url(#${id})`)
        .attr("pointer-events", "none");
}
