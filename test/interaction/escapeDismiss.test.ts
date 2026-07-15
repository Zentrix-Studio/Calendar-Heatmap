/**
 * @jest-environment jsdom
 *
 * Z review (menu dismissal) — the in-visual settings bar must be dismissable via
 * the keyboard. Escape unwinds one layer at a time: an open category popover
 * closes first (the bar stays up), and a second Escape collapses the whole bar.
 * Regression guard: before this fix the component had NO keyboard handling, so
 * an open menu could only be dismissed by re-clicking, which was flaky in-host.
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
    (host as any).persistProperties = () => { /* swallow */ };
    const visual = new Visual({ element: el, host } as any);
    visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);
    return { el, host, visual };
}

afterEach(() => { document.body.replaceChildren(); });

const pressEscape = () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

describe("Escape dismisses the in-visual settings bar", () => {
    test("first Escape closes the open category popover; the bar stays up", () => {
        const m = mount();
        // Open the bar AND a category popover (Cells → Density).
        (m.visual as any).toolbar.forceOpen("density");
        expect(m.el.querySelector(".zsb-pop")).not.toBeNull();
        expect(m.el.querySelector(".zsb-bar")).not.toBeNull();

        pressEscape();

        expect(m.el.querySelector(".zsb-pop")).toBeNull();   // popover dismissed
        expect(m.el.querySelector(".zsb-bar")).not.toBeNull(); // bar remains open
    });

    test("Escape with no popover open begins collapsing the whole bar", () => {
        const m = mount();
        (m.visual as any).toolbar.forceOpen();   // bar open, no category popover
        const bar = m.el.querySelector(".zsb-bar") as HTMLElement;
        expect(bar).not.toBeNull();
        expect(m.el.querySelector(".zsb-pop")).toBeNull();

        pressEscape();

        // collapse() flips the internal open flag and starts the close animation synchronously.
        expect(bar.classList.contains("zsb-bar--closing")).toBe(true);
    });

    test("Escape is a no-op when the bar is closed (no listener leak / throw)", () => {
        const m = mount();
        expect(m.el.querySelector(".zsb-bar")).toBeNull();
        expect(() => pressEscape()).not.toThrow();
    });
});
