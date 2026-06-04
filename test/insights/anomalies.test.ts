import { computeAnomalies } from "../../src/insights/anomalies";
import { DailySeries, DailyDatum } from "../../src/insights/types";

const start = new Date(2025, 0, 1);
function buildSeries(values: (number | null)[]): DailySeries {
    const data: DailyDatum[] = values.map((value, i) => ({
        date: new Date(2025, 0, 1 + i),
        value,
    }));
    return { data, valueName: "v", referenceDate: data.length ? data[data.length - 1].date : start };
}
const dayOf = (i: number) => new Date(2025, 0, 1 + i);

describe("computeAnomalies — degenerate inputs", () => {
    test("empty series → nothing", () => {
        const a = computeAnomalies(buildSeries([]));
        expect(a.anomalies).toEqual([]);
        expect(a.strongest).toBeUndefined();
        expect(a.countModerate + a.countStrong).toBe(0);
    });
    test("single value → no spread, no anomaly", () => {
        const a = computeAnomalies(buildSeries([42]));
        expect(a.anomalies).toEqual([]);
    });
    test("all identical → no spread, no anomaly", () => {
        const a = computeAnomalies(buildSeries([7, 7, 7, 7, 7]));
        expect(a.anomalies).toEqual([]);
    });
});

describe("detection via robust MAD", () => {
    test("normal cluster + one spike → flags the spike as a strong high anomaly", () => {
        const a = computeAnomalies(buildSeries([10, 11, 9, 10, 12, 8, 10, 100]));
        expect(a.method).toBe("mad");
        expect(a.strongest?.value).toBe(100);
        expect(a.strongest?.direction).toBe("high");
        expect(a.strongest?.severity).toBe("strong");
        expect(a.strongest?.date).toEqual(dayOf(7));
    });
    test("negative deviation → flags a low anomaly", () => {
        const a = computeAnomalies(buildSeries([12, 8, 11, 9, 10, 13, 7, -50]));
        expect(a.method).toBe("mad");
        expect(a.strongest?.value).toBe(-50);
        expect(a.strongest?.direction).toBe("low");
        expect(a.strongest!.score).toBeLessThan(0);
    });
    test("multiple anomalies sorted by |score| descending", () => {
        const a = computeAnomalies(buildSeries([9, 10, 11, 8, 12, 10, 40, 80]));
        expect(a.anomalies.length).toBeGreaterThanOrEqual(2);
        const absScores = a.anomalies.map(p => Math.abs(p.score));
        expect(absScores).toEqual([...absScores].sort((x, y) => y - x)); // already descending
        expect(a.anomalies[0].value).toBe(80); // bigger spike ranks first
    });
});

describe("MAD-collapse fallback", () => {
    test(">50% identical values → uses MeanAD and still finds the outlier", () => {
        const a = computeAnomalies(buildSeries([5, 5, 5, 5, 5, 5, 5, 100]));
        expect(a.method).toBe("meanad");
        expect(a.strongest?.value).toBe(100);
        expect(a.strongest?.severity).toBe("strong");
        expect(a.countStrong).toBe(1);
    });
});

describe("gap vs zero", () => {
    test("gaps ignored — nulls never appear as anomalies", () => {
        const a = computeAnomalies(buildSeries([10, null, 11, 9, 10, 12, 8, null, 100]));
        expect(a.anomalies.every(p => p.value !== null)).toBe(true);
        expect(a.strongest?.value).toBe(100);
    });
    test("recorded zero retained — a 0 amid a high baseline is a low anomaly", () => {
        const a = computeAnomalies(buildSeries([100, 98, 102, 99, 101, 103, 97, 0]));
        expect(a.strongest?.value).toBe(0);
        expect(a.strongest?.direction).toBe("low");
    });
});
