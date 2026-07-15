/**
 * @jest-environment jsdom
 *
 * Z-152 — the annotation render layer.
 *
 * The load-bearing constraint here is that this layer NEVER MEASURES TEXT. The
 * whole jsdom harness (including the ~250-case settings sweep) works only because
 * the render path computes layout arithmetically and never calls getBBox — jsdom
 * returns zeros for it. Wrapping is therefore estimated, and these tests pin that
 * estimate's behavior so a well-meaning "let's measure properly" refactor fails
 * loudly here instead of silently breaking the sweep.
 */
import { select } from "d3";
import { renderAnnotations, wrapText, calloutGeometry, NoteAnchor } from "../../src/render/annotations";
import type { Note } from "../../src/notes/core";
import type { DayCell } from "../../src/types";

function group() {
    const svg = select(document.body).append("svg");
    return svg.append("g") as any;
}
afterEach(() => { document.body.replaceChildren(); });

const note = (over: Partial<Note> = {}): Note => ({
    id: "n1", anchor: "2025-03-14|", text: "Release 4.2 shipped",
    mode: "all", style: {}, dx: 1.6, dy: -2.4, ...over,
});

/** A day cell with a pixel box already stamped on it by the grid drawer. */
const cell = (px = 100, py = 100, ps = 14): DayCell => ({
    date: new Date(2025, 2, 14), value: 5, noData: false, col: 0, row: 0,
    selectionId: null, sourceIndex: 0, px, py, ps,
});

const anchor = (n: Note, c = cell(), index = 1): NoteAnchor => ({ note: n, cell: c, index });

const OPTS = {
    markerStyle: "number" as const, markerIcon: "📌", markerColor: "#7C5CFF",
    dark: false, width: 800, height: 400, editable: true,
};

describe("wrapText (arithmetic, never measured)", () => {
    it("wraps on word boundaries", () => {
        const lines = wrapText("the quick brown fox jumps over the lazy dog", 11, 100, 6);
        expect(lines.length).toBeGreaterThan(1);
        // No word is ever split across lines...
        expect(lines.join(" ").split(/\s+/)).toEqual("the quick brown fox jumps over the lazy dog".split(" "));
    });

    it("hard-breaks a single word longer than the line", () => {
        const lines = wrapText("supercalifragilisticexpialidocious", 11, 60, 6);
        expect(lines.length).toBeGreaterThan(1);
        expect(lines.join("")).toBe("supercalifragilisticexpialidocious");
    });

    it("ellipsizes overflow rather than silently dropping it", () => {
        const lines = wrapText("word ".repeat(200), 11, 100, 3);
        expect(lines).toHaveLength(3);
        expect(lines[2]!.endsWith("…")).toBe(true);
    });

    it("survives degenerate inputs", () => {
        expect(wrapText("", 11, 100, 3)).toEqual([]);
        expect(wrapText("   ", 11, 100, 3)).toEqual([]);
        expect(() => wrapText("hi", 11, 0, 3)).not.toThrow(); // a zero-width box clamps, not divides-by-zero
    });
});

describe("calloutGeometry", () => {
    it("offsets in CELL-SIZE units, so a resize moves the callout with the grid", () => {
        const n = note({ dx: 2, dy: -3 });
        const small = calloutGeometry(n, { x: 100, y: 100, size: 10 }, 800, 400);
        const large = calloutGeometry(n, { x: 100, y: 100, size: 20 }, 800, 400);
        // Same dx/dy, bigger cells → the callout sits proportionally further out.
        expect(small.x).toBe(100 + 2 * 10);
        expect(large.x).toBe(100 + 2 * 20);
    });

    it("clamps inside the canvas so a callout never renders off-screen", () => {
        // A note anchored at the far right with a positive offset would land outside.
        const g = calloutGeometry(note({ dx: 40, dy: 40 }), { x: 780, y: 380, size: 14 }, 800, 400);
        expect(g.x + g.w).toBeLessThanOrEqual(800);
        expect(g.y + g.h).toBeLessThanOrEqual(400);
        expect(g.x).toBeGreaterThanOrEqual(2);
        expect(g.y).toBeGreaterThanOrEqual(2);
    });

    it("grows the box with the line count", () => {
        const short = calloutGeometry(note({ text: "hi" }), { x: 10, y: 10, size: 14 }, 800, 400);
        const long = calloutGeometry(note({ text: "word ".repeat(30) }), { x: 10, y: 10, size: 14 }, 800, 400);
        expect(long.h).toBeGreaterThan(short.h);
    });
});

describe("display modes", () => {
    const modeCounts = (mode: Note["mode"]) => {
        const g = group();
        renderAnnotations(g, [anchor(note({ mode }))], OPTS);
        return {
            markers: g.selectAll("circle").nodes().length,
            callouts: g.selectAll("g.zx-note").nodes().length,
            lines: g.selectAll("line.zx-note-line").nodes().length,
        };
    };

    it("marker: an indicator only — the text is left to the hover tooltip", () => {
        const c = modeCounts("marker");
        expect(c.markers).toBeGreaterThan(0);
        expect(c.callouts).toBe(0);
        expect(c.lines).toBe(0);
    });

    it("text: a callout box only", () => {
        const c = modeCounts("text");
        expect(c.markers).toBe(0);
        expect(c.callouts).toBe(1);
        expect(c.lines).toBe(0);
    });

    it("arrow: a callout plus a leader line back to the day", () => {
        const c = modeCounts("arrow");
        expect(c.markers).toBe(0);
        expect(c.callouts).toBe(1);
        expect(c.lines).toBe(1);
    });

    it("all: indicator + callout + leader line", () => {
        const c = modeCounts("all");
        expect(c.markers).toBeGreaterThan(0);
        expect(c.callouts).toBe(1);
        expect(c.lines).toBe(1);
    });

    it("draws no callout for an empty note — only its marker", () => {
        const g = group();
        renderAnnotations(g, [anchor(note({ text: "  ", mode: "all" }))], OPTS);
        expect(g.selectAll("g.zx-note").nodes()).toHaveLength(0);
        expect(g.selectAll("circle").nodes().length).toBeGreaterThan(0);
    });
});

