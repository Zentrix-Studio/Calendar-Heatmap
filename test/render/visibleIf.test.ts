/**
 * @jest-environment jsdom
 *
 * Z-137 B3.2 — `visibleIf` mechanism on SBField.
 *
 * A field whose `visibleIf` predicate returns false must be absent from the
 * rendered DOM; one whose predicate returns true (or has no predicate) must
 * be present. The legend-specific case (Swatch size / Gradient length swap
 * on buckets=0 vs. buckets=5) is verified as an integration check.
 */
import "../harness/svgPolyfill";
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

function mount(): { el: HTMLDivElement; host: MockHost; visual: Visual } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    (host as any).persistProperties = () => { /* swallow host round-trip */ };
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual };
}

afterEach(() => { document.body.replaceChildren(); });

/** Find a label text in the open overlay — returns the element or null. */
function findLabel(el: HTMLElement, label: string): Element | null {
    for (const node of el.querySelectorAll(".zsb-label")) {
        if (node.textContent?.trim() === label) return node;
    }
    return null;
}

describe("visibleIf — generic mechanism (B3.2)", () => {
    test("a field with visibleIf:()=>false is not rendered", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        // Default buckets = "5" (discrete) → Gradient length has visibleIf: g => g("buckets")==="0" → false.
        (m.visual as any).toolbar.forceOpen("legend");
        const gradientLabel = findLabel(m.el, "Gradient length");
        expect(gradientLabel).toBeNull();
    });

    test("a field with visibleIf:()=>true is rendered", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        // Default buckets = "5" (discrete) → Swatch size has visibleIf: g => g("buckets")!=="0" → true.
        (m.visual as any).toolbar.forceOpen("legend");
        const swatchLabel = findLabel(m.el, "Swatch size");
        expect(swatchLabel).not.toBeNull();
    });
});

describe("visibleIf — legend controls swap with bucket mode (B3.2 integration)", () => {
    test("buckets=Continuous (0): Gradient length visible, Swatch size hidden", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        // Force buckets to continuous (value "0").
        const model: any = (m.visual as any).formattingSettings;
        model.colors.bucketCount.value = { value: "0", displayName: "Continuous" };

        (m.visual as any).toolbar.forceOpen("legend");
        expect(findLabel(m.el, "Gradient length")).not.toBeNull();
        expect(findLabel(m.el, "Swatch size")).toBeNull();
    });

    test("buckets=5 (discrete): Swatch size visible, Gradient length hidden", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
        // Default is "5" discrete, but set explicitly to be certain.
        const model: any = (m.visual as any).formattingSettings;
        model.colors.bucketCount.value = { value: "5", displayName: "5" };

        (m.visual as any).toolbar.forceOpen("legend");
        expect(findLabel(m.el, "Swatch size")).not.toBeNull();
        expect(findLabel(m.el, "Gradient length")).toBeNull();
    });
});
