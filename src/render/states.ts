"use strict";

import { GroupSel, CellSel } from "./grid";
import { DayCell } from "../types";
import { accent as ACCENT_TOKEN, negSafe as NEG_SAFE_TOKEN } from "../theme/zentrixTokens";

/**
 * Cell states (spec §6 / design "Cell anatomy & states").
 *
 * Hover / selected / today / focus rings are drawn as OVERLAY rects on top of
 * the cells — never by mutating cell size or adding a transform — so no state
 * ever triggers a grid reflow (the no-reflow rule). Cross-highlight is the one
 * exception that touches cells: it changes fill-opacity only (no layout).
 */

export const STATE = {
    // Brand accent + CVD-safe negative semantic, sourced from the token mirror
    // (Z-148) — no raw hex in render/. `threshold` (the breach corner dot) is a
    // meaning-bearing "bad/over-threshold" cue → Okabe-Ito orange, not raw red.
    accent: ACCENT_TOKEN,
    threshold: NEG_SAFE_TOKEN,
    dimOpacity: 0.28,
    hairlineLight: "rgba(0,0,0,0.20)",
    hairlineDark: "rgba(255,255,255,0.18)",
};

export interface CellBox { x: number; y: number; size: number; }

/** Cross-highlight: dim cells not in the selection to 28%, full when none selected. */
export function applyCrossHighlight(cells: CellSel, isSelected: (d: DayCell) => boolean, anySelected: boolean): void {
    cells.attr("fill-opacity", d => (!anySelected ? 1 : isSelected(d) ? 1 : STATE.dimOpacity));
}

function ring(overlay: GroupSel, box: CellBox, opts: {
    grow: number; stroke: string; width: number; radius: number; dash?: string;
}): void {
    overlay.append("rect")
        .attr("x", box.x - opts.grow)
        .attr("y", box.y - opts.grow)
        .attr("width", box.size + opts.grow * 2)
        .attr("height", box.size + opts.grow * 2)
        .attr("rx", opts.radius)
        .attr("ry", opts.radius)
        .attr("fill", "none")
        .attr("stroke", opts.stroke)
        .attr("stroke-width", opts.width)
        .attr("stroke-dasharray", opts.dash ?? null)
        .attr("pointer-events", "none");
}

/** Hover: 1.5px inset accent ring (drawn just inside the cell edge). */
export function drawHoverRing(overlay: GroupSel, box: CellBox): void {
    ring(overlay, box, { grow: -0.75, stroke: STATE.accent, width: 1.5, radius: 2 });
}

/** Selected: 2px accent stroke drawn OUTSIDE the cell so the fill area is unchanged. */
export function drawSelectedRing(overlay: GroupSel, box: CellBox): void {
    ring(overlay, box, { grow: 1.5, stroke: STATE.accent, width: 2, radius: 3 });
}

/** Keyboard focus: accent ring offset 1.5px + 1px gap, independent of value fill. */
export function drawFocusRing(overlay: GroupSel, box: CellBox): void {
    ring(overlay, box, { grow: 2.5, stroke: STATE.accent, width: 1.5, radius: 3, dash: "2 1.5" });
}

/** Today: subtle accent ring, independent of fill (only when today ∈ range). */
export function drawTodayRing(overlay: GroupSel, box: CellBox): void {
    ring(overlay, box, { grow: 1, stroke: STATE.accent, width: 1.5, radius: 3 });
}

/** No-data hairline: a 1px inset border so empty days never read as a low value. */
export function drawNoDataHairline(overlay: GroupSel, box: CellBox, dark: boolean): void {
    ring(overlay, box, {
        grow: -0.5, width: 1, radius: 2,
        stroke: dark ? STATE.hairlineDark : STATE.hairlineLight,
    });
}

/** Threshold breach: a negative-toned 3px corner dot at the cell's top-right. */
export function drawThresholdDot(overlay: GroupSel, box: CellBox): void {
    overlay.append("circle")
        .attr("cx", box.x + box.size - 1.5)
        .attr("cy", box.y + 1.5)
        .attr("r", 1.5)
        .attr("fill", STATE.threshold)
        .attr("pointer-events", "none");
}

// Accessibility CVD pattern on threshold-breach cells moved to render/patterns.ts
// (Z-149): the per-cell <line>/<clipPath> hatch was generalized into the Core-5
// pattern set rendered via reusable <pattern> defs. `drawPattern` REPLACES the
// former `drawThresholdPattern`; `diagonal` (the default) reproduces this hatch.

/** Annotation marker (Z-147): a dot at the cell's top-left corner, flagging a day
 * that carries an Annotation note (holiday / release / incident…). Sits opposite
 * the rule/threshold badge (centered) so the two never collide. More visible than
 * the original: a larger radius + a contrasting halo that reads on dark AND light
 * cells. Color is caller-supplied (token-sourced default `accent`). */
export function drawAnnotationDot(overlay: GroupSel, box: CellBox, color: string = STATE.accent): void {
    // Slightly larger than the legacy 0.12 factor so it's harder to miss.
    const r = Math.max(2, box.size * 0.16);
    const cx = box.x + r + 0.5, cy = box.y + r + 0.5;
    // Contrasting halo: a wider, semi-opaque white ring under the colored dot so it
    // pops on both dark and light cells (the old single 0.5px white stroke was faint).
    overlay.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", r + 1)
        .attr("fill", "rgba(255,255,255,0.92)")
        .attr("pointer-events", "none");
    overlay.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", r)
        .attr("fill", color)
        .attr("stroke", "rgba(0,0,0,0.25)")
        .attr("stroke-width", 0.5)
        .attr("pointer-events", "none");
}

/** Annotation marker as a small glyph (Z-147 icon mode) at the cell's top-left.
 * Reuses drawBadge's text path; opt-in (Dot stays the default for small cells). */
export function drawAnnotationIcon(overlay: GroupSel, box: CellBox, icon: string): void {
    const s = Math.max(8, box.size * 0.42);
    overlay.append("text")
        .attr("x", box.x + s * 0.55)
        .attr("y", box.y + s * 0.62)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", `${s}px`)
        .attr("pointer-events", "none")
        .text(icon);
}

/** Pixel box for a DayCell, as assigned by the active renderer. */
export function cellBox(d: DayCell): CellBox {
    return { x: d.px ?? 0, y: d.py ?? 0, size: d.ps ?? 0 };
}

/** Rule color cue: a 2px colored outline OUTSIDE a matching cell (Z-146). Drawn as
 * an outline rather than a fill so it never disturbs the value-driven cell ramp
 * (the cell-ramp reconciliation is a separate, deferred concern). Color is
 * caller-supplied (token-sourced default). */
export function drawRuleOutline(overlay: GroupSel, box: CellBox, color: string): void {
    ring(overlay, box, { grow: 1, stroke: color, width: 2, radius: 3 });
}

/** Day badge: an emoji centered on a notable cell (peak / threshold / rule). */
export function drawBadge(overlay: GroupSel, box: CellBox, emoji: string): void {
    overlay.append("text")
        .attr("x", box.x + box.size / 2)
        .attr("y", box.y + box.size / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", `${Math.max(8, box.size * 0.72)}px`)
        .attr("pointer-events", "none")
        .text(emoji);
}
