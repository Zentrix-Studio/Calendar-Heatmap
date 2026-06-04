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
    /** BCP-47 locale for date formatting (from the Power BI host). Defaults to
     * "en-US" so dates render deterministically when omitted (tests/dev). */
    locale?: string;
}

/** Compact number formatting for KPI chips (1234 → 1.2K, 68400 → 68.4K). */
function compact(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
}

// Header band geometry. The title sits on the left, the two-line KPI chips
// (eyebrow label + value) on the right. Baselines and band height are derived
// from the configured fonts so large headline/stat sizes don't clip at the top
// edge. Defaults (headline 15 / stat 14) resolve to the historical 42px band.
const EYEBROW_Y = 12;        // chip eyebrow-label baseline
const BAND_PAD_BOTTOM = 8;   // space below the lowest baseline (rule lives here)

function titleBaseline(headlineSize: number): number { return Math.max(18, headlineSize + 3); }
function valueBaseline(statSize: number): number { return EYEBROW_Y + Math.max(statSize, 10); }

/** Reserved band height for the given fonts (≥ 42; grows for large fonts). */
export function headerBandHeight(headlineSize: number, statSize: number): number {
    return Math.max(42, Math.round(Math.max(titleBaseline(headlineSize), valueBaseline(statSize)) + BAND_PAD_BOTTOM));
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

    const titleY = titleBaseline(opts.headline.size);
    const valueY = valueBaseline(opts.stat.size);
    const bandH = headerBandHeight(opts.headline.size, opts.stat.size);

    const titleX = opts.align === "right" ? opts.width - 2 : opts.align === "center" ? opts.width / 2 : 2;
    const titleAnchor = opts.align === "right" ? "end" : opts.align === "center" ? "middle" : "start";
    applyText(g.append("text").attr("x", titleX).attr("y", titleY).attr("text-anchor", titleAnchor).text(opts.title),
        opts.headline, opts.textColor);

    // KPI chips on the right (suppressed when the planner needs the clear space).
    if (opts.showChips !== false) {
        const labelStyle = defaultText(10, opts.mutedColor);
        const chips: { label: string; value: string }[] = [{ label: "Total", value: compact(total) }];
        if (peakDate) {
            // Include the year — across a multi-year range "15 Sept" alone is ambiguous.
            chips.push({
                label: "Peak day",
                value: `${compact(peak)} | ${peakDate.toLocaleDateString(opts.locale || "en-US", { year: "numeric", month: "short", day: "numeric" })}`,
            });
        }
        // Measure each chip's real text width (so wide fonts / large sizes don't
        // overflow the right edge). getComputedTextLength is exact in the browser /
        // Power BI sandbox; fall back to a font-size-aware estimate (jsdom returns 0).
        const textW = (sel: ReturnType<GroupSel["append"]>, chars: number, size: number): number => {
            const el = sel.node() as SVGTextElement | null;
            const measured = el && typeof el.getComputedTextLength === "function" ? el.getComputedTextLength() : 0;
            return Math.max(measured, chars * Math.max(size, 10) * 0.62);
        };
        let cx = opts.width - 2;
        for (let i = chips.length - 1; i >= 0; i--) {
            const c = chips[i];
            const labelSel = applyText(g.append("text").attr("y", EYEBROW_Y).text(c.label), labelStyle, opts.mutedColor);
            const valueSel = applyText(g.append("text").attr("y", valueY).text(c.value), opts.stat, opts.textColor);
            const w = Math.ceil(Math.max(textW(labelSel, c.label.length, 10), textW(valueSel, c.value.length, opts.stat.size))) + 16;
            cx -= w;
            labelSel.attr("x", cx);
            valueSel.attr("x", cx);
            cx -= 12;
        }
    }

    if (opts.ruleShow) {
        g.append("rect").attr("x", 2).attr("y", bandH - BAND_PAD_BOTTOM).attr("width", opts.width - 4)
            .attr("height", Math.max(1, opts.ruleWidth))
            .attr("rx", 1).attr("fill", opts.ruleColor).attr("fill-opacity", 0.6);
    }

    return bandH;
}
