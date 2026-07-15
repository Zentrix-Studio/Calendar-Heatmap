/**
 * @jest-environment jsdom
 *
 * Day-badges regression net (Elements → Day badges). Each test pins a defect found
 * in the CB-* audit and is named for its ledger ID — see docs/CHANGE-LEDGER.md.
 * These exist so a later change to the badge path cannot silently reintroduce one
 * of them; if you are here because a test failed, read the ledger entry first.
 *
 *   CB-01  Peak emoji field must be hidden while "Mark peak" is off
 *   CB-02  at most ONE badge per cell (peak / rule / threshold must not stack)
 *   CB-03  the threshold stepper must reach values a real measure can take
 *   CB-04  a rule's CVD hatch must draw even when an earlier rule owns the color
 */
import "../harness/svgPolyfill";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView } from "../harness/mockDataView";
import { SB_CATS, applyLocal, readLocal } from "../../src/interaction/settingsSchema";
import { evaluateRules, Rule } from "../../src/render/rules";
import { DayCell } from "../../src/types";

const VIEWPORT = { width: 1500, height: 420 };

beforeAll(() => {
    (globalThis as any).ResizeObserver = class {
        observe(): void { /* no-op */ } unobserve(): void { /* no-op */ } disconnect(): void { /* no-op */ }
    };
});
afterEach(() => { document.body.replaceChildren(); });

interface Mounted { el: HTMLDivElement; host: MockHost; visual: Visual; }
function mount(): Mounted {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    (host as any).persistProperties = () => { /* swallow */ };
    return { el, host, visual: new Visual({ element: el, host } as any) };
}

const dv = buildDataView({ year: 2025, withTarget: true });

function render(m: Mounted) {
    m.host.__lastFailure = undefined;
    m.visual.update({ dataViews: [dv], viewport: VIEWPORT, type: 2 } as any);
}

/** Drive the gear exactly as the settings bar does: mutate locally, then repaint. */
function gear(m: Mounted, kv: Record<string, unknown>) {
    const model: any = (m.visual as any).formattingSettings;
    for (const [k, v] of Object.entries(kv)) applyLocal(model, k, v);
    (m.visual as any).rerenderFromSettings();
}

const badgeLayer = (el: HTMLElement) =>
    el.querySelector("svg.zentrix-heatmap g.badges") as SVGGElement;

/** Emoji badges grouped by the cell centre they are drawn on. */
function badgesByPosition(el: HTMLElement): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const t of badgeLayer(el).querySelectorAll("text")) {
        const k = `${t.getAttribute("x")},${t.getAttribute("y")}`;
        out.set(k, [...(out.get(k) ?? []), t.textContent ?? ""]);
    }
    return out;
}
const allBadges = (el: HTMLElement) =>
    [...badgeLayer(el).querySelectorAll("text")].map(t => t.textContent ?? "");
const hatchedCells = (el: HTMLElement) =>
    [...badgeLayer(el).querySelectorAll("rect")]
        .map(r => r.getAttribute("fill") ?? "")
        .filter(f => f.startsWith("url(#zx-pat-"));

const badgesPane = () =>
    (SB_CATS.find(c => c.id === "elements")!.subs.find((s: any) => s.id === "badges") as any);
const paneField = (key: string) =>
    badgesPane().fields.find((f: any) => f.key === key);

/** Is `key` visible in the gear given the current model state? */
function isVisible(m: Mounted, key: string): boolean {
    const model: any = (m.visual as any).formattingSettings;
    const f = paneField(key);
    return f.visibleIf ? Boolean(f.visibleIf((k: string) => readLocal(model, k))) : true;
}

// ── CB-01 ────────────────────────────────────────────────────────────────────
describe("CB-01 — peak emoji is gated on its own toggle", () => {
    test("hidden while Mark peak is off, shown once it is on", () => {
        const m = mount(); render(m);
        expect(isVisible(m, "badge.peakEmoji")).toBe(false);
        gear(m, { "badge.peakOn": true });
        expect(isVisible(m, "badge.peakEmoji")).toBe(true);
    });

    test("every sub-field of a badge source is gated on that source's toggle", () => {
        // Guards the whole pane, not just the one field that regressed: a sub-field
        // with no visibleIf lets an author configure a source that is switched off.
        const m = mount(); render(m);
        for (const key of ["badge.peakEmoji", "badge.thresholdValue", "badge.thresholdEmoji"]) {
            expect(paneField(key).visibleIf).toBeDefined();
            expect(isVisible(m, key)).toBe(false);
        }
    });
});

