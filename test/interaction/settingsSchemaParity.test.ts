/**
 * @jest-environment jsdom
 *
 * Z-150 — Settings-bar ⇄ native-pane parity.
 *
 * The in-visual settings bar (`settingsSchema.ts`) must expose every property
 * the native format pane (`settings.ts`) exposes for the Z-145/146/147/149 slice.
 * This locks that parity so a future "I added a native prop but forgot the bar
 * binding" regression FAILS here.
 *
 * It asserts three things per new feature:
 *   1. Every new binding key resolves on a fresh model (readLocal !== undefined-only-because-missing).
 *   2. Each binding round-trips: applyLocal(set) → readLocal reflects it.
 *   3. The new/extended cards actually render their fields in the open bar (DOM).
 */
import "../harness/svgPolyfill";

import { VisualFormattingSettingsModel } from "../../src/settings";
import { applyLocal, readLocal, gearObjectNames } from "../../src/interaction/settingsSchema";
import { VERSION } from "../../src/version";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView } from "../harness/mockDataView";

const VIEWPORT = { width: 1200, height: 420 };

beforeAll(() => {
    (globalThis as any).ResizeObserver = class {
        observe(): void { /* no-op */ }
        unobserve(): void { /* no-op */ }
        disconnect(): void { /* no-op */ }
    };
});

/** A new binding + a non-default value to round-trip through it. */
const ROUND_TRIPS: [key: string, value: unknown][] = [
    // Z-149 — accessibility pattern style
    ["a11y.patternStyle", "dots"],
    // Z-145 — day detail
    ["dayDetail.enabled", false],
    ["dayDetail.position", "bottom"],
    ["dayDetail.topContributor", false],
    // Z-152 — annotations (display prefs; the notes themselves live in the note
    // store, which is deliberately NOT a formatting-model setting).
    ["annotation.show", false],
    ["annotation.markerStyle", "icon"],
    ["annotation.markerIcon", "🚩"],
    ["annotation.markerColor", "#123456"],
    ["annotation.defaultMode", "marker"],
    // Summary table — the full-screen alternate view (Elements → Summary table).
    ["summaryTable.show", true],
    // QA 2026-07-14 — the D1–D4 orphaned cards, wired into the gear. Removing any
    // of these bindings re-orphans the card (persists + renders but unreachable).
    ["insights.show", false],                 // D1
    ["insights.polarity", "good"],
    ["insights.count", 5],
    ["facets.columns", 3],                    // D2
    ["facets.sharedScale", false],
    ["facetTitle.fontSize", 15],              // D3
    ["facetTitle.bold", false],
    ["facetTitle.color", "#123456"],
    ["paletteMode", "mono"],                  // D4
    ["paletteMode", "theme"],
];

// Z-146 — every prop of all three rule slots (mirrors the native RuleSlot 1:1).
for (const n of [1, 2, 3] as const) {
    ROUND_TRIPS.push(
        [`rule${n}.on`, true],
        [`rule${n}.name`, `R${n}`],
        [`rule${n}.operator`, "between"],
        [`rule${n}.value`, 42],
        [`rule${n}.value2`, 84],
        [`rule${n}.compareTo`, "target"],
        [`rule${n}.badge`, "✅"],
        [`rule${n}.color`, "#abcdef"],
        [`rule${n}.pattern`, true],
        [`rule${n}.patternStyle`, "stars"],
    );
}

describe("Z-150 — every new binding round-trips through the model", () => {
    test.each(ROUND_TRIPS)("%s round-trips", (key, value) => {
        const m = new VisualFormattingSettingsModel();
        // The key must be registered (an unknown key returns undefined unconditionally).
        applyLocal(m, key, value);
        const read = readLocal(m, key);
        expect(String(read)).toEqual(String(value));
    });
});

describe("Z-150 — native-pane props each have a matching bar binding", () => {
    const m = new VisualFormattingSettingsModel();

    test("accessibility.patternStyle is reachable", () => {
        applyLocal(m, "a11y.patternStyle", "grid");
        expect(m.accessibility.patternStyle.value.value).toBe("grid");
    });

    test("each rule slot's full RuleSlot surface is reachable", () => {
        for (const n of [1, 2, 3] as const) {
            const slot = (m.badges as any)[`rule${n}`];
            applyLocal(m, `rule${n}.on`, true);
            applyLocal(m, `rule${n}.operator`, "<=");
            applyLocal(m, `rule${n}.compareTo`, "target");
            applyLocal(m, `rule${n}.color`, "#0072B2");
            applyLocal(m, `rule${n}.pattern`, true);
            applyLocal(m, `rule${n}.patternStyle`, "crosshatch");
            expect(slot.on.value).toBe(true);
            expect(slot.operator.value.value).toBe("<=");
            expect(slot.compareTo.value.value).toBe("target");
            expect(slot.color.value.value).toBe("#0072B2");
            expect(slot.pattern.value).toBe(true);
            expect(slot.patternStyle.value.value).toBe("crosshatch");
        }
        // Edits resolve into the engine's Rule[] exactly as the native pane would.
        expect(m.badges.activeRules()).toHaveLength(3);
    });

    test("dayDetail + annotations props are reachable", () => {
        applyLocal(m, "dayDetail.position", "right");
        applyLocal(m, "annotation.markerStyle", "icon");
        applyLocal(m, "annotation.markerColor", "#7C5CFF");
        applyLocal(m, "annotation.defaultMode", "all");
        expect(m.dayDetail.position.value.value).toBe("right");
        expect(m.annotations.markerStyle.value.value).toBe("icon");
        expect(m.annotations.markerColor.value.value).toBe("#7C5CFF");
        expect(m.annotations.defaultMode.value.value).toBe("all");
    });
});

