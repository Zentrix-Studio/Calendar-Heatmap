/**
 * @jest-environment jsdom
 *
 * Z-137 §4 — "Reset to defaults" in the in-visual overlay. A two-tap confirm on
 * the bar's Reset action must (a) persist a REMOVE of the visual's objects (so the
 * model falls back to declared defaults) and (b) optimistically revert the live
 * model so the canvas redraws at defaults without waiting for the host round-trip.
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

function mount(): { el: HTMLDivElement; host: MockHost; visual: Visual; persisted: any[] } {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    const persisted: any[] = [];
    (host as any).persistProperties = (ops: any) => persisted.push(ops);
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual, persisted };
}

afterEach(() => { document.body.replaceChildren(); });

describe("Reset to defaults (Z-137 §4)", () => {
    test("two-tap Reset persists a remove for every object and reverts the live model", () => {
        const m = mount();
        m.visual.update({ dataViews: [buildDataView({ year: 2025 })], viewport: VIEWPORT, type: 2 } as any);

        // Mutate a couple of settings away from their defaults on the live model.
        const model: any = (m.visual as any).formattingSettings;
        model.cells.cornerRadius.value = 11;
        model.cells.cellGapX.value = 9;
        expect(model.cells.cornerRadius.value).toBe(11);

        // Open the overlay bar so the Reset action mounts into the DOM.
        (m.visual as any).toolbar.forceOpen();
        const resetBtn = m.el.querySelector(".zsb-reset") as HTMLButtonElement | null;
        expect(resetBtn).not.toBeNull();

        // First tap arms (Confirm); second tap commits.
        resetBtn!.click();
        expect(resetBtn!.querySelector(".zsb-reset-label")!.textContent).toBe("Confirm");
        const before = m.persisted.length;
        resetBtn!.click();

        // A removeObject op was persisted, covering the model's objects (incl. "cells").
        expect(m.persisted.length).toBe(before + 1);
        const removeOp = m.persisted[m.persisted.length - 1];
        expect(removeOp.removeObject).toBeTruthy();
        const names = removeOp.removeObject.map((r: any) => r.objectName);
        expect(names).toContain("cells");
        expect(names).toContain("colors");

        // Live model optimistically reverted to defaults.
        expect(model.cells.cornerRadius.value).toBe(2);
        expect(model.cells.cellGapX.value).toBe(3);
    });
});
