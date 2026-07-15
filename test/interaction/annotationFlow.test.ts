/**
 * @jest-environment jsdom
 *
 * Z-152 — click a day → add an annotation. End-to-end through the REAL Visual.
 *
 * This drives the actual user gesture (click a cell, press "Add note", type, press
 * Done) and asserts what comes out the other side: a persistProperties call
 * carrying the note store, and a callout drawn on the canvas.
 *
 * The two tests that matter most and are easy to lose in a refactor:
 *   - "the gear's Reset must not destroy annotations" — the reason the store is a
 *     capabilities object with NO Card (see notes/store.ts).
 *   - "annotations survive a data refresh" — the reason they're keyed by ISO date
 *     and not by selectionId.
 */
import "../harness/svgPolyfill";

import powerbi from "powerbi-visuals-api";
import { Visual } from "../../src/visual";
import { createMockHost, MockHost } from "../harness/mockHost";
import { buildDataView, SAMPLE_NOTES } from "../harness/mockDataView";
import { parseStore } from "../../src/notes/store";
import { VisualFormattingSettingsModel } from "../../src/settings";

const VIEWPORT = { width: 1200, height: 480 };
/** Power BI's ViewMode enum: View = 0, Edit = 1. */
const EDIT = 1, READING = 0;

beforeAll(() => {
    (globalThis as any).ResizeObserver = class {
        observe(): void { /* no-op */ }
        unobserve(): void { /* no-op */ }
        disconnect(): void { /* no-op */ }
    };
});
afterEach(() => { document.body.replaceChildren(); });

interface Mounted {
    el: HTMLDivElement;
    host: MockHost;
    visual: Visual;
    /** Every persistProperties payload the visual sent, in order. */
    persisted: powerbi.VisualObjectInstancesToPersist[];
}

function mount(): Mounted {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const host = createMockHost();
    const persisted: powerbi.VisualObjectInstancesToPersist[] = [];
    (host as any).persistProperties = (c: powerbi.VisualObjectInstancesToPersist) => { persisted.push(c); };
    const visual = new Visual({ element: el, host } as any);
    return { el, host, visual, persisted };
}

function render(m: Mounted, dv: unknown, viewMode = EDIT): void {
    m.host.__lastFailure = undefined;
    m.visual.update({ dataViews: [dv], viewport: VIEWPORT, type: 2, viewMode } as any);
}

/** The rendered cell for a given day — found by its bound datum, like a user's eye. */
function cellFor(m: Mounted, date: Date): SVGRectElement {
    const cells = Array.from(m.el.querySelectorAll<SVGRectElement>("svg.zentrix-heatmap rect.cell"));
    const hit = cells.find(c => {
        const d = (c as unknown as { __data__?: { date?: Date } }).__data__;
        return d?.date?.getTime() === date.getTime();
    });
    if (!hit) throw new Error(`no cell rendered for ${date.toDateString()}`);
    return hit;
}

const click = (el: Element) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

/** Find a button by its visible label — the same way a user finds it. */
function button(m: Mounted, label: string): HTMLButtonElement {
    const found = Array.from(m.el.querySelectorAll("button"))
        .find(b => b.textContent?.trim() === label);
    if (!found) throw new Error(`no button labelled "${label}"`);
    return found;
}
const hasButton = (m: Mounted, label: string) =>
    Array.from(m.el.querySelectorAll("button")).some(b => b.textContent?.trim() === label);

const editorText = (m: Mounted) => m.el.querySelector("textarea") as HTMLTextAreaElement | null;
const callouts = (m: Mounted) => Array.from(m.el.querySelectorAll("g.zx-note"));
/** On-grid annotation markers (the numbered discs live in the annotations layer). */
const markers = (m: Mounted) => Array.from(m.el.querySelectorAll("svg.zentrix-heatmap g.annotations circle"));
const calloutText = (m: Mounted) =>
    callouts(m).map(g => Array.from(g.querySelectorAll("tspan")).map(t => t.textContent).join(" "));

/** The last notesStore blob the visual persisted, parsed. */
function persistedNotes(m: Mounted) {
    for (let i = m.persisted.length - 1; i >= 0; i--) {
        const merge = m.persisted[i]!.merge ?? [];
        const hit = merge.find(x => x.objectName === "notesStore");
        if (hit) return parseStore((hit.properties as { data?: string }).data).items;
    }
    return null;
}

const MAR14 = new Date(2025, 2, 14);

// ---------------------------------------------------------------------------

