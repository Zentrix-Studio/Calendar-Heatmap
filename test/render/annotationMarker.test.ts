/**
 * @jest-environment jsdom
 *
 * The Dot / Icon marker primitives in states.ts, at the drawing level.
 *
 * These outlived the data-bound annotation role they were built for (Z-147): the
 * annotation layer (Z-152) still uses them to draw the on-grid indicator for an
 * author-written note, alongside its own numbered marker. Mode/placement behavior
 * lives in test/render/annotations.test.ts; this file pins the primitives.
 */
import { select } from "d3";
import { drawAnnotationDot, drawAnnotationIcon } from "../../src/render/states";

function group() {
    const svg = select(document.body).append("svg");
    return svg.append("g") as any;
}
afterEach(() => { document.body.replaceChildren(); });

const BOX = { x: 10, y: 10, size: 22 };

describe("drawAnnotationDot (default Dot, more visible)", () => {
    it("draws a colored dot plus a contrasting white halo (two circles)", () => {
        const g = group();
        drawAnnotationDot(g, BOX, "#7C5CFF");
        const circles = g.selectAll("circle").nodes() as SVGCircleElement[];
        expect(circles.length).toBe(2); // halo + dot
        const halo = circles[0], dot = circles[1];
        expect(halo.getAttribute("fill")).toMatch(/rgba\(255, ?255, ?255/);
        expect(dot.getAttribute("fill")).toBe("#7C5CFF");
        // halo radius is larger than the dot (so it reads as a ring under it)
        expect(parseFloat(halo.getAttribute("r")!)).toBeGreaterThan(parseFloat(dot.getAttribute("r")!));
    });

    it("uses the caller-supplied (token-sourced) color", () => {
        const g = group();
        drawAnnotationDot(g, BOX, "#E69F00");
        const dot = (g.selectAll("circle").nodes() as SVGCircleElement[])[1];
        expect(dot.getAttribute("fill")).toBe("#E69F00");
    });

    it("is larger than the legacy 0.12·size dot (>= 2px, ~0.16·size)", () => {
        const g = group();
        drawAnnotationDot(g, BOX);
        const dot = (g.selectAll("circle").nodes() as SVGCircleElement[])[1];
        expect(parseFloat(dot.getAttribute("r")!)).toBeGreaterThanOrEqual(Math.max(2, BOX.size * 0.16));
    });
});

describe("drawAnnotationIcon (opt-in Icon mode)", () => {
    it("renders the chosen glyph as text", () => {
        const g = group();
        drawAnnotationIcon(g, BOX, "📌");
        const text = g.select("text").node() as SVGTextElement;
        expect(text).toBeTruthy();
        expect(text.textContent).toBe("📌");
        expect(text.getAttribute("pointer-events")).toBe("none");
    });
});
