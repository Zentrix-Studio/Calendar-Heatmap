/**
 * @jest-environment jsdom
 */
import { select } from "d3";
import { applyHighlight, applyCrossHighlight, STATE } from "../src/render/states";
import { DayCell } from "../src/types";

const D = (m: number, d: number) => new Date(2025, m, d);

function cellsWith(flags: (boolean | undefined)[]): any {
    const days: DayCell[] = flags.map((f, i) => ({
        date: D(0, i + 1), value: i, noData: false, col: 0, row: i,
        selectionId: null, sourceIndex: i, isHighlighted: f,
    }));
    const svg = select(document.body).append("svg");
    return svg.append("g").selectAll("rect").data(days).enter().append("rect") as any;
}

describe("applyHighlight — reuses the cross-highlight dim treatment", () => {
    test("highlighted cells stay full opacity; others dim to STATE.dimOpacity", () => {
        const cells = cellsWith([true, false, true]);
        applyHighlight(cells);
        const ops = cells.nodes().map((n: SVGRectElement) => n.getAttribute("fill-opacity"));
        expect(ops).toEqual(["1", String(STATE.dimOpacity), "1"]);
    });

    test("matches applyCrossHighlight output for the same selection set", () => {
        const a = cellsWith([true, false, false]);
        applyHighlight(a);
        const b = cellsWith([true, false, false]);
        applyCrossHighlight(b, d => d.isHighlighted === true, true);
        expect(a.nodes().map((n: SVGRectElement) => n.getAttribute("fill-opacity")))
            .toEqual(b.nodes().map((n: SVGRectElement) => n.getAttribute("fill-opacity")));
    });
});
