import {
    mean, median, quantile, stddev, mad, meanAbsDev, modifiedZ,
    nonNullValues, groupByWeekday, classifyDay, longestRun,
} from "../../src/insights/stats";
import { DailyDatum, InsightConfig } from "../../src/insights/types";

const cfg = (over: Partial<InsightConfig> = {}): InsightConfig => ({
    inactiveMeans: "either", activeThreshold: 0, anomalyMethod: "mad", maxInsights: 3, fiscalStartMonth: 1, polarity: "good", ...over,
});
const day = (y: number, m: number, d: number, value: number | null): DailyDatum =>
    ({ date: new Date(y, m, d), value });

describe("central tendency", () => {
    test("mean / median basic", () => {
        expect(mean([1, 2, 3])).toBe(2);
        expect(median([3, 1, 2])).toBe(2);          // odd
        expect(median([1, 2, 3, 4])).toBe(2.5);     // even, interpolated
    });
    test("empty → NaN (never throws)", () => {
        expect(mean([])).toBeNaN();
        expect(median([])).toBeNaN();
        expect(mad([])).toBeNaN();
        expect(stddev([])).toBeNaN();
        expect(quantile([], 0.5)).toBeNaN();
    });
    test("quantile interpolates and hits exact endpoints", () => {
        expect(quantile([0, 10], 0)).toBe(0);
        expect(quantile([0, 10], 1)).toBe(10);
        expect(quantile([0, 10], 0.5)).toBe(5);
        expect(quantile([42], 0.9)).toBe(42);
    });
    test("population stddev", () => {
        // values [2,4,4,4,5,5,7,9] → mean 5, popvar 4 → sd 2
        expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10);
    });
});

describe("robust stats (median + MAD)", () => {
    test("mad of a symmetric set", () => {
        // [1,2,3,4,5] median 3, |dev|=[2,1,0,1,2] median 1
        expect(mad([1, 2, 3, 4, 5])).toBe(1);
    });
    test("modifiedZ flags a skewed-tail outlier but not the body", () => {
        const xs = [1, 2, 3, 4, 5, 100];
        const med = median(xs), m = mad(xs);
        expect(Math.abs(modifiedZ(100, med, m))).toBeGreaterThan(3.5); // strong outlier
        expect(Math.abs(modifiedZ(3, med, m))).toBeLessThan(3.5);      // body day
    });
    test("modifiedZ returns 0 when MAD collapses (>50% identical)", () => {
        const xs = [1, 1, 1, 1, 10];
        expect(mad(xs)).toBe(0);
        expect(modifiedZ(10, median(xs), mad(xs))).toBe(0); // anomaly layer applies MeanAD fallback
    });
    test("meanAbsDev: mean of |x − median|, and survives MAD-collapse data", () => {
        expect(meanAbsDev([1, 2, 3, 4, 5])).toBeCloseTo(1.2, 10); // |dev| [2,1,0,1,2]/5
        expect(meanAbsDev([])).toBeNaN();
        const collapsed = [5, 5, 5, 5, 5, 100];
        expect(mad(collapsed)).toBe(0);                 // MAD degenerates
        expect(meanAbsDev(collapsed)).toBeGreaterThan(0); // MeanAD still has signal
    });
});

describe("series utilities", () => {
    const series: DailyDatum[] = [
        day(2025, 0, 1, 5), day(2025, 0, 2, null), day(2025, 0, 3, 0), day(2025, 0, 4, 8),
    ];
    test("nonNullValues drops gaps, keeps real zeros", () => {
        expect(nonNullValues(series)).toEqual([5, 0, 8]);
    });
    test("groupByWeekday buckets by Date.getDay(), skipping gaps", () => {
        const buckets = groupByWeekday(series);
        expect(buckets).toHaveLength(7);
        const total = buckets.reduce((n, b) => n + b.length, 0);
        expect(total).toBe(3);                       // the gap is excluded
        // 2025-01-01 is a Wednesday (getDay 3)
        expect(buckets[3]).toContain(5);
    });
});

describe("classifyDay — the gap-vs-zero fork", () => {
    const active = day(2025, 0, 1, 7);
    const zero = day(2025, 0, 1, 0);
    const gap = day(2025, 0, 1, null);

    test("active is active under every policy", () => {
        for (const m of ["zero", "gap", "either"] as const) {
            expect(classifyDay(active, cfg({ inactiveMeans: m }))).toBe("active");
        }
    });
    test("zero policy: recorded 0 inactive, gap ignored", () => {
        expect(classifyDay(zero, cfg({ inactiveMeans: "zero" }))).toBe("inactive");
        expect(classifyDay(gap, cfg({ inactiveMeans: "zero" }))).toBe("ignore");
    });
    test("gap policy: gap inactive, recorded 0 ignored", () => {
        expect(classifyDay(gap, cfg({ inactiveMeans: "gap" }))).toBe("inactive");
        expect(classifyDay(zero, cfg({ inactiveMeans: "gap" }))).toBe("ignore");
    });
    test("either policy: both inactive", () => {
        expect(classifyDay(gap, cfg({ inactiveMeans: "either" }))).toBe("inactive");
        expect(classifyDay(zero, cfg({ inactiveMeans: "either" }))).toBe("inactive");
    });
    test("activeThreshold raises the active bar", () => {
        expect(classifyDay(day(2025, 0, 1, 3), cfg({ activeThreshold: 5 }))).toBe("inactive");
    });
});

describe("longestRun", () => {
    test("finds the longest true-run and its start", () => {
        expect(longestRun([false, true, true, false, true])).toEqual({ start: 1, length: 2 });
    });
    test("all false → none", () => {
        expect(longestRun([false, false])).toEqual({ start: -1, length: 0 });
    });
    test("all true → whole array", () => {
        expect(longestRun([true, true, true])).toEqual({ start: 0, length: 3 });
    });
    test("empty → none", () => {
        expect(longestRun([])).toEqual({ start: -1, length: 0 });
    });
});
