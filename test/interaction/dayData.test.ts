/**
 * Z-145 — shared day-detail derivations (dayData.ts). These are the SAME
 * functions the hover tooltip and the persistent detail panel both consume, so
 * testing them once covers the reuse contract (no duplicated variance/delta math).
 */
import {
    buildValueByDay, dayKey, dateLabel, dayOverDay, targetVariance, topContributor, formatNum,
} from "../../src/interaction/dayData";
import { CalendarModel, DayCell } from "../../src/types";

function day(partial: Partial<DayCell> & { date: Date }): DayCell {
    return {
        value: null, noData: false, col: 0, row: 0, selectionId: null, sourceIndex: -1,
        ...partial,
    } as DayCell;
}

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("dayData — value map + keys", () => {
    it("indexes only real days, keyed by facet|epoch", () => {
        const model = {
            days: [
                day({ date: D(2025, 6, 3), value: 10 }),
                day({ date: D(2025, 6, 4), value: null, noData: true }),
                day({ date: D(2025, 6, 4), value: 7, facetKey: "West" }),
            ],
        } as CalendarModel;
        const map = buildValueByDay(model);
        expect(map.size).toBe(2);
        expect(map.get(dayKey(model.days[0]))).toBe(10);
        expect(map.get(dayKey(model.days[2]))).toBe(7);
        expect(map.has(dayKey(model.days[1]))).toBe(false);
    });
});

describe("dayData — day-over-day delta", () => {
    it("computes signed diff + pct vs the previous calendar day", () => {
        const prev = day({ date: D(2025, 6, 3), value: 25 });
        const cur = day({ date: D(2025, 6, 4), value: 27 });
        const map = buildValueByDay({ days: [prev, cur] } as CalendarModel);
        const r = dayOverDay(cur, map)!;
        expect(r.up).toBe(true);
        expect(r.diff).toBe(2);
        expect(r.pct).toBe("8.0");
        expect(r.prevWeekday).toBe("Tue");
    });
    it("returns null when there is no prior value", () => {
        const cur = day({ date: D(2025, 6, 4), value: 27 });
        expect(dayOverDay(cur, new Map())).toBeNull();
    });
});

describe("dayData — target variance (token-colored over/under)", () => {
    it("over target", () => {
        const r = targetVariance(day({ date: D(2025, 6, 4), value: 27, target: 25 }))!;
        expect(r.over).toBe(true);
        expect(r.diff).toBe(2);
        expect(r.label).toBe("8.0% over");
    });
    it("under target", () => {
        const r = targetVariance(day({ date: D(2025, 6, 4), value: 20, target: 25 }))!;
        expect(r.over).toBe(false);
        expect(r.label).toBe("20.0% under");
    });
    it("null when no target bound", () => {
        expect(targetVariance(day({ date: D(2025, 6, 4), value: 20 }))).toBeNull();
    });
});

describe("dayData — top contributor (faceted-only, honest omission)", () => {
    const date = D(2025, 6, 4);
    it("returns the max facet + its share for a faceted day", () => {
        const days = [
            day({ date, value: 60, facetKey: "West" }),
            day({ date, value: 30, facetKey: "East" }),
            day({ date, value: 10, facetKey: "North" }),
        ];
        const top = topContributor(days[0], days)!;
        expect(top.category).toBe("West");
        expect(top.share).toBe(60); // 60 / 100
    });
    it("omits the line for non-faceted data", () => {
        const d = day({ date, value: 60 }); // no facetKey
        expect(topContributor(d, [d])).toBeNull();
    });
    it("omits when only one facet shares the date", () => {
        const d = day({ date, value: 60, facetKey: "West" });
        expect(topContributor(d, [d])).toBeNull();
    });
});

describe("dayData — formatting", () => {
    it("dateLabel is uppercase weekday · month day, year", () => {
        expect(dateLabel(D(2025, 6, 4))).toBe("WED · JUN 4, 2025");
    });
    it("formatNum is locale number with ≤2 fraction digits", () => {
        expect(formatNum(1234.5678)).toBe((1234.57).toLocaleString());
    });
});
