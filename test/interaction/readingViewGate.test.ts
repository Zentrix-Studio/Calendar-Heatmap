/**
 * @jest-environment jsdom
 *
 * Z review (CEO call) — the in-visual settings gear is an AUTHOR tool. It must be
 * hidden for report consumers in Reading view (ViewMode.View = 0), where their
 * edits wouldn't persist, and shown in authoring contexts (Edit = 1 /
 * InFocusEdit = 2) and when the host reports no viewMode (preview harness / older
 * hosts → treat unknown as authoring so an author is never locked out).
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

function mount(): { el: HTMLDivElement; visual: Visual } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost() as MockHost;
    (host as any).persistProperties = () => { /* swallow */ };
    const visual = new Visual({ element: el, host } as any);
    return { el, visual };
}

const update = (visual: Visual, viewMode?: number) =>
    visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2, viewMode } as any);

const anchorDisplay = (el: HTMLElement) =>
    (el.querySelector(".zsb-anchor") as HTMLElement | null)?.style.display;

afterEach(() => { document.body.replaceChildren(); });

describe("In-visual gear is gated to authoring contexts", () => {
    test("hidden in Reading view (ViewMode.View = 0)", () => {
        const m = mount();
        update(m.visual, 0);
        expect(anchorDisplay(m.el)).toBe("none");
    });

    test("shown in Edit view (ViewMode.Edit = 1)", () => {
        const m = mount();
        update(m.visual, 1);
        expect(anchorDisplay(m.el)).toBe("flex");
    });

    test("shown in focus-in-edit (ViewMode.InFocusEdit = 2)", () => {
        const m = mount();
        update(m.visual, 2);
        expect(anchorDisplay(m.el)).toBe("flex");
    });

    test("shown when the host reports no viewMode (unknown → authoring)", () => {
        const m = mount();
        update(m.visual, undefined);
        expect(anchorDisplay(m.el)).toBe("flex");
    });
});