describe("click a day → add a note", () => {
    it("offers 'Add note' in the day panel, and typing one persists it", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));

        // 1. Click the day. The detail panel (which already opens on click) is the
        //    entry point — no new gesture to teach.
        click(cellFor(m, MAR14));
        expect(hasButton(m, "＋ Add note")).toBe(true);

        // 2. Press it → the editor opens on a fresh note for that day.
        click(button(m, "＋ Add note"));
        const ta = editorText(m);
        expect(ta).not.toBeNull();
        expect(ta!.value).toBe("");

        // 3. Type. The canvas repaints optimistically, before anything is persisted —
        //    the author sees their marker appear as they write.
        ta!.value = "Release 4.2 shipped";
        ta!.dispatchEvent(new Event("input"));
        expect(markers(m).length).toBeGreaterThan(0);
        expect(persistedNotes(m)).toBeNull(); // nothing written yet

        // 4. Done → NOW it's persisted.
        click(button(m, "Done"));
        const stored = persistedNotes(m);
        expect(stored).toHaveLength(1);
        expect(stored![0]!.text).toBe("Release 4.2 shipped");
        expect(stored![0]!.anchor).toBe("2025-03-14|"); // the natural key, not a row index
        expect(stored![0]!.mode).toBe("marker");     // the un-intrusive default
        expect(m.host.__lastFailure).toBeUndefined();
    });

    it("defaults a new note to a marker, not a callout that covers the grid", () => {
        // On a full-year grid the cells are ~10-14px wide and the canvas is full. An
        // always-visible callout necessarily sits ON the days around the one it
        // annotates — it hides the data it exists to explain. So a new note is a
        // marker (text on hover / in the panel), and a callout is opt-in per note.
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        click(cellFor(m, MAR14));
        click(button(m, "＋ Add note"));
        editorText(m)!.value = "Release 4.2 shipped";
        editorText(m)!.dispatchEvent(new Event("input"));

        expect(callouts(m)).toHaveLength(0);            // nothing covering the grid
        expect(markers(m).length).toBeGreaterThan(0);   // but the day IS flagged

        // Opting in draws the callout.
        click(button(m, "Text + arrow"));
        expect(calloutText(m).join()).toContain("Release 4.2 shipped");
    });

    it("renders a persisted note when the host hands it back", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");
        expect(m.host.__lastFailure).toBeUndefined();
    });

    it("re-opens the editor when an existing callout is clicked", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        expect(editorText(m)).toBeNull();

        click(callouts(m)[0]!);
        expect(editorText(m)!.value).toBe("Release 4.2 shipped");
    });

    it("discards a note committed with no text, rather than leaving an invisible marker", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025 }));
        click(cellFor(m, MAR14));
        click(button(m, "＋ Add note"));
        click(button(m, "Done")); // never typed anything

        expect(persistedNotes(m)).toEqual([]);
        expect(callouts(m)).toHaveLength(0);
    });

    it("deletes a note", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        click(callouts(m)[0]!);
        click(button(m, "Delete"));

        const stored = persistedNotes(m)!;
        expect(stored.map(n => n.id)).toEqual(["n2"]); // n1 gone, n2 untouched
    });
});

describe("dragging a callout off the grid", () => {
    /** A note whose callout is actually drawn (marker-only notes have no box). */
    const WITH_CALLOUT = [{ ...SAMPLE_NOTES[0]!, mode: "arrow" as const }];

    const drag = (el: Element, fromX: number, fromY: number, toX: number, toY: number) => {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: fromX, clientY: fromY }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: toX, clientY: toY }));
        window.dispatchEvent(new MouseEvent("mouseup", {}));
    };

    it("moves the box and persists the new offset in CELL-SIZE units", () => {
        // Pixel offsets would drift on every resize (planChrome rescales the cells),
        // so the stored offset is normalized by cell size. Dragging 60px right with
        // ~12px cells must therefore store ~+5 cells, not +60.
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: WITH_CALLOUT }));
        const before = SAMPLE_NOTES[0]!.dx;

        drag(callouts(m)[0]!, 200, 200, 260, 200);

        const stored = persistedNotes(m)!;
        expect(stored).toHaveLength(1);
        expect(stored[0]!.dx).toBeGreaterThan(before);
        // 60px moved, cells are well under 60px wide → the delta is a handful of cell
        // widths, nowhere near 60. This is the assertion that fails if someone
        // "simplifies" the offset back into pixels.
        expect(stored[0]!.dx - before).toBeLessThan(30);
        expect(stored[0]!.dy).toBe(SAMPLE_NOTES[0]!.dy); // vertical untouched
    });

    it("does not open the editor when the click came from a drag", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: WITH_CALLOUT }));

        const box = callouts(m)[0]!;
        box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200, clientY: 200 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 260, clientY: 240 }));
        window.dispatchEvent(new MouseEvent("mouseup", {}));
        click(box); // the click the browser fires at the end of a drag

        expect(editorText(m)).toBeNull();
    });

    it("treats a click with a few px of jitter as a click, not a drag", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: WITH_CALLOUT }));

        const box = callouts(m)[0]!;
        box.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 200, clientY: 200 }));
        window.dispatchEvent(new MouseEvent("mousemove", { clientX: 201, clientY: 200 })); // hand tremor
        window.dispatchEvent(new MouseEvent("mouseup", {}));
        click(box);

        expect(editorText(m)).not.toBeNull();     // the editor still opens
        expect(persistedNotes(m)).toBeNull();     // and nothing was persisted
    });

    it("cannot be dragged in Reading view", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: WITH_CALLOUT }), READING);
        drag(callouts(m)[0]!, 200, 200, 300, 300);
        expect(persistedNotes(m)).toBeNull();
    });
});

