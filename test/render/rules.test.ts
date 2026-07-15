/**
 * Z-146 — rules engine (render/rules.ts). Covers operator semantics, first-match-
 * wins precedence for the color cue, the `between` bounds, compareTo target, and
 * the no-op (back-compat) case where zero rules change nothing.
 */
import { evaluateRules, ruleMatches, matchedRuleName, Rule, RULE_GOOD_COLOR, RULE_BAD_COLOR } from "../../src/render/rules";
import { DayCell } from "../../src/types";

function day(value: number | null, target?: number, noData = false): DayCell {
    return {
        date: new Date(2025, 5, 4), value, target, noData,
        col: 0, row: 0, selectionId: null, sourceIndex: -1,
    } as DayCell;
}

const rule = (p: Partial<Rule>): Rule => ({
    name: "R", operator: ">=", value: 0, compareTo: "value", ...p,
});

describe("ruleMatches — operators", () => {
    it(">= / > / <= / < / ==", () => {
        expect(ruleMatches(day(10), rule({ operator: ">=", value: 10 }))).toBe(true);
        expect(ruleMatches(day(10), rule({ operator: ">", value: 10 }))).toBe(false);
        expect(ruleMatches(day(10), rule({ operator: "<=", value: 10 }))).toBe(true);
        expect(ruleMatches(day(9), rule({ operator: "<", value: 10 }))).toBe(true);
        expect(ruleMatches(day(10), rule({ operator: "==", value: 10 }))).toBe(true);
    });
    it("between is inclusive and order-insensitive", () => {
        const r = rule({ operator: "between", value: 5, value2: 10 });
        expect(ruleMatches(day(5), r)).toBe(true);
        expect(ruleMatches(day(10), r)).toBe(true);
        expect(ruleMatches(day(11), r)).toBe(false);
        expect(ruleMatches(day(7), rule({ operator: "between", value: 10, value2: 5 }))).toBe(true);
    });
    it("compareTo target uses (value − target)", () => {
        // value 8, target 10 → delta −2; rule "< 0" → breach
        expect(ruleMatches(day(8, 10), rule({ operator: "<", value: 0, compareTo: "target" }))).toBe(true);
        expect(ruleMatches(day(12, 10), rule({ operator: "<", value: 0, compareTo: "target" }))).toBe(false);
    });
    it("never matches no-data / null", () => {
        expect(ruleMatches(day(null), rule({ operator: ">=", value: 0 }))).toBe(false);
        expect(ruleMatches(day(5, undefined, true), rule({ operator: ">=", value: 0 }))).toBe(false);
    });
});

describe("evaluateRules — precedence", () => {
    it("first-match-wins for the color cue; first badge shown", () => {
        const rules: Rule[] = [
            rule({ name: "Bad day", operator: ">=", value: 1, color: RULE_BAD_COLOR, badge: "🔻" }),
            rule({ name: "Target breach", operator: ">=", value: 1, color: RULE_GOOD_COLOR, badge: "⚠️" }),
        ];
        const hit = evaluateRules(day(5), rules);
        expect(hit.colorRule?.name).toBe("Bad day");    // earliest cue wins
        expect(hit.badgeRule?.badge).toBe("🔻");        // earliest badge wins
        expect(hit.matched.map(r => r.name)).toEqual(["Bad day", "Target breach"]);
    });
    it("a cue-less (no color/pattern) rule does not claim the cue slot", () => {
        const rules: Rule[] = [
            rule({ name: "Naming only", operator: ">=", value: 1 }),            // no cue
            rule({ name: "Colored", operator: ">=", value: 1, color: RULE_GOOD_COLOR }),
        ];
        const hit = evaluateRules(day(5), rules);
        expect(hit.colorRule?.name).toBe("Colored");
    });
    // CB-04 — the channels are resolved SEPARATELY, so a color-only rule can no
    // longer swallow a lower rule's hatch (that made the "CVD hatch" switch dead).
    it("color and hatch cues can come from different matched rules", () => {
        const hit = evaluateRules(day(5), [
            rule({ name: "Colored", operator: ">=", value: 1, color: RULE_GOOD_COLOR }),
            rule({ name: "Hatched", operator: ">=", value: 1, patternOn: true }),
        ]);
        expect(hit.colorRule?.name).toBe("Colored");
        expect(hit.patternRule?.name).toBe("Hatched");
    });
});

describe("evaluateRules — back-compat no-op", () => {
    it("zero rules → no matches, no cue, no badge", () => {
        const hit = evaluateRules(day(999), []);
        expect(hit.matched).toHaveLength(0);
        expect(hit.colorRule).toBeNull();
        expect(hit.patternRule).toBeNull();
        expect(hit.badgeRule).toBeNull();
        expect(matchedRuleName(day(999), [])).toBeNull();
    });
});
