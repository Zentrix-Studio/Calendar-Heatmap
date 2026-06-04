import { computeWeekdayPatterns } from "../../src/insights/weekdayPatterns";
import { DailySeries, DailyDatum } from "../../src/insights/types";

// 2025-01-05 is a Sunday (getDay 0) — anchor so weekday math is unambiguous.
const SUN = new Date(2025, 0, 5);

function buildSeries(start: Date, values: (number | null)[]): DailySeries {
    const data: DailyDatum[] = values.map((value, i) => ({
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
        value,
    }));
    return { data, valueName: "v", referenceDate: data.length ? data[data.length - 1].date : start };
}
function buildByWeekday(start: Date, n: number, fn: (date: Date) => number | null): DailySeries {
    const values: (number | null)[] = [];
    for (let i = 0; i < n; i++) {
        values.push(fn(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    }
    return buildSeries(start, values);
}

describe("computeWeekdayPatterns — degenerate inputs", () => {
    test("empty series → baseline 0, nothing flagged", () => {
        const p = computeWeekdayPatterns(buildSeries(SUN, []));
        expect(p.baseline).toBe(0);
        expect(p.byWeekday).toEqual([]);
        expect(p.strongest).toBeUndefined();
        expect(p.weakest).toBeUndefined();
    });
    test("equal weekdays → all 7 present, no strongest/weakest (no spread)", () => {
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 14, () => 5));
        expect(p.baseline).toBe(5);
        expect(p.byWeekday).toHaveLength(7);
        expect(p.byWeekday.every(m => m.deltaPct === 0)).toBe(true);
        expect(p.strongest).toBeUndefined();
        expect(p.weakest).toBeUndefined();
    });
    test("baseline 0 (all zeros) → finite deltas, no divide-by-zero", () => {
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 7, () => 0));
        expect(p.baseline).toBe(0);
        expect(p.byWeekday.every(m => Number.isFinite(m.deltaPct) && m.deltaPct === 0)).toBe(true);
    });
});

describe("peaks and troughs", () => {
    test("obvious Friday spike → Friday is strongest, zero volatility there", () => {
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 28, d => (d.getDay() === 5 ? 100 : 10)));
        expect(p.strongest?.weekday).toBe(5);
        expect(p.strongest!.deltaPct).toBeGreaterThan(0);
        expect(p.strongest!.stddev).toBeCloseTo(0, 10); // every Friday identical
        expect(p.weakest?.weekday).not.toBe(5);
    });
    test("obvious Sunday low → Sunday is weakest with a negative delta", () => {
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 28, d => (d.getDay() === 0 ? 1 : 10)));
        expect(p.weakest?.weekday).toBe(0);
        expect(p.weakest!.deltaPct).toBeLessThan(0);
    });
});

describe("gap vs zero", () => {
    test("gaps excluded — a fully-gap weekday is omitted and doesn't move baseline", () => {
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 14, d => (d.getDay() === 0 ? null : 10)));
        expect(p.byWeekday.some(m => m.weekday === 0)).toBe(false);
        expect(p.baseline).toBe(10); // only the 10s are considered
    });
    test("recorded zeros preserved — counted, pull the baseline down, distinct from gaps", () => {
        // Mondays (getDay 1) = 0, everything else = 10
        const p = computeWeekdayPatterns(buildByWeekday(SUN, 14, d => (d.getDay() === 1 ? 0 : 10)));
        const mon = p.byWeekday.find(m => m.weekday === 1)!;
        expect(mon.count).toBe(2);          // two Mondays in 14 days
        expect(mon.mean).toBe(0);
        expect(p.baseline).toBeLessThan(10); // zeros lower it: 120/14 ≈ 8.57
        expect(mon.deltaPct).toBeLessThan(0);
    });
});
