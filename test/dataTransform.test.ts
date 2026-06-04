import { normalizeToLocalDay, aggregateByDay } from "../src/model/dataTransform";

describe("normalizeToLocalDay", () => {
    test("strips the time component to local midnight", () => {
        const d = normalizeToLocalDay(new Date(2025, 4, 18, 14, 30, 0))!;
        expect(d.getHours()).toBe(0);
        expect(d.getMinutes()).toBe(0);
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 4, 18]);
    });

    test("accepts epoch milliseconds", () => {
        const ms = new Date(2025, 0, 1, 9).getTime();
        const d = normalizeToLocalDay(ms)!;
        expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2025, 0, 1]);
    });

    test("returns null for null / invalid input", () => {
        expect(normalizeToLocalDay(null)).toBeNull();
        expect(normalizeToLocalDay("not-a-date")).toBeNull();
    });
});

describe("aggregateByDay", () => {
    const day = (m: number, d: number) => new Date(2025, m, d);

    test("sum collapses duplicate days", () => {
        const dates = [day(0, 1), day(0, 1), day(0, 2)];
        const out = aggregateByDay(dates, [3, 4, 10], "sum");
        expect(out.get(day(0, 1).getTime())!.value).toBe(7);
        expect(out.get(day(0, 2).getTime())!.value).toBe(10);
    });

    test("avg / min / max / count modes", () => {
        const dates = [day(0, 1), day(0, 1), day(0, 1)];
        const vals = [2, 4, 6];
        expect(aggregateByDay(dates, vals, "avg").get(day(0, 1).getTime())!.value).toBe(4);
        expect(aggregateByDay(dates, vals, "min").get(day(0, 1).getTime())!.value).toBe(2);
        expect(aggregateByDay(dates, vals, "max").get(day(0, 1).getTime())!.value).toBe(6);
        expect(aggregateByDay(dates, vals, "count").get(day(0, 1).getTime())!.value).toBe(3);
    });

    test("skips null/NaN values but records the first real index", () => {
        const dates = [day(0, 1), day(0, 1), day(0, 1)];
        const out = aggregateByDay(dates, [NaN as number, 5, 7], "sum");
        const bucket = out.get(day(0, 1).getTime())!;
        expect(bucket.value).toBe(12);
        expect(bucket.firstIndex).toBe(1); // index 0 was NaN
    });

    test("a day with only null values produces no bucket", () => {
        const dates = [day(0, 1)];
        const out = aggregateByDay(dates, [NaN as number], "sum");
        expect(out.has(day(0, 1).getTime())).toBe(false);
    });
});
