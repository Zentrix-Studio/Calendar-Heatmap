import { narrateWeekday, narrateAnomalies, narrateStreaks, generateInsights } from "../../src/insights/narratives";
import { StreakSummary } from "../../src/insights/streaks";
import { computeInsights } from "../../src/insights/index";
import { WeekdayPatterns, WeekdayMetric } from "../../src/insights/weekdayPatterns";
import { AnomalySummary } from "../../src/insights/anomalies";
import { DailySeries, DailyDatum } from "../../src/insights/types";

const CAUSAL = /\bcaused by\b|\bbecause\b|\bdue to\b|\bleads? to\b|\bresults? in\b/i;

// 2025-01-05 is a Sunday — anchor for weekday-driven series.
const SUN = new Date(2025, 0, 5);
function buildSeries(start: Date, values: (number | null)[]): DailySeries {
    const data: DailyDatum[] = values.map((value, i) => ({
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
        value,
    }));
    return { data, valueName: "Tickets", referenceDate: data.length ? data[data.length - 1].date : start };
}
function buildByWeekday(start: Date, n: number, fn: (d: Date) => number | null): DailySeries {
    const values: (number | null)[] = [];
    for (let i = 0; i < n; i++) values.push(fn(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
    return buildSeries(start, values);
}
const wd = (over: Partial<WeekdayMetric>): WeekdayMetric =>
    ({ weekday: 5, mean: 100, deltaPct: 0.2, count: 4, stddev: 0, ...over });

describe("weekday escalation is gated on support", () => {
    test("stable weekday (low volatility) escalates to 'consistently … repeatable'", () => {
        const strongest = wd({ stddev: 0 });
        const patterns: WeekdayPatterns = { baseline: 80, byWeekday: [strongest], strongest, weakest: undefined };
        const [insight] = narrateWeekday(patterns);
        expect(insight.body).toMatch(/consistently/);
        expect(insight.body).toMatch(/repeatable weekly pattern/);
        expect(insight.confidence).toBe("high");
    });
    test("volatile weekday (same delta, high stddev) stays descriptive", () => {
        const strongest = wd({ stddev: 90 }); // cv = 0.9 > 0.5
        const patterns: WeekdayPatterns = { baseline: 80, byWeekday: [strongest], strongest, weakest: undefined };
        const [insight] = narrateWeekday(patterns);
        expect(insight.body).not.toMatch(/consistently/);
        expect(insight.confidence).not.toBe("high");
        expect(insight.body).toMatch(/averaged 20% above baseline/);
    });
});

describe("anomaly narration", () => {
    const top = { date: new Date(2025, 7, 18), value: 42, score: 4.1, direction: "high" as const, severity: "strong" as const };
    const summary: AnomalySummary = { anomalies: [top], strongest: top, countModerate: 0, countStrong: 1, method: "mad" };

    test("plain language — no raw z in the body, no causal language", () => {
        const [insight] = narrateAnomalies(summary);
        expect(insight.body).toMatch(/Aug 18 stood out at 42 — well above a typical day\./);
        expect(insight.body).not.toMatch(/modified-z|z \d/); // raw stat stays in detail/tooltip
        expect(insight.body).not.toMatch(CAUSAL);
        expect(insight.importance).toBe("high");
        expect(insight.detail!.z).toBe(4.1); // z retained for the tooltip
    });
    test("polarity flips tone: a high outlier is positive when higher=good, negative when higher=bad", () => {
        expect(narrateAnomalies(summary, "good")[0].tone).toBe("positive");
        expect(narrateAnomalies(summary, "bad")[0].tone).toBe("negative");
        expect(narrateAnomalies(summary, "neutral")[0].tone).toBe("neutral");
    });
    test("multi-year stamps the year on the anomaly date (disambiguates which Aug 18)", () => {
        expect(narrateAnomalies(summary, "neutral", true)[0].body).toMatch(/Aug 18 2025 stood out/);
        expect(narrateAnomalies(summary, "neutral", true)[0].detail!.date).toBe("Aug 18 2025");
        expect(narrateAnomalies(summary, "neutral", false)[0].body).not.toMatch(/2025/);
    });
});

describe("streak polarity", () => {
    // 8-day inactive streak (e.g. 8 days with zero SLA breaches).
    const s: StreakSummary = {
        longestActive: { length: 0, start: null, end: null },
        longestInactive: { length: 8, start: new Date(2025, 1, 27), end: new Date(2025, 2, 5) },
        currentActive: 0, currentInactive: 0, activeDays: 2, inactiveDays: 8, activeDaysPct: 0.2,
    };
    test("an inactive streak is negative when higher=good, but positive when higher=bad (zero breaches = good)", () => {
        expect(narrateStreaks(s, "good").find(i => i.id === "streak-inactive-longest")!.tone).toBe("negative");
        expect(narrateStreaks(s, "bad").find(i => i.id === "streak-inactive-longest")!.tone).toBe("positive");
    });
    test("multi-year stamps the year on the streak range; single-year stays year-free", () => {
        const body = (yr: boolean) => narrateStreaks(s, "neutral", yr).find(i => i.id === "streak-inactive-longest")!.body;
        expect(body(true)).toMatch(/\(Feb 27–Mar 5 2025\)/);
        expect(body(false)).toMatch(/\(Feb 27–Mar 5\)/);
        expect(body(false)).not.toMatch(/2025/);
    });
});

describe("ranking across kinds", () => {
    test("a strong anomaly outranks a strong weekday pattern", () => {
        const strongest = wd({ deltaPct: 0.25, stddev: 0 });
        const weekdays: WeekdayPatterns = { baseline: 80, byWeekday: [strongest], strongest, weakest: undefined };
        const top = { date: new Date(2025, 7, 18), value: 999, score: 6, direction: "high" as const, severity: "strong" as const };
        const anomalies: AnomalySummary = { anomalies: [top], strongest: top, countModerate: 0, countStrong: 1, method: "mad" };
        const ranked = generateInsights({ valueName: "Tickets", weekdays, anomalies })
            .sort((a, b) => b.score - a.score);
        expect(ranked[0].kind).toBe("anomaly");
    });
});

describe("integration via computeInsights", () => {
    test("flat constant series yields only low-value insight (no anomaly/weekday, none high)", () => {
        const insights = computeInsights(buildSeries(SUN, new Array(14).fill(5)));
        expect(insights.some(i => i.kind === "anomaly")).toBe(false);
        expect(insights.some(i => i.kind === "weekday")).toBe(false);
        expect(insights.every(i => i.importance !== "high")).toBe(true);
    });

    test("rich series produces ranked top-3 with no causal language; ranking is deterministic", () => {
        // Friday spikes (100 vs 10), one extreme outlier, and an 11-day zero run.
        const series = buildByWeekday(SUN, 56, d => (d.getDay() === 5 ? 100 : 10));
        series.data[30].value = 1000;                         // strong anomaly
        for (let i = 40; i <= 50; i++) series.data[i].value = 0; // inactive run

        const a = computeInsights(series, undefined, 3);
        const b = computeInsights(series, undefined, 3);
        expect(a).toHaveLength(3);
        expect(a.map(i => i.id)).toEqual(b.map(i => i.id)); // deterministic
        for (const i of a) {
            expect(i.body).not.toMatch(CAUSAL);
            expect(i.score).toBeGreaterThan(0);
        }
        // the extreme spike should surface as the (or a) top insight
        expect(a.some(i => i.kind === "anomaly")).toBe(true);
    });

    test("a 2-year series stamps the year on dated insights; a 1-year series does not", () => {
        const spike = (n: number, at: number) => { const v = new Array(n).fill(10); v[at] = 5000; return v; };
        // ~10 months, all within 2025 → single year → no year on any insight.
        const single = computeInsights(buildSeries(new Date(2025, 0, 1), spike(300, 100)));
        expect(single.some(i => /\b20\d{2}\b/.test(i.body))).toBe(false);
        // ~14 months from mid-2024 into 2025 → multi-year → the anomaly date carries its year.
        const multi = computeInsights(buildSeries(new Date(2024, 5, 1), spike(430, 200)));
        const anomaly = multi.find(i => i.kind === "anomaly");
        expect(anomaly).toBeDefined();
        expect(anomaly!.body).toMatch(/\b20\d{2}\b/);
    });
});