describe("authoring gate", () => {
    it("does not offer to add a note in Reading view", () => {
        // persistProperties writes visual METADATA, which only survives a report save,
        // which needs edit rights. A consumer's note would silently vanish on refresh —
        // so we never invite them to type one.
        const m = mount();
        render(m, buildDataView({ year: 2025 }), READING);

        click(cellFor(m, MAR14));
        expect(hasButton(m, "＋ Add note")).toBe(false);
        expect(editorText(m)).toBeNull();
    });

    it("still SHOWS existing notes in Reading view — consumers read, they just can't write", () => {
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }), READING);
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");
        // ...and clicking one cannot open the editor.
        click(callouts(m)[0]!);
        expect(editorText(m)).toBeNull();
    });
});

describe("the store is not a setting", () => {
    it("the gear's Reset does not destroy annotations", () => {
        // THE regression this whole design exists to prevent. SettingsOverlay.reset()
        // fires removeObject over every card in the formatting model. If the note store
        // lived on a card, a user resetting their COLORS would silently delete every
        // note they had written. It lives in a capabilities object with no Card, so
        // Reset cannot see it.
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        expect(callouts(m).length).toBeGreaterThan(0);

        (m.visual as any).toolbar.reset();

        const wiped = m.persisted
            .flatMap(p => (p as { removeObject?: { objectName: string }[] }).removeObject ?? [])
            .map(o => o.objectName);
        expect(wiped.length).toBeGreaterThan(0);      // Reset really did fire...
        expect(wiped).not.toContain("notesStore");    // ...and spared the notes.

        (m.visual as any).rerenderFromSettings();
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");
    });

    it("keeps the note store out of the formatting model entirely", () => {
        // The note TEXT is never a formatting slice — it's authored in the editor. The
        // Annotations card holds display preferences and nothing else.
        const model = new VisualFormattingSettingsModel();
        const slices = (model.annotations as unknown as { slices: { name: string }[] }).slices.map(s => s.name);
        expect(slices).toEqual(["show", "markerStyle", "markerIcon", "markerColor", "defaultMode"]);
        expect((model.cards as { name: string }[]).map(c => c.name)).not.toContain("notesStore");
    });
});

describe("survives the things that break selectionId-keyed state", () => {
    it("re-attaches to the same day after a data refresh that reshuffles rows", () => {
        // Selection ids here are built from a row index into the date category, and are
        // null for no-data days. Keying notes by them would lose the note the moment the
        // model refreshed. ISO date is immune: the 14th of March is the 14th of March.
        const m = mount();
        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");

        // A refresh with different columns bound → different row indices, different
        // selection ids, different gaps.
        render(m, buildDataView({
            year: 2025, notes: SAMPLE_NOTES, withTarget: true, withTooltip: true, gapRate: 0.3,
        }));
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");
        expect(m.host.__lastFailure).toBeUndefined();
    });

    it("keeps — but does not draw — a note whose day is outside the rendered window", () => {
        // A filter that hides the day must not garbage-collect the author's note.
        const m = mount();
        render(m, buildDataView({ year: 2024, notes: SAMPLE_NOTES })); // notes are 2025
        expect(callouts(m)).toHaveLength(0);
        expect(m.host.__lastFailure).toBeUndefined();

        render(m, buildDataView({ year: 2025, notes: SAMPLE_NOTES }));
        expect(calloutText(m).join(" ")).toContain("Release 4.2 shipped");
    });

    it("does not blank the visual on a corrupt store", () => {
        const m = mount();
        const dv: any = buildDataView({ year: 2025 });
        dv.metadata.objects = { notesStore: { data: "{ not json at all" } };
        render(m, dv);

        expect(m.host.__lastFailure).toBeUndefined();
        expect(m.el.querySelectorAll("rect.cell").length).toBeGreaterThan(0);
        expect(callouts(m)).toHaveLength(0);
    });
});
