"use strict";

import type { Selection } from "d3";
import type { GroupSel } from "./grid";
import type { DayCell } from "../types";
import type { MarkerStyle, Note } from "../notes/core";
import { CellBox, cellBox, drawAnnotationDot, drawAnnotationIcon } from "./states";
import {
    accent as ACCENT_TOKEN, fontFamily as FONT,
    surfaceCard, surfaceOverlayLight, textPrimary, textPrimaryLight,
} from "../theme/zentrixTokens";

/**
 * Annotation layer (Z-152) — draws author-written notes over the grid.
 *
 * Pure D3, like every other module in render/: it takes resolved anchors and
 * returns the callout selection so the caller can bind interaction. It never
 * reads the settings model and never touches the host.
 *
 * TEXT IS WRAPPED ARITHMETICALLY, NOT MEASURED. The jsdom test harness runs the
 * real Visual precisely because the render path never calls `getBBox` (only the
 * tooltip and the gear overlay do). Introducing text measurement here would break
 * the ~250-case settings sweep and force it to Playwright. If you need better
 * wrapping, improve the metric — do not measure.
 */

/** Average glyph width as a fraction of font size, for the UI stack. */
const GLYPH_W = 0.55;

const CALLOUT_W = 168;
const PAD = 7;
const MAX_LINES = 6;
const DEFAULT_SIZE = 11;
const LINE_RATIO = 1.35;

/** A note resolved against the day cell it is anchored to. */
export interface NoteAnchor {
    note: Note;
    cell: DayCell;
    /** 1-based marker number, in the store's deterministic order. */
    index: number;
}

export interface AnnotationOpts {
    markerStyle: MarkerStyle;
    markerIcon: string;
    markerColor: string;
    dark: boolean;
    /** Canvas bounds — callouts are clamped inside them. */
    width: number;
    height: number;
    /** Authoring context: callouts become clickable (open the editor). */
    editable: boolean;
}

export interface AnnotationResult {
    /** The callout groups, bound to their anchors — bind click here to edit. */
    callouts: Selection<SVGGElement, NoteAnchor, SVGGElement, unknown>;
}

/** Resolved callout box geometry. */
interface Callout {
    x: number; y: number; w: number; h: number;
    lines: string[];
    size: number;
    lineH: number;
}

/**
 * Greedy word-wrap using an arithmetic width estimate (see the file header — the
 * render path must not measure text). Over-long words are hard-broken; overflow
 * past `maxLines` is ellipsized rather than silently dropped.
 */
export function wrapText(text: string, size: number, maxWidth: number, maxLines: number): string[] {
    const perLine = Math.max(6, Math.floor(maxWidth / (size * GLYPH_W)));
    const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
    const all: string[] = [];
    let cur = "";

    for (let word of words) {
        while (word.length > perLine) {
            if (cur) { all.push(cur); cur = ""; }
            all.push(word.slice(0, perLine));
            word = word.slice(perLine);
        }
        const next = cur ? `${cur} ${word}` : word;
        if (next.length <= perLine) cur = next;
        else { if (cur) all.push(cur); cur = word; }
    }
    if (cur) all.push(cur);
    if (all.length <= maxLines) return all;

    const kept = all.slice(0, maxLines);
    const last = kept[maxLines - 1] ?? "";
    kept[maxLines - 1] = last.length > perLine - 1
        ? last.slice(0, Math.max(1, perLine - 1)) + "…"
        : last + "…";
    return kept;
}

/** Where a note's callout lands, clamped inside the canvas. */
export function calloutGeometry(note: Note, box: CellBox, width: number, height: number): Callout {
    const size = note.style.size ?? DEFAULT_SIZE;
    const lines = wrapText(note.text, size, CALLOUT_W - PAD * 2, MAX_LINES);
    const lineH = Math.round(size * LINE_RATIO);
    const h = PAD * 2 + Math.max(1, lines.length) * lineH;
    // Offsets are in cell-size units so a resize moves the callout WITH the grid.
    const ps = box.size || 12;
    const x = Math.max(2, Math.min(box.x + note.dx * ps, Math.max(2, width - CALLOUT_W - 2)));
    const y = Math.max(2, Math.min(box.y + note.dy * ps, Math.max(2, height - h - 2)));
    return { x, y, w: CALLOUT_W, h, lines, size, lineH };
}

function surfaceOf(dark: boolean) {
    return {
        bg: dark ? surfaceCard : surfaceOverlayLight,
        fg: dark ? textPrimary : textPrimaryLight,
        border: dark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.14)",
        line: dark ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.38)",
    };
}

