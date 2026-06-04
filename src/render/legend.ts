"use strict";

import { GroupSel } from "./grid";
import { ColorAccessor } from "./colors";
import { TextStyle, applyText, defaultText } from "./text";

export type LegendAlign = "start" | "center" | "end";
export type NoDataSide = "left" | "right";

export interface LegendOptions {
    /** Left edge of the available band. */
    x: number;
    /** Top edge of the available band. */
    y: number;
    /** Width the legend aligns within ([x, x+availableWidth]). */
    availableWidth: number;
    align: LegendAlign;
    swatchSize: number;
    gradientLength: number;
    colors: ColorAccessor;
    labelColor: string;
    showLabels: boolean;
    lessLabel: string;
    moreLabel: string;
    showNoData: boolean;
    noDataSide: NoDataSide;
    title: string;
    textStyle?: TextStyle;
    /** Stable id suffix so multiple gradient defs don't collide. */
    idSuffix?: string;
}

const GAP = 3;

/** Approximate text advance for a label at the given style size. */
function advance(s: string, size: number): number {
    return s.length * size * 0.54;
}

/** Height a legend band needs for the given swatch + text size. */
export function legendBandHeight(swatchSize: number, textSize: number): number {
    return Math.max(swatchSize, textSize) + 10;
}

/**
 * Render a horizontal legend within [x, x+availableWidth], aligned start/center/end.
 * Layout (left→right): [title] [no-data?] [low] [ramp] [high] [no-data?] — the
 * no-data block sits on the configured side. Returns the band height consumed.
 */
export function renderLegend(group: GroupSel, o: LegendOptions): number {
    const ts = o.textStyle ?? defaultText(10);
    const size = ts.size;
    const sw = o.swatchSize;
    const bucketed = o.colors.buckets >= 2;
    const rampW = bucketed
        ? o.colors.swatches.length * sw + (o.colors.swatches.length - 1) * GAP
        : o.gradientLength;
    const bandH = legendBandHeight(sw, size);
    const midY = o.y + bandH / 2;

    // Measure for alignment.
    const titleW = o.title ? advance(o.title, size) + 10 : 0;
    const lessW = o.showLabels ? advance(o.lessLabel, size) + 6 : 0;
    const moreW = o.showLabels ? 6 + advance(o.moreLabel, size) : 0;
    const noDataW = o.showNoData ? sw + 4 + advance("No data", size) + 12 : 0;
    const total = titleW + lessW + rampW + moreW + noDataW;

    let cursor = o.x + (o.align === "center" ? (o.availableWidth - total) / 2
        : o.align === "end" ? o.availableWidth - total : 0);
    if (cursor < o.x) cursor = o.x;

    const g = group.append("g").classed("legend", true);

    const swatch = (x: number, fill: string) =>
        g.append("rect").attr("x", x).attr("y", midY - sw / 2).attr("width", sw).attr("height", sw)
            .attr("rx", 2).attr("ry", 2).attr("fill", fill)
            .attr("stroke", o.labelColor).attr("stroke-opacity", 0.18);
    const label = (x: number, str: string) => {
        applyText(g.append("text").attr("x", x).attr("y", midY).attr("dominant-baseline", "middle").text(str), ts, o.labelColor);
        return x + advance(str, size);
    };
    const noDataBlock = () => {
        swatch(cursor, o.colors.noData); cursor += sw + 4;
        cursor = label(cursor, "No data") + 12;
    };

    if (o.title) cursor = label(cursor, o.title) + 10;
    if (o.showNoData && o.noDataSide === "left") noDataBlock();
    if (o.showLabels) cursor = label(cursor, o.lessLabel) + 6;

    if (bucketed) {
        for (const c of o.colors.swatches) { swatch(cursor, c); cursor += sw + GAP; }
        cursor += 6 - GAP;
    } else {
        const gradId = `zx-legend-grad-${o.idSuffix ?? "0"}`;
        const lg = g.append("defs").append("linearGradient").attr("id", gradId).attr("x1", "0%").attr("x2", "100%");
        for (const stop of o.colors.gradientStops) {
            lg.append("stop").attr("offset", `${stop.offset * 100}%`).attr("stop-color", stop.color);
        }
        g.append("rect").attr("x", cursor).attr("y", midY - sw / 2)
            .attr("width", o.gradientLength).attr("height", sw)
            .attr("rx", 2).attr("ry", 2).attr("fill", `url(#${gradId})`);
        cursor += o.gradientLength + 6;
    }

    if (o.showLabels) cursor = label(cursor, o.moreLabel) + 6;
    if (o.showNoData && o.noDataSide === "right") { cursor += 6; noDataBlock(); }

    return bandH;
}
