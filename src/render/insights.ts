"use strict";

import { GroupSel } from "./grid";
import { Insight } from "../insights/types";

export interface InsightCardOpts {
    x: number;
    y: number;
    width: number;
    font: string;
    labelColor: string;
    textColor: string;
    toneColors: { positive: string; negative: string; neutral: string };
}

/** Estimate-truncate a body string to fit `widthPx` at the 12px body size. */
function fit(text: string, widthPx: number): string {
    const max = Math.max(8, Math.floor(widthPx / 6.3));
    return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Premium insights card — a compact list of ranked narrative insights, drawn as
 * an SVG block so it scales and exports cleanly with the visual. Host-agnostic:
 * takes Insight[] + geometry + colors, no Power BI imports. A tone dot cues
 * positive / negative / neutral; high-importance lines are weighted.
 */
export function renderInsights(group: GroupSel, insights: Insight[], o: InsightCardOpts): void {
    if (insights.length === 0) return;
    const g = group.append("g").classed("insights-card", true);
    const lineH = 18;

    g.append("text")
        .attr("x", o.x).attr("y", o.y + 10)
        .attr("fill", o.labelColor)
        .attr("font-family", o.font).attr("font-size", "10px")
        .attr("letter-spacing", "0.6px")
        .text("INSIGHTS");

    insights.forEach((ins, i) => {
        const ly = o.y + 12 + (i + 1) * lineH;
        g.append("circle")
            .attr("cx", o.x + 4).attr("cy", ly - 4).attr("r", 3.5)
            .attr("fill", o.toneColors[ins.tone]);
        const t = g.append("text")
            .attr("x", o.x + 14).attr("y", ly)
            .attr("fill", o.textColor)
            .attr("font-family", o.font).attr("font-size", "12px");
        if (ins.importance === "high") t.attr("font-weight", "600");
        t.text(fit(ins.body, o.width - 18));
    });
}
