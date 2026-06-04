"use strict";

import { GroupSel, CellSel } from "./grid";
import { DayCell } from "../types";

/**
 * Cell states (spec §6 / design "Cell anatomy & states").
 *
 * Hover / selected / today / focus rings are drawn as OVERLAY rects on top of
 * the cells — never by mutating cell size or adding a transform — so no state
 * ever triggers a grid reflow (the no-reflow rule). Cross-highlight is the one
 * exception that touches cells: it changes fill-opacity only (no layout).
 */

export const STATE = {
    accent: "#7C5CFF",
    threshold: "#E5484D",
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

/** Accessibility - a diagonal hatch over a threshold-breach cell so breaches are
 * distinguishable WITHOUT relying on color (CVD-safe, spec section 7 Accessibility
 * "Pattern on threshold"). Clipped to the cell so the lines never bleed past it. */
export function drawThresholdPattern(overlay: GroupSel, box: CellBox, dark: boolean): void {
    if (box.size <= 0) return;
    const stroke = dark ? "rgba(255,255,255,0.62)" : "rgba(0,0,0,0.50)";
    const id = `zx-hatch-${Math.round(box.x)}-${Math.round(box.y)}`;
    const g = overlay.append("g").attr("pointer-events", "none");
    g.append("clipPath").attr("id", id).append("rect")
        .attr("x", box.x).attr("y", box.y).attr("width", box.size).attr("height", box.size);
    const lines = g.append("g").attr("clip-path", `url(#${id})`);
    const step = Math.max(2.5, box.size / 3.5);
    for (let o = -box.size; o <= box.size; o += step) {
        lines.append("line")
            .attr("x1", box.x + o).attr("y1", box.y)
            .attr("x2", box.x + o + box.size).attr("y2", box.y + box.size)
            .attr("stroke", stroke).attr("stroke-width", 0.9);
    }
}

/** Annotation marker: a small accent dot at the cell's top-left corner, flagging
 * a day that carries an Annotation note (holiday / release / incident…). Sits
 * opposite the threshold dot so the two never collide. */
export function drawAnnotationDot(overlay: GroupSel, box: CellBox): void {
    const r = Math.max(1.4, box.size * 0.12);
    overlay.append("circle")
        .attr("cx", box.x + r + 0.5)
        .attr("cy", box.y + r + 0.5)
        .attr("r", r)
        .attr("fill", STATE.accent)
        .attr("stroke", "rgba(255,255,255,0.85)")
        .attr("stroke-width", 0.5)
        .attr("pointer-events", "none");
}

/** Pixel box for a DayCell, as assigned by the active renderer. */
export function cellBox(d: DayCell): CellBox {
    return { x: d.px ?? 0, y: d.py ?? 0, size: d.ps ?? 0 };
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