// ── CB-02 ────────────────────────────────────────────────────────────────────
describe("CB-02 — one badge per cell", () => {
    test("peak + threshold + rule all matching one day draws a single emoji", () => {
        const m = mount(); render(m);
        gear(m, {
            "badge.peakOn": true, "badge.thresholdOn": true, "badge.thresholdValue": 50,
            "rule1.on": true, "rule1.value": 50, "rule1.badge": "⭐",
        });
        const stacked = [...badgesByPosition(m.el).values()].filter(v => v.length > 1);
        expect(stacked).toEqual([]);
    });

    test("peak wins over the rule and the threshold on the day it lands on", () => {
        const m = mount(); render(m);
        gear(m, {
            "badge.peakOn": true, "badge.peakEmoji": "🔥",
            "badge.thresholdOn": true, "badge.thresholdValue": 50, "badge.thresholdEmoji": "⚠️",
            "rule1.on": true, "rule1.value": 50, "rule1.badge": "⭐",
        });
        // The peak day satisfies all three; exactly one 🔥 survives, and it is not
        // buried under the rule/threshold glyph.
        expect(allBadges(m.el).filter(e => e === "🔥")).toHaveLength(1);
    });

    test("a rule badge supersedes the legacy threshold badge on a shared day", () => {
        const m = mount(); render(m);
        gear(m, {
            "badge.thresholdOn": true, "badge.thresholdValue": 100, "badge.thresholdEmoji": "⚠️",
            "rule1.on": true, "rule1.value": 100, "rule1.badge": "⭐",
        });
        const badges = allBadges(m.el);
        // Same predicate (≥100) from both sources → every such day shows the rule's
        // badge only. A ⚠️ here means the two sources are double-drawing again.
        expect(badges.filter(e => e === "⚠️")).toHaveLength(0);
        expect(badges.filter(e => e === "⭐").length).toBeGreaterThan(0);
    });

    test("the legacy threshold still badges on its own (back-compat)", () => {
        const m = mount(); render(m);
        gear(m, { "badge.thresholdOn": true, "badge.thresholdValue": 100 });
        expect(allBadges(m.el).filter(e => e === "⚠️").length).toBeGreaterThan(0);
    });
});

// ── CB-03 ────────────────────────────────────────────────────────────────────
describe("CB-03 — threshold stepper spans a real measure's range", () => {
    test("bounds are not narrower than the rule steppers", () => {
        // The badges card is gear-only (not in PANE_CARDS), so a clamped stepper is
        // the ONLY way to set this — there is no native-pane escape hatch.
        const f = paneField("badge.thresholdValue");
        expect(f.min).toBeLessThanOrEqual(-1e9);
        expect(f.max).toBeGreaterThanOrEqual(1e9);
    });

    test("a threshold above the old 200 cap badges the right days", () => {
        const m = mount(); render(m);
        gear(m, { "badge.thresholdOn": true, "badge.thresholdValue": 300 });
        const hi = allBadges(m.el).length;
        gear(m, { "badge.thresholdValue": 100 });
        expect(allBadges(m.el).length).toBeGreaterThan(hi); // a lower bar badges more days
        expect(hi).toBeGreaterThan(0);                      // …and 300 is reachable at all
    });
});

// ── CB-04 ────────────────────────────────────────────────────────────────────
describe("CB-04 — cue channels resolve independently", () => {
    const day = (value: number): DayCell => ({
        date: new Date(2025, 5, 4), value, noData: false,
        col: 0, row: 0, selectionId: null, sourceIndex: -1,
    } as DayCell);
    const rule = (p: Partial<Rule>): Rule => ({ name: "R", operator: ">=", value: 0, compareTo: "value", ...p });

    test("a color-only rule does not swallow a later rule's hatch", () => {
        const hit = evaluateRules(day(10), [
            rule({ name: "color", color: "#0072B2" }),
            rule({ name: "hatch", patternOn: true, patternStyle: "dots" }),
        ]);
        expect(hit.colorRule?.name).toBe("color");
        expect(hit.patternRule?.name).toBe("hatch");
    });

    test("first-match-wins still holds WITHIN a channel", () => {
        const hit = evaluateRules(day(10), [
            rule({ name: "first", color: "#0072B2", patternOn: true }),
            rule({ name: "second", color: "#E5484D", patternOn: true }),
        ]);
        expect(hit.colorRule?.name).toBe("first");
        expect(hit.patternRule?.name).toBe("first");
    });

    test("end-to-end: rule 1 colors, rule 2 hatches — both cues reach the DOM", () => {
        const m = mount(); render(m);
        gear(m, {
            "rule1.on": true, "rule1.value": 0, "rule1.color": "#0072B2",
            "rule2.on": true, "rule2.value": 0, "rule2.pattern": true, "rule2.patternStyle": "dots",
        });
        expect(hatchedCells(m.el).length).toBeGreaterThan(0);
        expect(hatchedCells(m.el).every(f => f.includes("dots"))).toBe(true);
    });
});

// ── Coverage of the options that already behaved correctly ───────────────────
describe("day-badge options that were verified good (keep them that way)", () => {
    test.each([
        [">=", 100], [">", 100], ["<=", 100], ["<", 100], ["==", 100], ["between", 100],
    ])("operator %s badges a non-empty, operator-specific set of days", (op, v) => {
        const m = mount(); render(m);
        gear(m, {
            "rule1.on": true, "rule1.operator": op, "rule1.value": v, "rule1.value2": 200,
            "rule1.badge": "⭐",
        });
        expect(m.host.__lastFailure).toBeUndefined();
        expect(allBadges(m.el).length).toBeGreaterThan(0);
    });

    test.each(["diagonal", "dots", "crosshatch", "grid", "stars"])(
        "pattern style %s reaches the DOM as its own pattern def", (style) => {
            const m = mount(); render(m);
            gear(m, { "rule1.on": true, "rule1.value": 100, "rule1.pattern": true, "rule1.patternStyle": style });
            const fills = hatchedCells(m.el);
            expect(fills.length).toBeGreaterThan(0);
            expect(fills.every(f => f.includes(`zx-pat-${style}-`))).toBe(true);
        });

    test("compareTo=target compares value − target, not the raw value", () => {
        const m = mount(); render(m);
        gear(m, {
            "rule1.on": true, "rule1.operator": "<", "rule1.value": 0,
            "rule1.compareTo": "target", "rule1.badge": "❗",
        });
        expect(allBadges(m.el).filter(e => e === "❗").length).toBeGreaterThan(0);
    });

    test("no badge sources on → no badges drawn", () => {
        const m = mount(); render(m);
        expect(allBadges(m.el)).toEqual([]);
    });
});
