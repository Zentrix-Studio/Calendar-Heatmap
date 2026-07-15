/**
 * @jest-environment jsdom
 *
 * Z-137 regression guards for the continuous grid renderer:
 *  - corner-radius clamp relaxed to size*0.5 (was size*0.18 — the slider read dead)
 *  - independent row/column gaps (gapY drives row pitch, gapX drives column pitch)
 * Both are pure geometry, so they're asserted off the emitted cell rects directly.
 */
import "../harness/svgPolyfill";
import { select } from "d3";
import { renderGrid, GridOptions } from "../../src/render/grid";
import { CalendarModel, DayCell } from "../../src/types";
import { ColorAccessor } from "../../src/render/colors";

/** A full calendar year of days — enough columns/rows to exercise both axes. */
function yearModel(year = 2025): CalendarModel {
    const days: DayCell[] = [];
    const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
    let i = 0;
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        days.push({
            date: new Date(t), value: i % 7, noData: false,
            col: 0, row: 0, selectionId: null, sourceIndex: i++,
        } as DayCell);
    }
    return { days } as unknown as CalendarModel;
}

const flatColors: ColorAccessor = { of: () => "#7C5CFF" } as unknown as ColorAccessor;

function baseOpts(over: Partial<GridOptions>): GridOptions {
    return {
        width: 1200, height: 420, cellSize: 22, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors: flatColors,
        showMonthLabels: false, showWeekdayLabels: false,
        labelColor: "#70707F", ...over,
    };
}

function renderInto(opts: GridOptions) {
    const svg = select(document.body).append("svg");
    const g = svg.append("g");
    const res = renderGrid(g as any, yearModel(), opts);
    const rects = g.selectAll<SVGRectElement, unknown>("rect.cell").nodes();
    return { res, rects, cleanup: () => svg.remove() };
}

describe("corner radius clamp (Z-137 §2)", () => {
    test("at a large cell size, radius=12 is applied in full (clamp is size*0.5, not *0.18)", () => {
        // Plenty of room → cells hit the 22px cap; 12 < 22*0.5=11? no — clamp is 11.
        const { rects, res, cleanup } = renderInto(baseOpts({ radius: 12, cellSize: 22, width: 1600, height: 700 }));
        const rx = +rects[0].getAttribute("rx")!;
        // Old clamp (size*0.18) would cap rx at ~22*0.18≈3.96; new clamp (size*0.5) lifts it.
        expect(rx).toBeGreaterThan(4);
        expect(rx).toBeCloseTo(res.geo.size * 0.5, 5);
        cleanup();
    });

    test("clamp still prevents overflow: rx never exceeds half the cell", () => {
        const { rects, res, cleanup } = renderInto(baseOpts({ radius: 999, cellSize: 22, width: 1600, height: 700 }));
        const rx = +rects[0].getAttribute("rx")!;
        expect(rx).toBeLessThanOrEqual(res.geo.size / 2 + 1e-6);
        cleanup();
    });

    test("at a small cell size the radius scales down with the cell", () => {
        // Constrain height so the auto-fit shrinks cells well below the 22px cap.
        const { rects, res, cleanup } = renderInto(baseOpts({ radius: 12, cellSize: 22, width: 300, height: 70 }));
        const rx = +rects[0].getAttribute("rx")!;
        expect(res.geo.size).toBeLessThan(12);
        expect(rx).toBeCloseTo(Math.min(12, res.geo.size * 0.5), 5);
        cleanup();
    });
});

describe("independent row / column gaps (Z-137 §3)", () => {
    test("gapX and gapY drive column/row pitch independently", () => {
        const { res, cleanup } = renderInto(baseOpts({ gapX: 8, gapY: 2, cellSize: 10, width: 1600, height: 700 }));
        expect(res.geo.stepX).toBeCloseTo(res.geo.size + 8, 5);
        expect(res.geo.stepY).toBeCloseTo(res.geo.size + 2, 5);
        expect(res.geo.stepX).not.toEqual(res.geo.stepY);
        cleanup();
    });

    test("equal gaps reproduce the legacy square pitch (default 3/3)", () => {
        const { res, cleanup } = renderInto(baseOpts({ gapX: 3, gapY: 3, cellSize: 10, width: 1600, height: 700 }));
        expect(res.geo.stepX).toEqual(res.geo.stepY);
        expect(res.geo.stepX).toBeCloseTo(res.geo.size + 3, 5);
        cleanup();
    });

    test("cell x-pitch follows gapX; cell y-pitch follows gapY", () => {
        // Find two cells in the same band: one a column apart (same row, adjacent week)
        // and one a row apart (same column, adjacent weekday).
        const { res, rects, cleanup } = renderInto(baseOpts({ gapX: 9, gapY: 1, cellSize: 10, width: 1600, height: 700 }));
        const xs = rects.map(r => +r.getAttribute("x")!);
        const ys = rects.map(r => +r.getAttribute("y")!);
        const uniq = (a: number[]) => [...new Set(a.map(n => Math.round(n)))].sort((p, q) => p - q);
        const dxs = uniq(xs); const dys = uniq(ys);
        // Smallest positive x-step ≈ stepX (gapX); smallest positive y-step ≈ stepY (gapY).
        const minGap = (vals: number[]) => Math.min(...vals.slice(1).map((v, i) => v - vals[i]));
        expect(minGap(dxs)).toBeCloseTo(res.geo.stepX, 0);
        expect(minGap(dys)).toBeCloseTo(res.geo.stepY, 0);
        cleanup();
    });
});
