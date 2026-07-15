/**
 * @jest-environment jsdom
 *
 * Summary table — the full-screen alternate view (Elements → Summary table).
 * Pins the three contract points of the feature:
 *
 *   ST-01  EXCLUSIVITY — the table and the calendar are never on screen together:
 *          table active → zero day cells; calendar active → zero table rows.
 *   ST-02  the bottom-right Visual/Table switch flips the view BOTH ways without
 *          persisting (it must work in Reading view), and survives a host update().
 *   ST-03  the switch exists only while the option is on; turning the option off
 *          restores the calendar and re-arms the default (next enable = table first).
 *
 * Driven through the REAL gear engine (applyLocal → rerenderFromSettings) and
 * real DOM clicks, per the ledger's audit method.
 */
import "../harness/svgPolyfill";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView } from "../harness/mockDataView";
import { applyLocal } from "../../src/interaction/settingsSchema";

const VIEWPORT = { width: 1200, height: 420 };

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

function render(m: Mounted, dv: any) {
    m.host.__lastFailure = undefined;
    m.visual.update({ dataViews: [dv], viewport: VIEWPORT, type: 2 } as any);
}

/** Drive the gear exactly as the settings bar does: mutate locally, then repaint. */
function gear(m: Mounted, key: string, value: unknown) {
    applyLocal((m.visual as any).formattingSettings, key, value);
    (m.visual as any).rerenderFromSettings();
}

const cells = (el: HTMLElement) => el.querySelectorAll("svg.zentrix-heatmap rect.cell").length;
const tableRows = (el: HTMLElement) => el.querySelectorAll("svg.zentrix-heatmap g.sum-row").length;
const tableTexts = (el: HTMLElement) =>
    Array.from(el.querySelectorAll("svg.zentrix-heatmap g.summary-table text")).map(t => t.textContent);
const toggle = (el: HTMLElement) => el.querySelector(".zx-view-toggle") as HTMLElement;
const toggleBtn = (el: HTMLElement, label: string) =>
    Array.from(toggle(el).querySelectorAll("button")).find(b => b.textContent === label)!;

describe("ST-01 — the summary table replaces the calendar (never both)", () => {
    test("enabling swaps every day cell for month rows + a Total row", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        expect(cells(m.el)).toBeGreaterThan(0);
        expect(tableRows(m.el)).toBe(0);

        gear(m, "summaryTable.show", true);
        expect(m.host.__lastFailure).toBeUndefined();
        expect(cells(m.el)).toBe(0);                 // calendar fully gone
        expect(tableRows(m.el)).toBe(12);            // one row per month of 2025
        const texts = tableTexts(m.el);
        expect(texts).toContain("Jan");
        expect(texts).toContain("Dec");
        expect(texts).toContain("Total");
    });

    test("with a Split-by bound the rows are the groups", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, categories: ["Alpha", "Beta", "Gamma"] }));
        gear(m, "summaryTable.show", true);
        expect(cells(m.el)).toBe(0);
        expect(tableRows(m.el)).toBe(3);
        const texts = tableTexts(m.el);
        for (const k of ["Alpha", "Beta", "Gamma"]) expect(texts).toContain(k);
    });
});

describe("ST-02 — the bottom-right switch flips views both ways", () => {
    test("Visual → calendar back; Table → table again; no persistence needed", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        gear(m, "summaryTable.show", true);
        expect(toggle(m.el).style.display).not.toBe("none");

        toggleBtn(m.el, "Visual").click();
        expect(cells(m.el)).toBeGreaterThan(0);      // calendar is back
        expect(tableRows(m.el)).toBe(0);             // table fully gone
        expect(toggle(m.el).style.display).not.toBe("none"); // switch stays available

        toggleBtn(m.el, "Table").click();
        expect(cells(m.el)).toBe(0);
        expect(tableRows(m.el)).toBeGreaterThan(0);
    });

    test("the chosen view survives a host update()", () => {
        const m = mount();
        // The option arrives persisted ON metadata.objects, as in a saved report.
        const dv = buildDataView({ year: 2025, objects: { summaryTable: { show: true } } });
        render(m, dv);
        expect(cells(m.el)).toBe(0);                 // persisted ON → opens on the table

        toggleBtn(m.el, "Visual").click();
        expect(cells(m.el)).toBeGreaterThan(0);

        // A host round-trip (resize, cross-filter, data refresh) must not yank
        // the reader back to the table they just switched away from.
        render(m, dv);
        expect(cells(m.el)).toBeGreaterThan(0);      // still on the calendar view
        expect(toggle(m.el).style.display).not.toBe("none");
    });
});

describe("ST-03 — the switch only exists while the option is on", () => {
    test("off by default; hidden again after disabling; default re-arms to table", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        expect(toggle(m.el).style.display).toBe("none"); // option off → no switch

        gear(m, "summaryTable.show", true);
        toggleBtn(m.el, "Visual").click();               // reader flips to the calendar
        gear(m, "summaryTable.show", false);
        expect(toggle(m.el).style.display).toBe("none");
        expect(cells(m.el)).toBeGreaterThan(0);
        expect(tableRows(m.el)).toBe(0);

        // Re-enabling opens on the TABLE again (the flip was session sugar,
        // not a persistent preference).
        gear(m, "summaryTable.show", true);
        expect(cells(m.el)).toBe(0);
        expect(tableRows(m.el)).toBeGreaterThan(0);
    });
});
