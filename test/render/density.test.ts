import { thinMonthLabels, estTextWidth, ColLabel } from "../../src/render/density";

const months = (cols: number[]): ColLabel[] =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        .slice(0, cols.length)
        .map((label, i) => ({ label, col: cols[i] }));

// A full year, one month every ~4.33 weeks.
const YEAR = months([0, 4, 9, 13, 17, 22, 26, 31, 35, 39, 44, 48]);

describe("thinMonthLabels", () => {
    test("keeps every month when cells are large (no collision)", () => {
        const kept = thinMonthLabels(YEAR, 16, 10);
        expect(kept.length).toBe(12);
    });

    test("always keeps the first label (Jan anchors col 0)", () => {
        const kept = thinMonthLabels(YEAR, 2, 10);
        expect(kept[0].label).toBe("Jan");
    });

    test("thins to a sparser cadence as step shrinks", () => {
        const big = thinMonthLabels(YEAR, 16, 10).length;
        const mid = thinMonthLabels(YEAR, 4, 10).length;
        const tiny = thinMonthLabels(YEAR, 2, 10).length;
        expect(big).toBeGreaterThan(mid);
        expect(mid).toBeGreaterThan(tiny);
        expect(tiny).toBeGreaterThanOrEqual(1);
    });

    test("kept labels never overlap (each clears the prior right edge + pad)", () => {
        const step = 5, font = 10, pad = 4;
        const kept = thinMonthLabels(YEAR, step, font, pad);
        for (let i = 1; i < kept.length; i++) {
            const prevRight = kept[i - 1].col * step + estTextWidth(kept[i - 1].label, font);
            expect(kept[i].col * step).toBeGreaterThanOrEqual(prevRight + pad);
        }
    });

    test("kept labels stay in input (column) order", () => {
        const kept = thinMonthLabels(YEAR, 4, 10);
        for (let i = 1; i < kept.length; i++) {
            expect(kept[i].col).toBeGreaterThan(kept[i - 1].col);
        }
    });

    test("empty input yields nothing", () => {
        expect(thinMonthLabels([], 4, 10)).toEqual([]);
    });
});