/* ---- DOM: the new/extended cards render their fields in the open bar ---- */

function mount(): { el: HTMLDivElement; host: MockHost; visual: Visual } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    (host as any).persistProperties = () => { /* swallow host round-trip */ };
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual };
}

afterEach(() => { document.body.replaceChildren(); });

function findLabel(el: HTMLElement, label: string): Element | null {
    for (const node of el.querySelectorAll(".zsb-label")) {
        if (node.textContent?.trim() === label) return node;
    }
    return null;
}

describe("Z-150 — new cards render in the open bar", () => {
    test("Accessibility card shows the Pattern style control when pattern is on", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        const model: any = (m.visual as any).formattingSettings;
        model.accessibility.patternOnThreshold.value = true;
        (m.visual as any).toolbar.forceOpen("a11y");
        expect(findLabel(m.el, "Pattern style")).not.toBeNull();
    });

    test("Day badges card shows the three rule toggles by their friendly names", () => {
        // Issue #6 — the vague "Rule 1/2/3" labels were replaced with a live summary;
        // when a rule is off (default) the toggle shows its friendly name.
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("badges");
        expect(findLabel(m.el, "Good day")).not.toBeNull();
        expect(findLabel(m.el, "Bad day")).not.toBeNull();
        expect(findLabel(m.el, "Target breach")).not.toBeNull();
    });

    test("Day detail card renders", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("dayDetail");
        expect(findLabel(m.el, "Show panel")).not.toBeNull();
    });

    test("Annotations card renders", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("annotations");
        expect(findLabel(m.el, "Show annotations")).not.toBeNull();
        expect(findLabel(m.el, "New note shows")).not.toBeNull();
    });

    // QA 2026-07-14 (D1–D4): the formerly-orphaned cards must actually render fields.
    test("Insights card renders with polarity + count gated on show", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("insights");
        expect(findLabel(m.el, "Show insights")).not.toBeNull();
        expect(findLabel(m.el, "Higher is")).not.toBeNull();  // default show=true → visible
        expect(findLabel(m.el, "Max insights")).not.toBeNull();
    });

    test("Small multiples card renders", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("facets");
        expect(findLabel(m.el, "Columns (0 = auto)")).not.toBeNull();
        expect(findLabel(m.el, "Shared color scale")).not.toBeNull();
    });

    test("Facet titles text card renders", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("facettitle");
        // Expandable rows carry the sub-name prefix in their aria label.
        expect(findLabel(m.el, "Facet titles Font")).not.toBeNull();
        expect(findLabel(m.el, "Facet titles Color")).not.toBeNull();
        expect(findLabel(m.el, "Size")).not.toBeNull();
    });

    test("Palette Mode row renders in Custom colors (D4)", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("custom");
        expect(findLabel(m.el, "Mode")).not.toBeNull();
    });
});

describe("reverse reachability — no card may be orphaned (D1–D4 guard)", () => {
    // Mirrors PANE_CARDS in settings.ts:534 — the only cards the native Format pane shows.
    const PANE = new Set(["toolbar", "accessibility", "branding"]);
    // Cards deliberately unreachable go here WITH a reason. Empty today — keep it that way.
    const ALLOWED_ORPHANS = new Set<string>([]);

    test("every card is reachable from the Format pane or the gear", () => {
        const gear = gearObjectNames();
        const m = new VisualFormattingSettingsModel();
        const orphans = (m.cards as { name: string }[])
            .map(c => c.name)
            .filter(n => !PANE.has(n) && !gear.has(n) && !ALLOWED_ORPHANS.has(n));
        // Failed? A card exists in capabilities.json + settings.ts but has no KEYS/SB_CATS
        // binding — users can never change it. Wire it into settingsSchema.ts or add it to
        // ALLOWED_ORPHANS with a documented reason.
        expect(orphans).toEqual([]);
    });
});

describe("QA-04 — the gear hides on tiles too small for its popover", () => {
    const anchor = (el: HTMLElement) => el.querySelector(".zsb-anchor") as HTMLElement;

    test("hidden at 200×150, visible again after a resize up", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: { width: 200, height: 150 }, type: 2 } as any);
        expect(anchor(m.el).style.display).toBe("none");
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        expect(anchor(m.el).style.display).not.toBe("none");
    });
});

describe("QA-10 — the running build version is readable from the gear", () => {
    test("Accessibility pane shows the version heading matching src/version.ts", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("a11y");
        const heads = Array.from(m.el.querySelectorAll(".zsb-field-head")).map(n => n.textContent);
        expect(heads).toContain(`Zentrix Calendar Heatmap v${VERSION}`);
    });
});

describe("QA-D4 — mono/theme palette modes are reachable and stable", () => {
    test("picking mono then editing Start/hue STAYS mono (no duotone kick)", () => {
        const m = new VisualFormattingSettingsModel();
        applyLocal(m, "paletteMode", "mono");
        applyLocal(m, "col.start", "#118DFF");
        expect(m.colors.paletteMode.value.value).toBe("mono");
        expect(m.colors.startColor.value.value).toBe("#118DFF");
    });

    test("editing Start/hue from ramp mode still begins a duotone (Z-137 behavior kept)", () => {
        const m = new VisualFormattingSettingsModel();
        applyLocal(m, "paletteMode", "ramp");
        applyLocal(m, "col.start", "#118DFF");
        expect(m.colors.paletteMode.value.value).toBe("duotone");
    });

    test("theme mode + Start/hue edit resolves to mono (the edit takes visible effect)", () => {
        const m = new VisualFormattingSettingsModel();
        applyLocal(m, "paletteMode", "theme");
        applyLocal(m, "col.start", "#118DFF");
        expect(m.colors.paletteMode.value.value).toBe("mono");
    });
});
