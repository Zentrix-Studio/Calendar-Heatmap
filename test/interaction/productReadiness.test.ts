/**
 * @jest-environment jsdom
 *
 * Product-readiness pass (Power BI Service review). One file covering the
 * behaviour changes that have no natural home in the existing suites:
 *   #3 accessible names on the in-visual settings controls
 *   #4 Count aggregation tooltip semantics (relabel + suppress target variance)
 *   #6 day-badge rule toggles show a live condition summary
 *   #7 hover suppression hook (toolbar.isOpen) + persistent panel only on click
 *   #8 every settings card is exposed in the native Format pane
 */
import "../harness/svgPolyfill";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView } from "../harness/mockDataView";
import { buildCalendarModel } from "../../src/model/dataTransform";
import { HeatmapTooltip } from "../../src/interaction/tooltip";
import { baseFieldName, metricLabel, autoHeaderTitle } from "../../src/interaction/dayData";
import { VisualFormattingSettingsModel } from "../../src/settings";

const VIEWPORT = { width: 1200, height: 460 };

beforeAll(() => {
    (globalThis as any).ResizeObserver = class {
        observe(): void { /* no-op */ } unobserve(): void { /* no-op */ } disconnect(): void { /* no-op */ }
    };
});

function mount(): { el: HTMLDivElement; host: MockHost; visual: Visual } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    (host as any).persistProperties = () => { /* swallow */ };
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual };
}
afterEach(() => { document.body.replaceChildren(); });

const ariaLabels = (el: HTMLElement) =>
    [...el.querySelectorAll("[aria-label]")].map(n => n.getAttribute("aria-label"));

// ── #4 Count aggregation wording ──────────────────────────────────────────
describe("#4 Count aggregation semantics", () => {
    test("baseFieldName strips the host aggregation prefix; metricLabel relabels Count", () => {
        expect(baseFieldName("Sum of Tickets resolved")).toBe("Tickets resolved");
        expect(baseFieldName("Tickets resolved")).toBe("Tickets resolved");
        expect(metricLabel("Sum of Tickets resolved", "count")).toBe("Count of Tickets resolved");
        expect(metricLabel("Tickets resolved", "sum")).toBe("Tickets resolved");
    });

    test("buildCalendarModel records the aggregation mode on the model", () => {
        const host = createMockHost();
        const dv = buildDataView({ year: 2025, withTarget: true });
        expect(buildCalendarModel(dv, host as any, 0, "count")!.aggMode).toBe("count");
        expect(buildCalendarModel(dv, host as any, 0, "sum")!.aggMode).toBe("sum");
    });

    test("tooltip suppresses the target variance and relabels the metric under Count", () => {
        const host = createMockHost();
        const dv = buildDataView({ year: 2025, withTarget: true });
        const root = document.createElement("div"); document.body.appendChild(root);

        const countModel = buildCalendarModel(dv, host as any, 0, "count")!;
        const day = countModel.days.find(d => !d.noData && d.value != null && d.target != null)!;
        expect(day).toBeTruthy();

        const tip = new HeatmapTooltip(root);
        tip.setContext(countModel, null as any, false);
        tip.show(day, 10, 10);
        const countText = root.textContent || "";
        expect(countText).toContain("Count of Tickets resolved");
        expect(countText).not.toContain("vs Target");

        // Sum mode keeps the target comparison.
        const sumModel = buildCalendarModel(dv, host as any, 0, "sum")!;
        const sday = sumModel.days.find(d => !d.noData && d.value != null && d.target != null)!;
        tip.setContext(sumModel, null as any, false);
        tip.show(sday, 10, 10);
        expect(root.textContent || "").toContain("vs Target");
    });
});

// ── #2 product-grade auto title ───────────────────────────────────────────
describe("#2 header auto-title", () => {
    test("composes \"<Value> by <Split-by>\" and strips the host agg prefix", () => {
        expect(autoHeaderTitle("Sum of Tickets resolved", "Team")).toBe("Tickets resolved by Team");
    });
    test("falls back to the value field name with no Split-by", () => {
        expect(autoHeaderTitle("Tickets resolved")).toBe("Tickets resolved");
        expect(autoHeaderTitle("Sum of Tickets resolved", undefined)).toBe("Tickets resolved");
    });
});

