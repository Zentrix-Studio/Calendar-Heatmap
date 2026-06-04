import { computeStreaks } from "../../src/insights/streaks";
import { DailySeries, DailyDatum, InsightConfig, InactiveMeaning } from "../../src/insights/types";

const cfg = (over: Partial<InsightConfig> = {}): InsightConfig => ({
    inactiveMeans: "either", activeThreshold: 0, anomalyMethod: "mad", maxInsights: 3, fiscalStartMonth: 1, polarity: "good", ...over,
});

/** Build a contiguous daily series starting at `start`, one datum per value. */
function series(start: Date, values: (number | null)[], ref?: Date): DailySeries {
    const data: DailyDatum[] = values.map((value, i) => ({
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
        value,
    }));
    const referenceDate = ref ?? (data.length ? data[data.length - 1].date : start);
    return { data, valueName: "v", referenceDate };
}
const jan1 = new Date(2025, 0, 1);

describe("computeStreaks — degenerate inputs never throw", () => {
    test("empty series", () => {
        const s = computeStreaks(series(jan1, []), cfg());
        expect(s.longestActive).toEqual({ length: 0, start: null, end: null });
        expect(s.longestInactive).toEqual({ length: 0, start: null, end: null });
        expect(s.currentActive).toBe(0);
        expect(s.currentInactive).toBe(0);
        expect(s.activeDaysPct).toBe(0);
    });
    test("all active", () => {
        const s = computeStreaks(series(jan1, [3, 3, 3, 3]), cfg());
        expect(s.longestActive.length).toBe(4);
        expect(s.longestActive.start).toEqual(new Date(2025, 0, 1));
        expect(s.longestActive.end).toEqual(new Date(2025, 0, 4));
        expect(s.currentActive).toBe(4);
        expect(s.currentInactive).toBe(0);
        expect(s.activeDaysPct).toBe(1);
    });
    test("all inactive (zeros, either policy)", () => {
        const s = computeStreaks(series(jan1, [0, 0, 0]), cfg());
        expect(s.longestInactive.length).toBe(3);
        expect(s.currentInactive).toBe(3);
        expect(s.activeDaysPct).toBe(0);
    });
});

describe("gaps-only depends on policy", () => {
    test("either → gaps are one inactive streak", () => {
        const s = computeStreaks(series(jan1, [null, null, null]), cfg({ inactiveMeans: "either" }));
        expect(s.longestInactive.length).toBe(3);
    });
    test("zero → gaps ignored, no inactive streak", () => {
        const s = computeStreaks(series(jan1, [null, null, null]), cfg({ inactiveMeans: "zero" }));
        expect(s.longestInactive.length).toBe(0);
        expect(s.currentInactive).toBe(0);
        expect(s.inactiveDays).toBe(0);
    });
});

describe("gap-vs-zero matrix — ignored days break the inactive run", () => {
    // [0, gap, 0] — middle day's treatment flips the run length by policy.
    const values: (number | null)[] = [0, null, 0];
    const cases: [InactiveMeaning, number][] = [
        ["either", 3], // 0,gap,0 all inactive → one run of 3
        ["zero", 1],   // 0,ignore,0 → two runs of 1
        ["gap", 1],    // ignore,gap,ignore → single inactive in the middle
    ];
    test.each(cases)("inactiveMeans=%s → longest inactive %i", (mode, expected) => {
        const s = computeStreaks(series(jan1, values), cfg({ inactiveMeans: mode }));
        expect(s.longestInactive.length).toBe(expected);
    });
});

describe("current streak anchoring on referenceDate", () => {
    test("ends exactly on referenceDate inside the range", () => {
        // [3,3,0,3,3], ref = the middle zero → current is inactive of 1, not active
        const s = computeStreaks(series(jan1, [3, 3, 0, 3, 3], new Date(2025, 0, 3)), cfg());
        expect(s.currentInactive).toBe(1);
        expect(s.currentActive).toBe(0);
    });
    test("referenceDate inside a gap (either) counts the gap as the current inactive streak", () => {
        const s = computeStreaks(series(jan1, [3, null, null]), cfg({ inactiveMeans: "either" }));
        expect(s.currentInactive).toBe(2);
        expect(s.currentActive).toBe(0);
    });
    test("referenceDate inside a gap (zero policy) → current streak 0 both ways", () => {
        const s = computeStreaks(series(jan1, [3, null, null]), cfg({ inactiveMeans: "zero" }));
        expect(s.currentInactive).toBe(0);
        expect(s.currentActive).toBe(0);
    });
    test("referenceDate past the data anchors at the last available day (data lag)", () => {
        const s = computeStreaks(series(jan1, [3, 3], new Date(2025, 0, 31)), cfg());
        expect(s.currentActive).toBe(2);
    });
    test("referenceDate before all data → current streak 0", () => {
        const s = computeStreaks(series(jan1, [3, 3], new Date(2024, 11, 1)), cfg());
        expect(s.currentActive).toBe(0);
        expect(s.currentInactive).toBe(0);
    });
});

describe("activeDaysPct and counts", () => {
    test("mixed series → 3/4 active", () => {
        const s = computeStreaks(series(jan1, [3, 0, 3, 3]), cfg());
        expect(s.activeDays).toBe(3);
        expect(s.inactiveDays).toBe(1);
        expect(s.activeDaysPct).toBeCloseTo(0.75, 10);
    });
});

describe("multi-year continuity — streaks do not reset at the year boundary", () => {
    test("an active run spanning Dec→Jan is counted whole", () => {
        // start Dec 30 2024, 5 active days → crosses into Jan 3 2025
        const s = computeStreaks(series(new Date(2024, 11, 30), [4, 4, 4, 4, 4]), cfg());
        expect(s.longestActive.length).toBe(5);
        expect(s.longestActive.start).toEqual(new Date(2024, 11, 30));
        expect(s.longestActive.end).toEqual(new Date(2025, 0, 3));
    });
});
