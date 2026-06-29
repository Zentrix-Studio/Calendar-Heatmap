/**
 * @jest-environment jsdom
 */
import { select } from "d3";
import { bindKeyboard } from "../src/interaction/keyboard";
import { CalendarModel, DayCell } from "../src/types";

const D = (m: number, d: number) => new Date(2025, m, d);

/** Two adjacent day cells over one facet, rendered as <rect> in an SVG <g>. */
function makeCells(): { cells: any; model: CalendarModel; nodes: SVGRectElement[] } {
    const days: DayCell[] = [
        { date: D(0, 1), value: 1, noData: false, col: 0, row: 0, selectionId: { __k: "a" } as any, sourceIndex: 0 },
        { date: D(0, 2), value: 2, noData: false, col: 0, row: 1, selectionId: { __k: "b" } as any, sourceIndex: 1 },
    ];
    const svg = select(document.body).append("svg");
    const g = svg.append("g");
    const cells = g.selectAll("rect").data(days).enter().append("rect").classed("cell", true) as any;
    const model: CalendarModel = {
        days, monthLabels: [], range: [D(0, 1), D(0, 2)], valueDomain: [1, 2],
        weeks: 1, hasToday: false, valueName: "Sales", totalDays: 2,
    };
    return { cells, model, nodes: cells.nodes() };
}

function press(node: SVGElement, key: string, shiftKey = false): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
    node.dispatchEvent(ev);
    return ev;
}

describe("keyboard context menu (ContextMenu key + Shift+F10)", () => {
    function setup() {
        const { cells, model, nodes } = makeCells();
        const calls: { d: DayCell; node: SVGElement }[] = [];
        bindKeyboard({
            cells, model, valueName: "Sales",
            onActivate: () => undefined,
            onClear: () => undefined,
            drawFocus: () => undefined,
            onContextMenu: (d, node) => calls.push({ d, node }),
        });
        return { nodes, calls };
    }

    test("ContextMenu key opens the menu for the focused cell + preventDefault", () => {
        const { nodes, calls } = setup();
        const ev = press(nodes[0], "ContextMenu");
        expect(calls).toHaveLength(1);
        expect(calls[0].node).toBe(nodes[0]);
        expect(calls[0].d.date.getTime()).toBe(D(0, 1).getTime());
        expect(ev.defaultPrevented).toBe(true);
    });

    test("Shift+F10 opens the menu; bare F10 does NOT", () => {
        const { nodes, calls } = setup();
        const bare = press(nodes[1], "F10", false);
        expect(calls).toHaveLength(0);
        expect(bare.defaultPrevented).toBe(false);

        const shifted = press(nodes[1], "F10", true);
        expect(calls).toHaveLength(1);
        expect(calls[0].node).toBe(nodes[1]);
        expect(shifted.defaultPrevented).toBe(true);
    });
});
