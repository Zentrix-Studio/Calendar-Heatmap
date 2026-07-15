/**
 * @jest-environment jsdom
 *
 * Z-149 — Core-5 cell pattern module (render/patterns.ts). Asserts:
 *  - each Core-5 style emits exactly one reusable <pattern> def per (style,theme,
 *    bucket) and a per-cell <rect fill=url(#…)> — NOT per-cell <line>/<clipPath>.
 *  - ensurePatternDef is idempotent (same id, one def across N calls).
 *  - density bucket changes the def id + tile size (legibility on tiny cells).
 *  - dark/light themes apply the CVD contrast (stroke-opacity 0.46 vs 0.38 — softened in issue #5).
 *  - box.size <= 0 is a no-op.
 */
import { select } from "d3";
import {
    ensurePatternDef, drawPattern, densityBucket, PATTERN_STYLES, PatternStyle,
} from "../../src/render/patterns";

function defs() {
    const svg = select(document.body).append("svg");
    return svg.append("defs") as any;
}
function group() {
    const svg = select(document.body).append("svg");
    return svg.append("g") as any;
}
afterEach(() => { document.body.replaceChildren(); });

const BOX = { x: 12, y: 12, size: 18 };

describe("Core-5 set", () => {
    it("exposes exactly the five styles in the fixed order (diagonal first)", () => {
        expect(PATTERN_STYLES).toEqual(["diagonal", "dots", "crosshatch", "grid", "stars"]);
    });
});

describe("ensurePatternDef — reusable, idempotent defs", () => {
    it.each(PATTERN_STYLES)("style %s creates one <pattern> def and is idempotent", (style) => {
        const d = defs();
        const bucket = densityBucket(BOX.size);
        const id1 = ensurePatternDef(d, style as PatternStyle, false, bucket);
        const id2 = ensurePatternDef(d, style as PatternStyle, false, bucket);
        const id3 = ensurePatternDef(d, style as PatternStyle, false, bucket);
        expect(id1).toBe(id2);
        expect(id2).toBe(id3);
        // Exactly one <pattern> for that (style, theme, bucket), reused.
        expect(d.selectAll(`#${id1}`).size()).toBe(1);
        expect(d.selectAll("pattern").size()).toBe(1);
    });

    it("a different density bucket → a different def (different id + tile size)", () => {
        const d = defs();
        const small = ensurePatternDef(d, "dots", false, densityBucket(6));
        const large = ensurePatternDef(d, "dots", false, densityBucket(48));
        expect(small).not.toBe(large);
        expect(d.selectAll("pattern").size()).toBe(2);
        const w = (id: string) => parseFloat(d.select(`#${id}`).attr("width"));
        expect(w(large)).toBeGreaterThan(w(small));
    });

    it("dark vs light produce distinct defs with the softened CVD contrast opacity", () => {
        const d = defs();
        const idDark = ensurePatternDef(d, "diagonal", true, 3);
        const idLight = ensurePatternDef(d, "diagonal", false, 3);
        expect(idDark).not.toBe(idLight);
        const op = (id: string) => d.select(`#${id}`).select("line").attr("stroke-opacity");
        expect(parseFloat(op(idDark))).toBeCloseTo(0.46);  // light stroke on dark (softened in issue #5)
        expect(parseFloat(op(idLight))).toBeCloseTo(0.38);  // dark stroke on light (softened in issue #5)
    });

    it("no raw hex: strokes resolve from tokens (#F4F4F6 dark / #15161E light)", () => {
        const d = defs();
        const idDark = ensurePatternDef(d, "grid", true, 3);
        const idLight = ensurePatternDef(d, "grid", false, 3);
        expect(d.select(`#${idDark}`).select("line").attr("stroke")).toBe("#F4F4F6");
        expect(d.select(`#${idLight}`).select("line").attr("stroke")).toBe("#15161E");
    });
});

describe("drawPattern — fill rect, no per-cell lines/clip", () => {
    it.each(PATTERN_STYLES)("style %s fills a rect with url(#id) and is pointer-events:none", (style) => {
        const d = defs(); const g = group();
        drawPattern(d, g, BOX, false, style as PatternStyle);
        const rect = g.select("rect").node() as SVGRectElement;
        expect(rect).toBeTruthy();
        const expectedId = ensurePatternDef(d, style as PatternStyle, false, densityBucket(BOX.size));
        expect(rect.getAttribute("fill")).toBe(`url(#${expectedId})`);
        expect(rect.getAttribute("pointer-events")).toBe("none");
        // The overlay must NOT carry per-cell <line> or <clipPath> (the killed approach).
        expect(g.selectAll("line").size()).toBe(0);
        expect(g.selectAll("clipPath").size()).toBe(0);
    });

    it("N cells of the same (style,theme,bucket) reuse ONE def, add N fill rects", () => {
        const d = defs(); const g = group();
        for (let i = 0; i < 20; i++) drawPattern(d, g, { x: i * 18, y: 0, size: 18 }, false, "dots");
        expect(d.selectAll("pattern").size()).toBe(1);   // one def, reused
        expect(g.selectAll("rect").size()).toBe(20);     // one fill rect per cell
        expect(g.selectAll("line").size()).toBe(0);
    });

    it("defaults to diagonal when no style is passed (back-compat)", () => {
        const d = defs(); const g = group();
        drawPattern(d, g, BOX, false);
        const diagId = ensurePatternDef(d, "diagonal", false, densityBucket(BOX.size));
        expect((g.select("rect").node() as SVGRectElement).getAttribute("fill")).toBe(`url(#${diagId})`);
    });

    it("box.size <= 0 is a no-op (no def, no rect)", () => {
        const d = defs(); const g = group();
        drawPattern(d, g, { x: 0, y: 0, size: 0 }, false, "stars");
        expect(d.selectAll("pattern").size()).toBe(0);
        expect(g.selectAll("rect").size()).toBe(0);
    });
});

describe("densityBucket — scales with cell size, finite set", () => {
    it("monotonic non-decreasing and clamped to a small range", () => {
        const buckets = [2, 6, 12, 24, 48, 96].map(densityBucket);
        for (let i = 1; i < buckets.length; i++) expect(buckets[i]).toBeGreaterThanOrEqual(buckets[i - 1]);
        expect(Math.min(...buckets)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...buckets)).toBeLessThanOrEqual(8);
    });
});
