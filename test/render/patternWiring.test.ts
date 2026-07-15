/**
 * Z-149 — per-rule + accessibility pattern-style WIRING (settings → engine).
 * Asserts the style threads from each RuleSlot through activeRules() onto the
 * hit's patternRule, the accessibility style picker defaults to diagonal, the per-rule
 * pattern-style dropdown shows only when the rule + its pattern toggle are on,
 * and back-compat (an on pattern toggle with no chosen style → diagonal).
 */
import { VisualFormattingSettingsModel } from "../../src/settings";
import { evaluateRules } from "../../src/render/rules";
import { DayCell } from "../../src/types";

type Badges = VisualFormattingSettingsModel["badges"];

function day(value: number): DayCell {
    return {
        date: new Date(2025, 5, 4), value, noData: false,
        col: 0, row: 0, selectionId: null, sourceIndex: -1,
    } as DayCell;
}

describe("RuleSlot pattern style → activeRules → patternRule", () => {
    it("defaults to diagonal when a rule's pattern toggle is on (back-compat)", () => {
        const m = new VisualFormattingSettingsModel();
        const b: Badges = m.badges;
        b.rule1.on.value = true;
        b.rule1.pattern.value = true; // toggle on, style left at default
        const rules = b.activeRules();
        expect(rules[0].patternOn).toBe(true);
        expect(rules[0].patternStyle).toBe("diagonal");
        const hit = evaluateRules(day(5), rules);
        expect(hit.patternRule?.patternStyle).toBe("diagonal");
    });

    it("threads a chosen style onto the rule (e.g. stars)", () => {
        const m = new VisualFormattingSettingsModel();
        const b: Badges = m.badges;
        b.rule2.on.value = true;
        b.rule2.pattern.value = true;
        b.rule2.patternStyle.value = { value: "stars", displayName: "Stars" };
        const rules = b.activeRules();
        const r = rules.find(x => x.patternStyle === "stars");
        expect(r).toBeTruthy();
        expect(r?.patternOn).toBe(true);
    });

    it("each of the three rule slots carries its own independent style", () => {
        const m = new VisualFormattingSettingsModel();
        const b: Badges = m.badges;
        for (const [slot, style] of [[b.rule1, "dots"], [b.rule2, "grid"], [b.rule3, "crosshatch"]] as const) {
            slot.on.value = true; slot.pattern.value = true;
            slot.patternStyle.value = { value: style, displayName: style };
        }
        const styles = b.activeRules().map(r => r.patternStyle);
        expect(styles).toEqual(["dots", "grid", "crosshatch"]);
    });
});

describe("per-rule pattern-style visibility (onPreProcess)", () => {
    it("style dropdown shows only when rule on AND pattern toggle on", () => {
        const m = new VisualFormattingSettingsModel();
        const b: Badges = m.badges;
        const vis = () => (b.rule1.patternStyle as unknown as { visible?: boolean }).visible;

        b.onPreProcess();
        expect(vis()).toBe(false); // rule off

        b.rule1.on.value = true; b.onPreProcess();
        expect(vis()).toBe(false); // on but pattern toggle off

        b.rule1.pattern.value = true; b.onPreProcess();
        expect(vis()).toBe(true);  // both on
    });
});

describe("accessibility pattern style", () => {
    it("defaults to diagonal and shows only when patternOnThreshold is on", () => {
        const m = new VisualFormattingSettingsModel();
        const a = m.accessibility;
        expect(a.patternStyle.value.value).toBe("diagonal");

        a.onPreProcess();
        expect((a.patternStyle as unknown as { visible?: boolean }).visible).toBe(false);

        a.patternOnThreshold.value = true; a.onPreProcess();
        expect((a.patternStyle as unknown as { visible?: boolean }).visible).toBe(true);
    });
});