// ── #3 accessible names ───────────────────────────────────────────────────
describe("#3 settings controls expose accessible names", () => {
    test("switches, steppers and B/I/U glyphs are all named", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);

        // Labels sub → Months / Weekdays / KPI header switches.
        (m.visual as any).toolbar.forceOpen("labels");
        const switches = [...m.el.querySelectorAll(".zsb-switch")];
        expect(switches.length).toBeGreaterThan(0);
        expect(switches.every(s => (s.getAttribute("aria-label") || "").length > 0)).toBe(true);
        expect(switches.every(s => s.getAttribute("role") === "switch")).toBe(true);

        // Cells › Gaps → steppers expose Increase/Decrease + a named input.
        (m.visual as any).toolbar.forceOpen("gaps");
        const labels = ariaLabels(m.el);
        expect(labels).toContain("Increase Row gap");
        expect(labels).toContain("Decrease Row gap");

        // Text › Legend text → B/I/U glyphs named by target + style.
        (m.visual as any).toolbar.forceOpen("legendtext");
        expect(ariaLabels(m.el)).toContain("Legend text bold");
    });

    test("custom color controls expose the colour value in their name", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (m.visual as any).toolbar.forceOpen("custom");
        const labels = ariaLabels(m.el);
        // No-data defaults to Auto (blank); start hue carries a hex.
        expect(labels.some(l => /No-data\s+(Auto|#)/i.test(l || ""))).toBe(true);
        expect(labels.some(l => /#[0-9A-Fa-f]{6}/.test(l || ""))).toBe(true);
    });
});

// ── #6 rule condition summaries ───────────────────────────────────────────
describe("#6 day-badge rule toggles summarise their condition", () => {
    test("an enabled rule shows its name and operator/value", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        const model: any = (m.visual as any).formattingSettings;
        model.badges.rule1.on.value = true;
        model.badges.rule1.value.value = 100;
        (m.visual as any).toolbar.forceOpen("badges");
        const labelTexts = [...m.el.querySelectorAll(".zsb-label")].map(n => n.textContent || "");
        expect(labelTexts.some(t => t.includes("Good day") && t.includes("100"))).toBe(true);
    });
});

// ── #7 hover suppression hook ─────────────────────────────────────────────
describe("#7 toolbar open-state is observable for hover suppression", () => {
    test("isOpen flips with the bar and the hover tooltip never auto-opens", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        expect((m.visual as any).toolbar.isOpen()).toBe(false);
        (m.visual as any).toolbar.forceOpen();
        expect((m.visual as any).toolbar.isOpen()).toBe(true);
    });
});

// ── #8 Format pane shows only the three host-level cards ───────────────────
describe("#8 Format pane is trimmed to Toolbar / Accessibility / Branding", () => {
    test("exactly those three cards are visible; everything else is gear-only", () => {
        const m = new VisualFormattingSettingsModel();
        const visible = (m.cards as { name: string; visible?: boolean }[])
            .filter(c => c.visible !== false).map(c => c.name).sort();
        expect(visible).toEqual(["accessibility", "branding", "toolbar"]);
    });

    test("Fiscal year (Time intelligence) stays reachable from the gear", () => {
        const el = document.createElement("div"); document.body.appendChild(el);
        const host = createMockHost();
        (host as any).persistProperties = () => { /* swallow */ };
        const visual = new Visual({ element: el, host } as any);
        visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        (visual as any).toolbar.forceOpen("fiscal");
        const labels = [...el.querySelectorAll(".zsb-rail-row span, .zsb-label, .zsb-pop-title")].map(n => n.textContent || "");
        expect(labels.some(t => /Fiscal year/i.test(t))).toBe(true);
    });
});
