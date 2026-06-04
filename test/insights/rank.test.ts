import { scoreInsight, rankInsights } from "../../src/insights/rank";
import { Insight } from "../../src/insights/types";

const insight = (id: string, score: number): Insight => ({
    id, kind: "streak", title: id, body: id, score, importance: "medium", confidence: "high", tone: "neutral",
});

describe("scoreInsight", () => {
    test("importance dominates kind and magnitude", () => {
        // a low-importance anomaly with max magnitude must rank below any medium insight
        expect(scoreInsight("anomaly", "low", 9.99)).toBeLessThan(scoreInsight("weekday", "medium", 0));
    });
    test("at equal importance, anomaly edges out streak edges out weekday", () => {
        const a = scoreInsight("anomaly", "high", 0);
        const s = scoreInsight("streak", "high", 0);
        const w = scoreInsight("weekday", "high", 0);
        expect(a).toBeGreaterThan(s);
        expect(s).toBeGreaterThan(w);
    });
    test("magnitude only breaks ties within a tier (clamped < 10)", () => {
        const lo = scoreInsight("streak", "high", 1);
        const hi = scoreInsight("streak", "high", 1000);
        expect(hi).toBeGreaterThan(lo);
        expect(hi - lo).toBeLessThan(10);
    });
});

describe("rankInsights", () => {
    test("sorts by score desc and slices to topN", () => {
        const ranked = rankInsights([insight("a", 100), insight("b", 300), insight("c", 200)], 2);
        expect(ranked.map(i => i.id)).toEqual(["b", "c"]);
    });
    test("ties broken deterministically by id", () => {
        const r1 = rankInsights([insight("z", 200), insight("a", 200)], 5);
        const r2 = rankInsights([insight("a", 200), insight("z", 200)], 5);
        expect(r1.map(i => i.id)).toEqual(["a", "z"]);
        expect(r2.map(i => i.id)).toEqual(["a", "z"]); // order-independent → deterministic
    });
});
