"use strict";

/**
 * Hours layout (HM-V2-12) — a weekday × hour-of-day heatmap: 7 rows (in the calendar's
 * week-start order) by 24 hour columns. The third grid drawer beside `renderGrid` and
 * `renderMonthBlocks`, with the same contract: a pure function, a paired pure size
 * predictor for `planChrome`, and layout computed arithmetically (never measured).
 *
 * Cells stamp `px/py/ps` like DayCells so ring overlays align. Colours come from the
 * same ColorAccessor as the calendar, so the legend and the palette settings apply.
 */

import { Selection } from "d3";
import { GroupSel, GridGeometry } from "./grid";
import { ColorAccessor } from "./colors";
import { HourModel, HourCell, DayCell } from "../types";
import { applyText, defaultText, TextStyle } from "./text";

export type HourCellSel = Selection<SVGRectElement, HourCell, SVGGElement, unknown>;

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LABEL_LEFT = 36;
const HEADER_H = 18;

export interface HourGridOptions {
    width: number;
    height: number;
    topOffset: number;
    /** Preferred cell edge (the Cells › Density setting); the hour grid may grow to
     *  twice it — 24 columns leave far more room than 53 weeks. */
    cellSize: number;
    gapX: number;
    gapY: number;
    radius: number;
    colors: ColorAccessor;
    labelColor: string;
    cellStroke?: string;
    weekdayStyle?: TextStyle;
    monthStyle?: TextStyle;
}

/** Hour column label: 12a 3a 6a 9a 12p 3p 6p 9p — every third hour. */
export function hourLabel(h: number): string {
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}${h < 12 ? "a" : "p"}`;
}

function fit(o: HourGridOptions): { size: number; stepX: number; stepY: number } {
    const availW = o.width - LABEL_LEFT - 8;
    const availH = o.height - o.topOffset - HEADER_H - 6;
    const byW = (availW + o.gapX) / 24 - o.gapX;
    const byH = (availH + o.gapY) / 7 - o.gapY;
    const size = Math.max(2, Math.min(o.cellSize * 2, byW, byH));
    return { size, stepX: size + o.gapX, stepY: size + o.gapY };
}

export function predictHourGridSize(o: HourGridOptions): number { return fit(o).size; }

/** A DayCell-shaped view of an hour bucket, so the calendar's ColorAccessor applies. */
export function asColorCell(c: HourCell): DayCell {
    return { value: c.value, noData: c.value == null } as DayCell;
}

export function renderHourGrid(group: GroupSel, model: HourModel, o: HourGridOptions): { geo: GridGeometry; cells: HourCellSel } {
    const { size, stepX, stepY } = fit(o);
    const gridW = 24 * stepX - o.gapX, gridH = 7 * stepY - o.gapY;
    const left = LABEL_LEFT + Math.max(0, (o.width - LABEL_LEFT - 8 - gridW) / 2);
    const availH = o.height - o.topOffset - HEADER_H - 6;
    const top = o.topOffset + HEADER_H + Math.max(0, (availH - gridH) / 2);
    const radius = Math.min(o.radius, size * 0.5);

    for (const c of model.cells) { c.px = left + c.col * stepX; c.py = top + c.row * stepY; c.ps = size; }

    const g = group.append("g").classed("hour-grid", true) as unknown as GroupSel;
    const cells = g.selectAll<SVGRectElement, HourCell>("rect.hour-cell").data(model.cells).enter()
        .append("rect").classed("hour-cell", true)
        .attr("x", c => c.px!).attr("y", c => c.py!)
        .attr("width", size).attr("height", size).attr("rx", radius).attr("ry", radius)
        .attr("fill", c => o.colors.of(asColorCell(c)))
        .attr("stroke", o.cellStroke ?? null).attr("stroke-width", o.cellStroke ? 1 : null)
        .style("cursor", c => (c.rows ? "pointer" : "default")) as unknown as HourCellSel;

    const wdStyle = o.weekdayStyle ?? defaultText(10);
    for (let r = 0; r < 7; r++) {
        const wd = (model.firstDayOfWeek + r) % 7;
        applyText(g.append("text").classed("weekday", true)
            .attr("x", left - 6).attr("y", top + r * stepY + size / 2 + wdStyle.size * 0.35)
            .attr("text-anchor", "end").text(WEEKDAY_NAMES[wd]), wdStyle, o.labelColor);
    }
    const hStyle = o.monthStyle ?? defaultText(10);
    // Every third hour; every sixth when cells get too narrow for the labels.
    const every = stepX * 3 < hStyle.size * 2.6 ? 6 : 3;
    for (let h = 0; h < 24; h += every) {
        applyText(g.append("text").classed("hour", true)
            .attr("x", left + h * stepX).attr("y", top - 5).text(hourLabel(h)), hStyle, o.labelColor);
    }

    return {
        geo: { size, stepX, stepY, marginLeft: left, marginTop: top, gridWidth: gridW, gridHeight: gridH },
        cells,
    };
}
