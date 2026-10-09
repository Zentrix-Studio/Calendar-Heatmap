"use strict";

/**
 * Day marks from the calendar and the data (HM-V2-10/11): non-working days (weekends by
 * calendar math, holidays from the optional Holiday field) and event markers (the
 * optional Event / Event type fields).
 *
 * Corner map on a cell, so no two marks ever collide: top-left = author note dot
 * (Z-147), centre = day badge emoji, BOTTOM-RIGHT = event marker (this module).
 * Non-working styles cover the whole cell but stay translucent / outline-only so the
 * value colour always reads through.
 *
 * Pure drawers, like the rest of render/: no host, no measuring (text widths below are
 * arithmetic estimates, so the jsdom harness keeps working).
 */

import { GroupSel } from "./grid";
import { CellBox } from "./states";
import { drawPattern } from "./patterns";
import { DayCell } from "../types";

export type NonWorkingStyle = "tint" | "hatch" | "outline";
export type EventMarker = "corner" | "dot" | "ring";
export type WeekendSet = "satSun" | "friSat" | "sun";

const WEEKEND_DAYS: Record<WeekendSet, number[]> = { satSun: [0, 6], friSat: [5, 6], sun: [0] };

/** Is `date` a weekend day under the chosen convention? */
export function isWeekend(date: Date, set: WeekendSet): boolean {
    return (WEEKEND_DAYS[set] ?? WEEKEND_DAYS.satSun).includes(date.getDay());
}

/**
 * Mark a non-working day. `tint` washes the cell toward the page (it recedes without
 * losing its hue), `hatch` lays the diagonal pattern over it, `outline` draws a dashed
 * inset border. `ink` is the theme's muted text colour (HC: the host foreground).
 */
export function drawNonWorking(
    defs: GroupSel, group: GroupSel, box: CellBox, style: NonWorkingStyle, dark: boolean, ink: string, hc: boolean,
): void {
    if (box.size <= 0) return;
    if (style === "hatch") { drawPattern(defs, group, box, dark, "diagonal"); return; }
    if (style === "outline" || hc) {
        // HC: a translucent wash would fight the host's two-colour scheme; the outline
        // carries the meaning with the foreground colour instead.
        group.append("rect").classed("zx-nonworking", true)
            .attr("x", box.x + 1).attr("y", box.y + 1)
            .attr("width", Math.max(0, box.size - 2)).attr("height", Math.max(0, box.size - 2))
            .attr("rx", 1.5).attr("fill", "none")
            .attr("stroke", ink).attr("stroke-width", 1).attr("stroke-dasharray", "2 1.5")
            .attr("pointer-events", "none");
        return;
    }
    group.append("rect").classed("zx-nonworking", true)
        .attr("x", box.x).attr("y", box.y).attr("width", box.size).attr("height", box.size)
        .attr("rx", 2)
        .attr("fill", dark ? "rgba(10,10,15,0.45)" : "rgba(255,255,255,0.55)")
        .attr("pointer-events", "none");
}

/** Event marker at the cell's bottom-right (corner flag / dot), or a ring round it. */
export function drawEventMarker(group: GroupSel, box: CellBox, style: EventMarker, color: string, count: number): void {
    if (box.size <= 0) return;
    const g = group.append("g").classed("zx-event", true).attr("pointer-events", "none");
    if (style === "ring") {
        g.append("rect")
            .attr("x", box.x - 1.5).attr("y", box.y - 1.5)
            .attr("width", box.size + 3).attr("height", box.size + 3)
            .attr("rx", 3).attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5);
        return;
    }
    if (style === "dot") {
        const r = Math.max(1.8, box.size * 0.16);
        g.append("circle")
            .attr("cx", box.x + box.size - r - 0.5).attr("cy", box.y + box.size - r - 0.5).attr("r", r + 1)
            .attr("fill", "rgba(255,255,255,0.92)");
        g.append("circle")
            .attr("cx", box.x + box.size - r - 0.5).attr("cy", box.y + box.size - r - 0.5).attr("r", r)
            .attr("fill", color);
        return;
    }
    // Corner flag: a right triangle filling the bottom-right corner. Two or more
    // events on the day get a second, inset triangle — a "there's more" cue that
    // survives the smallest cells (the tooltip lists them all).
    const f = Math.max(4, box.size * 0.45);
    const x1 = box.x + box.size, y1 = box.y + box.size;
    g.append("path")
        .attr("d", `M${x1} ${y1 - f}L${x1} ${y1}L${x1 - f} ${y1}Z`)
        .attr("fill", color).attr("stroke", "rgba(255,255,255,0.85)").attr("stroke-width", 0.6);
    if (count > 1) {
        const f2 = f * 0.5;
        g.append("path")
            .attr("d", `M${x1 - f - 1.5} ${y1}L${x1} ${y1 - f - 1.5}`)
            .attr("stroke", color).attr("stroke-width", Math.max(1, f2 * 0.3)).attr("fill", "none");
    }
}

/** Resolve an event's marker colour: by type (host palette), else the accent. */
export type EventColorOf = (d: Pick<DayCell, "eventType">) => string;

/** Rough text width for the key — arithmetic, never measured (jsdom-safe). */
const estWidth = (text: string, fontSize: number) => text.length * fontSize * 0.58;

/**
 * Event-type key: a row of colour chips, right-aligned in the legend band. Draws only
 * the chips that fit in `maxWidth` and ends with "+N" when some don't. Returns the
 * number of types shown.
 */
export function renderEventKey(group: GroupSel, o: {
    right: number; y: number; maxWidth: number; types: string[]; colorOf: (t: string) => string;
    labelColor: string; fontSize: number; font: string;
}): number {
    if (!o.types.length || o.maxWidth < 40) return 0;
    const chip = 8, gap = 5, sep = 12;
    const items = o.types.map(t => ({ t, w: chip + gap + estWidth(t, o.fontSize) }));
    let used = 0, shown = 0;
    for (const it of items) {
        const extra = (shown ? sep : 0) + it.w;
        const reserveMore = shown + 1 < items.length ? sep + estWidth("+99", o.fontSize) : 0;
        if (used + extra + reserveMore > o.maxWidth) break;
        used += extra; shown++;
    }
    const more = items.length - shown;
    const moreW = more ? sep + estWidth(`+${more}`, o.fontSize) : 0;
    const g = group.append("g").classed("zx-event-key", true);
    let x = o.right - used - moreW;
    for (let i = 0; i < shown; i++) {
        const it = items[i];
        if (i) x += sep;
        g.append("path")
            .attr("d", `M${x + chip} ${o.y - chip / 2}L${x + chip} ${o.y + chip / 2}L${x} ${o.y + chip / 2}Z`)
            .attr("fill", o.colorOf(it.t));
        g.append("text").attr("x", x + chip + gap).attr("y", o.y + o.fontSize * 0.35)
            .attr("fill", o.labelColor).attr("font-family", o.font).attr("font-size", `${o.fontSize}px`)
            .text(it.t);
        x += it.w;
    }
    if (more) {
        g.append("text").attr("x", x + sep).attr("y", o.y + o.fontSize * 0.35)
            .attr("fill", o.labelColor).attr("font-family", o.font).attr("font-size", `${o.fontSize}px`)
            .text(`+${more}`);
    }
    return shown;
}
