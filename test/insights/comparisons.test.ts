"use strict";

import { computeComparisons } from "../../src/insights/comparisons";
import { DailySeries, DailyDatum } from "../../src/insights/types";

/** Build a contiguous daily series from [start..end] with a value function (null = gap). */
function series(start: Date, end: Date, valueFor: (d: Date) => number | null, referenceDate = end): DailySeries {
    const data: DailyDatum[] = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur <= end) {
        data.push({ date: new Date(cur), value: valueFor(cur) });
        cur.setDate(cur.getDate() + 1);
    }
    return { data, valueName: "Test", referenceDate };
}

describe("computeComparisons (YoY)", () => {
    it("returns null with fewer than two years of data", () => {
        const s = series(new Date(2025, 0, 1), new Date(2025, 11, 31), () => 10);
        expect(computeComparisons(s)).toBeNull();
    });

    it("returns null when the prior year is absent (gap year)", () => {
        const s = series(new Date(2023, 0, 1), new Date(2025, 11, 31), d =>
            d.getFullYear() === 2024 ? null : 5);
        expect(computeComparisons(s)).toBeNull();
    });

    it("computes a full-year YoY total delta", () => {
        const s = series(new Date(2024, 0, 1), new Date(2025, 11, 31), d =>
            d.getFullYear() === 2025 ? 2 : 1);
        const r = computeComparisons(s)!;
        expect(r).not.toBeNull();
        expect(r.currentYear).toBe(2025);
        expect(r.priorYear).toBe(2024);
        expect(r.fiscal).toBe(false);
        expect(r.partial).toBe(false);
        expect(r.totalDeltaPct).toBeCloseTo(1.0, 5);
        expect(r.avgDeltaPct).toBeCloseTo(1.0, 5);
    });

    it("guards the partial current year - compares like calendar windows only", () => {
        const s = series(new Date(2024, 0, 1), new Date(2025, 5, 30), d =>
            d.getFullYear() === 2025 ? 11 : 10);
        const r = computeComparisons(s)!;
        expect(r.partial).toBe(true);
        expect(r.window.toOrdinal).toBe(630); // Jun 30
        expect(r.avgDeltaPct).toBeCloseTo(0.1, 5);
        expect(r.totalDeltaPct).toBeGreaterThan(0.05);
        expect(r.totalDeltaPct).toBeLessThan(0.15);
    });

    it("emits per-quarter deltas only for fully-covered quarters", () => {
        const s = series(new Date(2024, 0, 1), new Date(2025, 7, 15), d =>
            d.getFullYear() === 2025 ? 3 : 2);
        const r = computeComparisons(s)!;
        const quarters = r.byQuarter.map(q => q.q);
        expect(quarters).toContain(1);
        expect(quarters).toContain(2);
        expect(quarters).not.toContain(3);
        for (const q of r.byQuarter) expect(q.deltaPct).toBeCloseTo(0.5, 5);
    });

    it("handles a prior-year total of zero without dividing by zero", () => {
        const s = series(new Date(2024, 0, 1), new Date(2025, 11, 31), d =>
            d.getFullYear() === 2025 ? 4 : 0);
        const r = computeComparisons(s)!;
        expect(Number.isFinite(r.totalDeltaPct)).toBe(true);
        expect(r.totalDeltaPct).toBe(1);
    });
});

describe("computeComparisons (fiscal year)", () => {
    it("default (start=1) matches calendar-year behaviour", () => {
        const s = series(new Date(2024, 0, 1), new Date(2025, 11, 31), d =>
            d.getFullYear() === 2025 ? 2 : 1);
        const r = computeComparisons(s, 1)!;
        expect(r.fiscal).toBe(false);
        expect(r.currentYear).toBe(2025);
        expect(r.totalDeltaPct).toBeCloseTo(1.0, 5);
    });

    it("a July fiscal start shifts the year boundary and labels FY", () => {
        const fyStart = new Date(2023, 6, 1);   // Jul 1, 2023
        const fyEnd = new Date(2025, 5, 30);    // Jun 30, 2025
        const s = series(fyStart, fyEnd, d => (d >= new Date(2024, 6, 1) ? 2 : 1));
        // Fiscal years are named by their START calendar year: FY2024 = Jul 2024 .. Jun 2025.
        const r = computeComparisons(s, 7)!;
        expect(r.fiscal).toBe(true);
        expect(r.currentYear).toBe(2024);
        expect(r.priorYear).toBe(2023);
        expect(r.partial).toBe(false);           // reached the 12th fiscal month (June)
        expect(r.totalDeltaPct).toBeCloseTo(1.0, 5);
    });

    it("a July fiscal start flags a partial year before the fiscal year-end", () => {
        const s = series(new Date(2023, 6, 1), new Date(2024, 11, 31), d =>
            (d >= new Date(2024, 6, 1) ? 2 : 1));
        const r = computeComparisons(s, 7)!;
        expect(r.fiscal).toBe(true);
        expect(r.partial).toBe(true);
        expect(Math.floor(r.window.toOrdinal / 100)).toBe(6); // Dec = 6th fiscal month
    });
});
