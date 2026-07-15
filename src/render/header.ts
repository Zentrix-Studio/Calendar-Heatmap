"use strict";

import { GroupSel } from "./grid";
import { CalendarModel } from "../types";
import { TextStyle, applyText, defaultText } from "./text";

export interface HeaderOptions {
    width: number;
    title: string;
    align: "left" | "center" | "right";
    headline: TextStyle;
    stat: TextStyle;
    ruleShow: boolean;
    ruleColor: string;
    ruleWidth: number;
    textColor: string;
    mutedColor: string;
    /** Show the Total / Peak-day KPI chips. Dropped first when space is tight
     * (keeps the title) — defaults to true when omitted. */
    showChips?: boolean;
}

/** Compact number formatting for KPI chips (1234 → 1.2K, 68400 → 68.4K). */
function compact(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
}

/**
 * Direction C KPI header: title + Total + Peak day, with an optional accent
 * rule. Title text/align and all fonts are caller-controlled. Returns the
 * vertical space consumed so the grid can offset below it.
 */
export function renderHeader(group: GroupSel, model: CalendarModel, opts: HeaderOptions): number {
    let total = 0, peak = -Infinity, peakDate: Date | null = null;
    for (const d of model.days) {
        if (d.value == null) continue;
        total += d.value;
        if (d.value > peak) { peak = d.value; peakDate = d.date; }
    }

    const g = group.append("g").classed("kpi-header", true);

    const titleX = opts.align === "right" ? opts.width - 2 : opts.align === "center" ? opts.width / 2 : 2;
    const titleAnchor = opts.align === "right" ? "end" : opts.align === "center" ? "middle" : "start";
    applyText(g.append("text").attr("x", titleX).attr("y", 18).attr("text-anchor", titleAnchor).text(opts.title),
        opts.headline, opts.textColor);

    // KPI chips take the side OPPOSITE the title so they never overlap.
    // align=left|center → chips on the RIGHT (current behavior).
    // align=right       → chips on the LEFT so the right-anchored title keeps its edge.
    if (opts.showChips !== false) {
        const labelStyle = defaultText(10, opts.mutedColor);
        const chips: { label: string; value: string }[] = [{ label: "Total", value: compact(total) }];
        if (peakDate) {
            // Include the year — across a multi-year range "15 Sept" alone is ambiguous.
            chips.push({
                label: "Peak day",
                value: `${compact(peak)} | ${peakDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`,
            });
        }
        const chipsRight = opts.align !== "right";
        if (chipsRight) {
            // Right side: iterate last→first, accumulate from the right edge inward.
            let cx = opts.width - 2;
            for (let i = chips.length - 1; i >= 0; i--) {
                const c = chips[i];
                const w = Math.max(c.label.length, c.value.length) * 7 + 16;
                cx -= w;
                applyText(g.append("text").attr("x", cx).attr("y", 12).text(c.label), labelStyle, opts.mutedColor);
                applyText(g.append("text").attr("x", cx).attr("y", 26).text(c.value), opts.stat, opts.textColor);
                cx -= 12;
            }
        } else {
            // Left side: iterate first→last, draw at cx then advance right.
            let cx = 2;
            for (let i = 0; i < chips.length; i++) {
                const c = chips[i];
                const w = Math.max(c.label.length, c.value.length) * 7 + 16;
                applyText(g.append("text").attr("x", cx).attr("y", 12).text(c.label), labelStyle, opts.mutedColor);
                applyText(g.append("text").attr("x", cx).attr("y", 26).text(c.value), opts.stat, opts.textColor);
                cx += w + 12;
            }
        }
    }

    if (opts.ruleShow) {
        g.append("rect").attr("x", 2).attr("y", 34).attr("width", opts.width - 4)
            .attr("height", Math.max(1, opts.ruleWidth))
            .attr("rx", 1).attr("fill", opts.ruleColor).attr("fill-opacity", 0.6);
    }

    return 42;
}
