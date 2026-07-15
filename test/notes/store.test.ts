/**
 * Z-152 — the annotation store.
 *
 * Two halves, tested together:
 *   - `src/notes/core.ts`  — the MIRROR of @zentrix/visual-annotations. Generic: it
 *     knows a Note has an opaque `anchor` string, and nothing about calendars.
 *   - `src/notes/store.ts` — the calendar-specific half: how a DayCell becomes an
 *     anchor. This is the one thing the shared package deliberately cannot own.
 *
 * The blob is report JSON: it can be stale, hand-edited, or written by an older
 * build. Much of this is about that untrusted boundary — a bad blob must degrade to
 * "no annotations", never to a thrown exception (update() would catch it and paint
 * the error fallback, blanking the whole visual over a decoration layer).
 */
import {
    NoteStore, parseStore, isoDate, anchorFor, cellNoteKey, MAX_NOTES, MAX_TEXT,
} from "../../src/notes/store";
import type { Note } from "../../src/notes/core";
import type { DayCell } from "../../src/types";

const MAR14 = "2025-03-14|";

const note = (over: Partial<Note> = {}): Note => ({
    id: "n1", anchor: MAR14, text: "Release shipped",
    mode: "arrow", style: {}, dx: 1.6, dy: -2.4, ...over,
});

const cell = (date: Date, facetKey?: string): DayCell => ({
    date, value: 1, noData: false, col: 0, row: 0,
    selectionId: null, sourceIndex: 0, facetKey,
});

const blob = (items: unknown[]) => JSON.stringify({ v: 1, items });

describe("anchoring (the calendar-specific half)", () => {
    it("keys a day by LOCAL ISO date, not UTC", () => {
        // A UTC-based key (toISOString) would render midnight-local 1 Jan as
        // "2024-12-31" everywhere east of Greenwich — silently hanging every
        // annotation on the wrong day for half the world.
        expect(isoDate(new Date(2025, 0, 1))).toBe("2025-01-01");
        expect(isoDate(new Date(2025, 11, 31))).toBe("2025-12-31");
    });

    it("puts the DATE first so markers number chronologically", () => {
        // NoteStore.ordered() sorts by the raw anchor string, so date-first is what
        // makes the on-grid markers count 1, 2, 3… in calendar order.
        expect(anchorFor(new Date(2025, 2, 14), "North")).toBe("2025-03-14|North");
        const store = new NoteStore();
        store.upsert(note({ id: "b", anchor: anchorFor(new Date(2025, 5, 20)) }));
        store.upsert(note({ id: "a", anchor: anchorFor(new Date(2025, 2, 14)) }));
        expect(store.ordered().map(n => n.id)).toEqual(["a", "b"]);
    });

    it("namespaces the anchor by facet so small multiples don't collide", () => {
        const a = cellNoteKey(cell(new Date(2025, 2, 14), "North"));
        const b = cellNoteKey(cell(new Date(2025, 2, 14), "South"));
        expect(a).not.toEqual(b);
    });

    it("resolves a note onto a cell by date, independent of row order or index", () => {
        const s = new NoteStore();
        s.load(blob([note()]));
        // The cell carries no id and no source index — only its date. That is the
        // whole point: a data refresh reshuffles indices and selection ids, but the
        // 14th of March is still the 14th of March.
        expect(s.get(cellNoteKey(cell(new Date(2025, 2, 14))))?.text).toBe("Release shipped");
        expect(s.get(cellNoteKey(cell(new Date(2025, 2, 15))))).toBeUndefined();
    });
});

describe("parsing an untrusted blob", () => {
    it("degrades to empty rather than throwing", () => {
        for (const bad of ["", "   ", "not json", "[]", "null", "{}", '{"items":"nope"}', undefined, 42]) {
            expect(() => parseStore(bad)).not.toThrow();
            expect(parseStore(bad).items).toEqual([]);
        }
    });

    it("drops entries with no anchor or no id", () => {
        const got = parseStore(blob([
            note({ id: "a" }),
            note({ id: "b", anchor: "" }),
            { id: "c", text: "no anchor at all" },
            { anchor: "2025-01-01|", text: "no id" },
        ]));
        expect(got.items.map(n => n.id)).toEqual(["a"]);
    });

    it("clamps text length and rejects colors that aren't colors", () => {
        const got = parseStore(blob([note({
            text: "x".repeat(MAX_TEXT + 500),
            style: { color: "javascript:alert(1)", bg: "#0072B2", size: 9999 },
        })]));
        const n = got.items[0]!;
        expect(n.text.length).toBe(MAX_TEXT);
        expect(n.style.color).toBeUndefined(); // not a color → dropped, not passed through
        expect(n.style.bg).toBe("#0072B2");
        expect(n.style.size).toBe(32);         // clamped to the sane range
    });

    it("falls back to the least intrusive mode when the stored one is unknown", () => {
        // A marker cannot cover the grid; a callout can. Unknown → marker.
        const n = parseStore(blob([note({ mode: "explode" as never })])).items[0]!;
        expect(n.mode).toBe("marker");
    });

    it("caps the store, so a huge blob can't bloat the report JSON", () => {
        const many = Array.from({ length: MAX_NOTES + 50 }, (_, i) =>
            note({ id: `n${i}`, anchor: `2025-01-01|f${i}` }));
        expect(parseStore(blob(many)).items.length).toBe(MAX_NOTES);
    });

    it("de-duplicates two notes claiming the same anchor", () => {
        const got = parseStore(blob([
            note({ id: "a", text: "first" }),
            note({ id: "b", text: "second, same day" }),
        ]));
        expect(got.items).toHaveLength(1);
        expect(got.items[0]!.text).toBe("first");
    });
});

describe("mutation + serialization", () => {
    it("round-trips through JSON without losing style or offsets", () => {
        const s = new NoteStore();
        const original = note({ style: { bold: true, size: 14, color: "#0072B2" }, dx: 3, dy: -1 });
        s.upsert(original);

        const reloaded = new NoteStore();
        reloaded.load(s.toJSON());
        expect(reloaded.get(MAR14)).toEqual(original);
    });

    it("upsert replaces by anchor, so one day can never hold two notes", () => {
        const s = new NoteStore();
        s.upsert(note({ id: "n1", text: "first" }));
        s.upsert(note({ id: "n2", text: "rewritten" }));
        expect(s.count()).toBe(1);
        expect(s.get(MAR14)?.text).toBe("rewritten");
    });

    it("mints ids from the existing high-water mark, not a clock or RNG", () => {
        // Deterministic ids keep the persisted blob diffable and the tests honest.
        const s = new NoteStore();
        s.load(blob([note({ id: "n1" }), note({ id: "n7", anchor: "2025-04-01|" })]));
        expect(s.create("2025-06-01|", "arrow").id).toBe("n8");
    });

    it("stops accepting new notes at the cap but still allows editing existing ones", () => {
        const s = new NoteStore();
        s.load(blob(Array.from({ length: MAX_NOTES }, (_, i) =>
            note({ id: `n${i}`, anchor: `2025-03-14|f${i}` }))));
        expect(s.isFull()).toBe(true);

        s.upsert(note({ id: "n0", anchor: "2025-03-14|f0", text: "edited" }));
        expect(s.count()).toBe(MAX_NOTES);
        expect(s.get("2025-03-14|f0")?.text).toBe("edited");

        s.upsert(note({ id: "new", anchor: "2025-09-09|brand new" }));
        expect(s.count()).toBe(MAX_NOTES); // rejected — the cap holds
    });
});