/** The numbered marker — a filled disc with its index, at the cell's top-left. */
function drawNumberMarker(overlay: GroupSel, box: CellBox, index: number, color: string): void {
    const r = Math.max(5, box.size * 0.3);
    const cx = box.x + r * 0.75, cy = box.y + r * 0.75;
    overlay.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", r + 1)
        .attr("fill", "rgba(255,255,255,0.92)")
        .attr("pointer-events", "none");
    overlay.append("circle")
        .attr("cx", cx).attr("cy", cy).attr("r", r)
        .attr("fill", color)
        .attr("pointer-events", "none");
    overlay.append("text")
        .attr("x", cx).attr("y", cy)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-family", FONT)
        .attr("font-size", `${Math.max(7, r * 1.15)}px`)
        .attr("font-weight", "700")
        .attr("fill", "rgba(255,255,255,0.96)")
        .attr("pointer-events", "none")
        .text(String(index));
}

/**
 * Draw every anchored note. Markers are `pointer-events: none` so they never
 * steal the click from the cell beneath them (the cell owns select + the detail
 * panel); only the callout box is interactive, and only while authoring.
 */
export function renderAnnotations(
    group: GroupSel, anchors: NoteAnchor[], opts: AnnotationOpts,
): AnnotationResult {
    const t = surfaceOf(opts.dark);

    // 1. Leader lines, under everything else in the layer.
    for (const a of anchors) {
        if (a.note.mode !== "arrow" && a.note.mode !== "all") continue;
        const box = cellBox(a.cell);
        const g = calloutGeometry(a.note, box, opts.width, opts.height);
        const cx = box.x + box.size / 2, cy = box.y + box.size / 2;
        // Closest point on the callout rect to the cell centre — a short, honest
        // connector rather than a line crossing the box.
        const ax = Math.max(g.x, Math.min(cx, g.x + g.w));
        const ay = Math.max(g.y, Math.min(cy, g.y + g.h));
        if (Math.abs(ax - cx) < 2 && Math.abs(ay - cy) < 2) continue; // cell sits under the box
        group.append("line")
            .attr("class", "zx-note-line")
            .attr("x1", ax).attr("y1", ay)
            .attr("x2", cx).attr("y2", cy)
            .attr("stroke", a.note.style.arrow || t.line)
            .attr("stroke-width", 1)
            .attr("pointer-events", "none");
    }

    // 2. Markers.
    for (const a of anchors) {
        if (a.note.mode !== "marker" && a.note.mode !== "all") continue;
        const box = cellBox(a.cell);
        const color = opts.markerColor || ACCENT_TOKEN;
        if (opts.markerStyle === "icon") drawAnnotationIcon(group, box, opts.markerIcon || "📌");
        else if (opts.markerStyle === "dot") drawAnnotationDot(group, box, color);
        else drawNumberMarker(group, box, a.index, color);
    }

    // 3. Callout boxes, on top and (while authoring) clickable. An empty note has
    // nothing to say, so it draws no box — only its marker.
    const boxed = anchors.filter(a => a.note.mode !== "marker" && a.note.text.trim() !== "");
    for (const a of boxed) {
        const box = cellBox(a.cell);
        const g = calloutGeometry(a.note, box, opts.width, opts.height);
        const st = a.note.style;

        const cg = group.append("g")
            .attr("class", "zx-note")
            .datum(a)
            .attr("pointer-events", opts.editable ? "all" : "none");
        // `move` (not `pointer`): the primary affordance is dragging the box off the
        // grid; clicking to edit is secondary.
        if (opts.editable) cg.style("cursor", "move");

        cg.append("rect")
            .attr("x", g.x).attr("y", g.y)
            .attr("width", g.w).attr("height", g.h)
            .attr("rx", 8).attr("ry", 8)
            .attr("fill", st.bg || t.bg)
            .attr("stroke", st.border || t.border)
            .attr("stroke-width", 1);

        const text = cg.append("text")
            .attr("x", g.x + PAD)
            .attr("y", g.y + PAD + g.size * 0.9)
            .attr("font-family", FONT)
            .attr("font-size", `${g.size}px`)
            .attr("font-weight", st.bold ? "700" : "400")
            .attr("font-style", st.italic ? "italic" : "normal")
            .attr("fill", st.color || t.fg);

        g.lines.forEach((line, i) => {
            text.append("tspan")
                .attr("x", g.x + PAD)
                .attr("dy", i === 0 ? 0 : g.lineH)
                .text(line);
        });
    }

    return { callouts: group.selectAll<SVGGElement, NoteAnchor>("g.zx-note") };
}
