/**
 * @jest-environment jsdom
 *
 * Z-137 §1 overlay reconciliation (Change A) — the Palette swatch row must reflect
 * the *active* palette mode, not just the stored ramp id. A built-in ramp shows its
 * check only while ramp mode is live. After the user hand-edits a custom color
 * (colorMode() flips paletteMode to split/duotone), NO swatch may read as active —
 * otherwise the Palette row contradicts the recolored grid (the CEO's "color palette
 * not working" report). Selecting a swatch flips back to ramp and re-checks it.
 */
import "../harness/svgPolyfill";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView } from "../harness/mockDataView";

const VIEWPORT = { width: 1200, height: 420 };

// jsdom has no ResizeObserver; the settings bar instantiates one when it opens.
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

/** Open the overlay to the Palette swatch sub and return the rendered swatch buttons. */
function openPalette(m: { el: HTMLDivElement; visual: Visual }): HTMLButtonElement[] {
    (m.visual as any).toolbar.forceOpen("palette");
    return Array.from(m.el.querySelectorAll(".zsb-opt")) as HTMLButtonElement[];
}

const activeCount = (btns: HTMLButtonElement[]): number =>
    btns.filter(b => b.getAttribute("data-active") === "true").length;

afterEach(() => { document.body.replaceChildren(); });

describe("Palette swatch active-state gates on palette mode (Z-137 §1 Change A)", () => {
    test("ramp mode (fresh visual): exactly one swatch shows checked", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);

        const model: any = (m.visual as any).formattingSettings;
        expect(model.colors.paletteMode.value.value).toBe("ramp");

        const btns = openPalette(m);
        expect(btns.length).toBeGreaterThan(0);
        const active = btns.filter(b => b.getAttribute("data-active") === "true");
        expect(active.length).toBe(1);
        expect(active[0].querySelector(".zsb-accent")).not.toBeNull(); // check glyph present
    });

    test("split mode (after a custom edit): NO swatch shows checked", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);

        // Simulate the user hand-editing custom colors → colorMode() flips mode to split.
        const model: any = (m.visual as any).formattingSettings;
        model.colors.paletteMode.value = { value: "split", displayName: "Split" };

        const btns = openPalette(m);
        expect(btns.length).toBeGreaterThan(0);
        expect(activeCount(btns)).toBe(0);
        expect(m.el.querySelector(".zsb-accent")).toBeNull(); // no check glyph anywhere in the row
    });

    test("duotone mode: NO swatch shows checked", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);

        const model: any = (m.visual as any).formattingSettings;
        model.colors.paletteMode.value = { value: "duotone", displayName: "Duotone" };

        expect(activeCount(openPalette(m))).toBe(0);
    });
});
