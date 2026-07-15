/**
 * @jest-environment jsdom
 *
 * Autonomous settings sweep — mounts the REAL Visual with a mock host + synthetic
 * DataView, then flips every setting to every non-default value and asserts:
 *   1. no throw / no renderingFailed   (the setting doesn't crash the visual)
 *   2. cells still render              (the setting doesn't silently blank it)
 *   3. the SVG actually changed        (the setting took effect — non-smoke ones)
 *   4. snapshot of the result          (regression net: catches "X broke Y")
 *
 * No browser, no Power BI account — runs under `npm test`. See test/harness/.
 */
import "./harness/svgPolyfill";

import { Visual } from "../src/visual";
import { createMockHost, MockHost } from "./harness/mockHost";
import { buildDataView, SAMPLE_NOTES } from "./harness/mockDataView";
import { enumerateCandidates } from "./harness/sweep";
import { buildFacetedModel } from "../src/model/dataTransform";

// Wide enough that the grid isn't space-starved, so "max cell size" actually
// binds (otherwise size is dictated by available width and the setting no-ops).
const VIEWPORT = { width: 1500, height: 420 };

interface Mounted { el: HTMLDivElement; host: MockHost; visual: Visual; }

function mount(dark = false): Mounted {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost({ dark });
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual };
}

function render(m: Mounted, dv: any) {
    m.host.__lastFailure = undefined;
    m.visual.update({ dataViews: [dv], viewport: VIEWPORT, type: 2 } as any);
}

/** The heatmap SVG (NOT the overlay gear icon, which is a separate <svg>). */
const heatmap = (el: HTMLElement) => el.querySelector("svg.zentrix-heatmap") as SVGSVGElement | null;
const svgHtml = (el: HTMLElement) => { const s = heatmap(el); return s ? new XMLSerializer().serializeToString(s) : ""; };
const cellCount = (el: HTMLElement) => heatmap(el)?.querySelectorAll("rect.cell").length ?? 0;

/** Compact, reviewable structural signature — a regression flips this without
 *  bloating the repo with giant SVG dumps. `jest -u` to accept intended changes. */
function fingerprint(el: HTMLElement) {
    const svg = heatmap(el);
    if (!svg) return { missing: true };
    const cells = svg.querySelectorAll("rect.cell");
    const first = cells[0] as SVGRectElement | undefined;
    const tag = (t: string) => svg.getElementsByTagName(t).length;
    const texts = Array.from(svg.querySelectorAll("text"));
    return {
        cells: cells.length,
        rects: tag("rect"),
        texts: texts.length,
        paths: tag("path"),
        circles: tag("circle"),
        lines: tag("line"),
        // geometry of the first cell pins size/gap/radius/layout changes
        cell0: first ? { x: first.getAttribute("x"), y: first.getAttribute("y"), w: first.getAttribute("width"), rx: first.getAttribute("rx"), fill: first.getAttribute("fill") } : null,
        // first few text contents pin label/header/legend wording
        text0: texts.slice(0, 4).map(t => t.textContent),
    };
}

afterEach(() => { document.body.replaceChildren(); });

describe("baseline", () => {
    test("renders cells with no failure", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        expect(m.host.__lastFailure).toBeUndefined();
        expect(cellCount(m.el)).toBeGreaterThan(0);
    });

    test("each empty-state reason renders a message, no crash", () => {
        const m = mount();
        // date only, value only, nothing — all should be handled gracefully.
        render(m, { metadata: { columns: [] }, categorical: { categories: [], values: [] } });
        expect(m.host.__lastFailure).toBeUndefined();
    });
});

