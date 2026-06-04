import { extractSeries } from "../../src/insights/series";
import { enumerateDays } from "../../src/model/dateGrid";

/** Build an aggregated-by-day map keyed the way the data pipeline keys it. */
function aggMap(entries: [Date, number][]): Map<number, number> {
    const m = new Map<number, number>();
    for (const [d, v] of entries) m.set(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), v);
    return m;
}

const ref = new Date(2025, 11, 31);

describe("extractSeries — full pre-cap series with gaps as null", () => {
    test("covers the whole extent; mapped days carry values, others are null", () => {
        const min = new Date(2025, 0, 1), max = new Date(2025, 0, 5);
        const series = extractSeries({
            aggregatedByDay: aggMap([[new Date(2025, 0, 1), 5], [new Date(2025, 0, 4), 8]]),
            min, max, valueName: "Tickets", referenceDate: ref,
        });
        expect(series.data).toHaveLength(5);
        expect(series.data.map(d => d.value)).toEqual([5, null, null, 8, null]);
        expect(series.valueName).toBe("Tickets");
        expect(series.referenceDate).toBe(ref);
    });

    test("length always equals enumerateDays over [min,max] (no cap applied)", () => {
        const min = new Date(2019, 0, 1), max = new Date(2025, 11, 31); // 7 years > render cap
        const series = extractSeries({ aggregatedByDay: aggMap([]), min, max, valueName: "v", referenceDate: ref });
        expect(series.data.length).toBe(enumerateDays(min, max).length);
        expect(series.data.length).toBeGreaterThan(2200); // proves no 2,200 render cap leaked in
    });

    test("all-gap range → every value null, dates still contiguous", () => {
        const min = new Date(2025, 2, 1), max = new Date(2025, 2, 3);
        const series = extractSeries({ aggregatedByDay: aggMap([]), min, max, valueName: "v", referenceDate: ref });
        expect(series.data.every(d => d.value === null)).toBe(true);
        expect(series.data.map(d => d.date.getDate())).toEqual([1, 2, 3]);
    });

    test("single-day extent yields one datum", () => {
        const d = new Date(2025, 5, 15);
        const series = extractSeries({ aggregatedByDay: aggMap([[d, 3]]), min: d, max: d, valueName: "v", referenceDate: ref });
        expect(series.data).toHaveLength(1);
        expect(series.data[0].value).toBe(3);
    });

    test("a recorded 0 is preserved, distinct from a gap", () => {
        const min = new Date(2025, 0, 1), max = new Date(2025, 0, 2);
        const series = extractSeries({
            aggregatedByDay: aggMap([[new Date(2025, 0, 1), 0]]), // day 1 = real 0, day 2 = gap
            min, max, valueName: "v", referenceDate: ref,
        });
        expect(series.data[0].value).toBe(0);
        expect(series.data[1].value).toBeNull();
    });
});