describe("markers", () => {
    it("numbers markers with the anchor's index", () => {
        const g = group();
        renderAnnotations(g, [
            anchor(note({ id: "a", mode: "marker" }), cell(10, 10), 1),
            anchor(note({ id: "b", mode: "marker" }), cell(40, 10), 2),
        ], OPTS);
        const labels = g.selectAll("text").nodes().map((t: SVGTextElement) => t.textContent);
        expect(labels).toEqual(["1", "2"]);
    });

    it("honors the icon style", () => {
        const g = group();
        renderAnnotations(g, [anchor(note({ mode: "marker" }))], { ...OPTS, markerStyle: "icon", markerIcon: "🚩" });
        expect(g.select("text").node().textContent).toBe("🚩");
    });

    it("keeps markers pointer-transparent so they never steal the cell's click", () => {
        // The cell beneath owns select + the detail panel. A marker that swallowed
        // clicks would make an annotated day un-selectable — a nasty, silent bug.
        const g = group();
        renderAnnotations(g, [anchor(note({ mode: "marker" }))], OPTS);
        for (const c of g.selectAll("circle").nodes() as SVGCircleElement[]) {
            expect(c.getAttribute("pointer-events")).toBe("none");
        }
    });
});

describe("interaction surface", () => {
    it("makes callouts clickable while authoring", () => {
        const g = group();
        const res = renderAnnotations(g, [anchor(note({ mode: "text" }))], OPTS);
        expect(res.callouts.nodes()).toHaveLength(1);
        expect(g.select("g.zx-note").attr("pointer-events")).toBe("all");
    });

    it("makes callouts inert in reading view — a consumer cannot open the editor", () => {
        const g = group();
        renderAnnotations(g, [anchor(note({ mode: "text" }))], { ...OPTS, editable: false });
        expect(g.select("g.zx-note").attr("pointer-events")).toBe("none");
    });

    it("binds each callout to its note, so a click knows which one it hit", () => {
        const g = group();
        const res = renderAnnotations(g, [
            anchor(note({ id: "a", mode: "text" }), cell(10, 10), 1),
            anchor(note({ id: "b", mode: "text", anchor: "2025-06-20|" }), cell(200, 10), 2),
        ], OPTS);
        expect(res.callouts.data().map((a: NoteAnchor) => a.note.id)).toEqual(["a", "b"]);
    });
});

describe("styling", () => {
    it("applies the note's own colors over the theme defaults", () => {
        const g = group();
        renderAnnotations(g, [anchor(note({
            mode: "arrow",
            style: { bold: true, italic: true, color: "#0072B2", bg: "#E69F00", border: "#7C5CFF", arrow: "#E5484D" },
        }))], OPTS);
        const rect = g.select("g.zx-note rect").node() as SVGRectElement;
        const text = g.select("g.zx-note text").node() as SVGTextElement;
        const line = g.select("line.zx-note-line").node() as SVGLineElement;
        expect(rect.getAttribute("fill")).toBe("#E69F00");
        expect(rect.getAttribute("stroke")).toBe("#7C5CFF");
        expect(text.getAttribute("fill")).toBe("#0072B2");
        expect(text.getAttribute("font-weight")).toBe("700");
        expect(text.getAttribute("font-style")).toBe("italic");
        expect(line.getAttribute("stroke")).toBe("#E5484D");
    });

    it("falls back to theme tokens when the author styled nothing", () => {
        // An un-styled note must stay on-brand in BOTH themes — that only holds if
        // the fallbacks come from the token mirror rather than a baked-in hex.
        const light = group();
        renderAnnotations(light, [anchor(note({ mode: "text" }))], OPTS);
        const dark = group();
        renderAnnotations(dark, [anchor(note({ mode: "text" }))], { ...OPTS, dark: true });

        const fill = (g: any) => (g.select("g.zx-note rect").node() as SVGRectElement).getAttribute("fill");
        expect(fill(light)).not.toEqual(fill(dark));
    });

    it("renders note text as tspans — never as markup", () => {
        // Certification bans innerHTML. A note is a text node, always.
        const g = group();
        renderAnnotations(g, [anchor(note({ mode: "text", text: "<script>alert(1)</script> ok" }))], OPTS);
        expect(g.selectAll("g.zx-note script").nodes()).toHaveLength(0);
        const tspans = g.selectAll("g.zx-note tspan").nodes() as SVGTSpanElement[];
        expect(tspans.length).toBeGreaterThan(0);
        expect(tspans.map(t => t.textContent).join(" ")).toContain("script");
    });
});