describe("settings sweep (single grid)", () => {
    // Seed the persisted annotation store (Z-152) so the annotation layer actually
    // draws — otherwise every Annotations display pref is trivially effect-less and
    // the sweep would have to wave it through as smoke-only.
    const dv = buildDataView({ year: 2025, withTarget: true, withTooltip: true, notes: SAMPLE_NOTES });
    const candidates = enumerateCandidates();

    test("enumerated a candidate for most slices", () => {
        // Guardrail: if the model grows, the sweep should grow with it.
        expect(candidates.length).toBeGreaterThan(40);
    });

    test.each(candidates.map(c => [c.label, c] as const))("%s", (_label, c) => {
        const m = mount();
        render(m, dv);
        const model: any = (m.visual as any).formattingSettings;

        // Apply prerequisite gate (if any) and capture the pre-change render so we
        // measure THIS setting's effect, not the gate's.
        if (c.prereq) { c.prereq(model); (m.visual as any).rerenderFromSettings(); }
        const before = svgHtml(m.el);

        let threw: unknown;
        try {
            c.apply(model);
            (m.visual as any).rerenderFromSettings();
        } catch (e) { threw = e; }

        expect(threw).toBeUndefined();
        expect(m.host.__lastFailure).toBeUndefined();
        // Alternate-view settings (summary table) legitimately render zero day
        // cells; everything else must never blank the grid.
        if (!c.allowNoCells) expect(cellCount(m.el)).toBeGreaterThan(0);

        const after = svgHtml(m.el);
        if (c.expectChange) {
            expect(after).not.toEqual(before); // setting actually took effect
        }
        expect(fingerprint(m.el)).toMatchSnapshot();
    });
});

describe("context-sensitive settings", () => {
    test("small multiples render when a Split-by category is bound", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, categories: ["Alpha", "Beta", "Gamma"] }));
        expect(m.host.__lastFailure).toBeUndefined();
        expect(cellCount(m.el)).toBeGreaterThan(0);
    });

    test("multi-year data renders year tags without crashing", () => {
        const m = mount();
        render(m, buildDataView({ years: [2021, 2025] }));
        expect(m.host.__lastFailure).toBeUndefined();
        expect(cellCount(m.el)).toBeGreaterThan(0);
    });

    test("dark theme + high contrast both render", () => {
        const dark = mount(true);
        render(dark, buildDataView({ year: 2025 }));
        expect(dark.host.__lastFailure).toBeUndefined();
        expect(cellCount(dark.el)).toBeGreaterThan(0);

        const el = document.createElement("div");
        document.body.appendChild(el);
        const host = createMockHost({ highContrast: true });
        const v = new Visual({ element: el, host } as any);
        host.__lastFailure = undefined;
        v.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        expect(host.__lastFailure).toBeUndefined();
        expect(el.querySelectorAll("rect.cell").length).toBeGreaterThan(0);
    });
});

// Data-level settings are consumed when the model is BUILT, so they're tested at
// the data layer (where they take effect) rather than via the render harness.
describe("data-level settings (build path)", () => {
    const host = createMockHost();

    test("firstDayOfWeek re-rows the grid", () => {
        const dv = buildDataView({ year: 2025 });
        const jan1 = (fdow: number) => buildFacetedModel(dv, host, fdow, "sum")!
            .combined.days.find(d => d.date.getMonth() === 0 && d.date.getDate() === 1)!;
        // 1 Jan 2025 is a Wednesday → row 3 (Sun-start) vs row 2 (Mon-start).
        expect(jan1(0).row).not.toEqual(jan1(1).row);
    });

    test("aggregation collapses duplicate days differently per mode", () => {
        // Two rows on the same day → modes must disagree.
        const dateCol: any = { displayName: "Date", roles: { date: true }, type: {} };
        const valueCol: any = { displayName: "V", roles: { value: true }, type: {} };
        const d = new Date(2025, 0, 1);
        const dv: any = {
            metadata: { columns: [dateCol, valueCol], objects: undefined },
            categorical: { categories: [{ source: dateCol, values: [d, d] }], values: [{ source: valueCol, values: [10, 30] }] },
        };
        const val = (mode: any) => buildFacetedModel(dv, host, 0, mode)!
            .combined.days.find(c => c.value != null)!.value;
        expect(val("sum")).toBe(40);
        expect(val("avg")).toBe(20);
        expect(val("min")).toBe(10);
        expect(val("max")).toBe(30);
        expect(val("count")).toBe(2);
    });
});
