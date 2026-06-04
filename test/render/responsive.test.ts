import { planChrome, PlanInput } from "../../src/render/responsive";

/** A predictor where the cell size is the leftover height after chrome, scaled.
 * More reserved chrome (top+bottom) → smaller cells, like the real grid. */
const sizeFromSpace = (totalH: number, scale = 0.1) =>
    (top: number, bottom: number) => Math.max(1, (totalH - top - bottom) * scale);

const base = (over: Partial<PlanInput> = {}): PlanInput => ({
    headerH: 42,
    legendH: 28,
    legendTop: false,
    insightsCount: 3,
    insightsLineH: 18,
    insightsOverhead: 24,
    predict: sizeFromSpace(600),
    floor: 7,
    ...over,
});

describe("planChrome", () => {
    test("keeps all chrome when there's plenty of room", () => {
        const p = planChrome(base({ predict: () => 20 }));
        expect(p.showHeader).toBe(true);
        expect(p.showLegend).toBe(true);
        expect(p.insightsCount).toBe(3);
        expect(p.showHeaderChips).toBe(true);
        expect(p.legendLabels).toBe(true);
    });

    test("drops insights lines before touching the legend or header", () => {
        // Tight enough that some insight lines must go, but not everything.
        const p = planChrome(base({ predict: sizeFromSpace(200) }));
        expect(p.insightsCount).toBeLessThan(3);
        // Legend/header are higher priority — only dropped if insights weren't enough.
        if (p.insightsCount > 0) {
            expect(p.showLegend).toBe(true);
            expect(p.showHeader).toBe(true);
        }
    });

    test("drop order is insights → legend → header", () => {
        const p = planChrome(base({ predict: sizeFromSpace(120) }));
        // With very little space, insights drain first, then legend, then header.
        expect(p.insightsCount).toBe(0);
        // header is the last to go, so legend should drop before it
        if (p.showHeader) expect(p.showLegend).toBe(false);
    });

    test("never drops below the available bands (best-effort on a tiny canvas)", () => {
        const p = planChrome(base({ predict: sizeFromSpace(60) }));
        expect(p.showHeader).toBe(false);
        expect(p.showLegend).toBe(false);
        expect(p.insightsCount).toBe(0);
        expect(p.size).toBeGreaterThan(0);
    });

    test("clutter elements gate on final cell size", () => {
        // size exactly 6.5 → rule (≥6) on, chips (≥8) off, legend labels (≥7) off
        const p = planChrome(base({ predict: () => 6.5, floor: 0 }));
        expect(p.showHeaderRule).toBe(true);
        expect(p.showHeaderChips).toBe(false);
        expect(p.legendLabels).toBe(false);
    });

    test("requested-off bands stay off and aren't 'kept'", () => {
        const p = planChrome(base({ headerH: 0, legendH: 0, insightsCount: 0, predict: () => 20 }));
        expect(p.showHeader).toBe(false);
        expect(p.showLegend).toBe(false);
        expect(p.insightsCount).toBe(0);
    });

    test("respects legend docked at top (reserves top space)", () => {
        let sawTop = 0;
        planChrome(base({
            legendTop: true, insightsCount: 0,
            predict: (top) => { sawTop = top; return 20; },
        }));
        // header(42) + legend(28) both reserved at top
        expect(sawTop).toBe(70);
    });
});
