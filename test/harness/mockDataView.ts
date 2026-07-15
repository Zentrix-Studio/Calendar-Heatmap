/*
 * Synthetic categorical DataView builder. Produces the same role-tagged shape
 * Power BI hands the visual, so the real buildFacetedModel/parseDataView path
 * runs unchanged. Deterministic (seeded) so snapshots are stable.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import type { Note } from "../../src/notes/core";
type DataView = powerbi.DataView;

/** Deterministic LCG — matches the harness/preview generator so values are stable. */
function seeded(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

export interface DataViewOptions {
    /** Single year (default 2025). Ignored when `years` is set. */
    year?: number;
    /** Multi-year extent [start, end] inclusive — exercises year-tag rendering. */
    years?: [number, number];
    /** Category values for Split-by → faceted small-multiples render. */
    categories?: string[];
    /** Bind a Target measure. */
    withTarget?: boolean;
    /** Bind a Tooltips measure. */
    withTooltip?: boolean;
    /** Fraction of days left blank (no-data cells). Default 0.06. */
    gapRate?: number;
    /**
     * Z-152 — seed the persisted annotation store. Annotations are NOT data-bound:
     * they arrive on `metadata.objects.notesStore.data` as a JSON blob, exactly as
     * the host would hand them back after a persistProperties round-trip.
     *
     * The settings sweep passes notes here so the Annotations card's display prefs
     * are genuinely exercised. Without a seeded note every one of those settings is
     * provably effect-less and would have to be marked smoke-only — coverage that
     * looks green while proving nothing.
     */
    notes?: Note[];
    /**
     * Extra persisted formatting objects, exactly as the host would echo them
     * back on `metadata.objects` after a persistProperties round-trip — e.g.
     * `{ summaryTable: { show: true } }`. Merged with the notes blob.
     */
    objects?: Record<string, Record<string, unknown>>;
}

/**
 * Two notes over 2025, covering both a marker-bearing mode and a callout-only one.
 * `anchor` is the calendar's natural key — `"<ISO date>|<facet>"` (see notes/store.ts).
 */
export const SAMPLE_NOTES: Note[] = [
    {
        id: "n1", anchor: "2025-03-14|", text: "Release 4.2 shipped",
        mode: "all", style: {}, dx: 1.6, dy: -2.4,
    },
    {
        id: "n2", anchor: "2025-06-20|", text: "Incident: queue backlog cleared after the hotfix",
        mode: "arrow", style: { bold: true }, dx: 2, dy: 2,
    },
];

function col(displayName: string, role: string): any {
    return { displayName, roles: { [role]: true }, type: {}, queryName: `q.${displayName}` };
}

/** Build a categorical DataView with a Date category + Value measure (+ options). */
export function buildDataView(opts: DataViewOptions = {}): DataView {
    const [startY, endY] = opts.years ?? [opts.year ?? 2025, opts.year ?? 2025];
    const cats = opts.categories ?? [];
    const gapRate = opts.gapRate ?? 0.06;
    const rnd = seeded(42);

    const dates: Date[] = [];
    const values: (number | null)[] = [];
    const targets: (number | null)[] = [];
    const tooltips: (string | null)[] = [];
    const categoryVals: string[] = [];

    const emit = (date: Date, category?: string) => {
        const noData = rnd() < gapRate;
        const skew = Math.pow(rnd(), 3) * 400;
        const weekend = date.getDay() === 0 || date.getDay() === 6 ? 0.35 : 1;
        const v = noData ? null : Math.round(skew * weekend);
        dates.push(date);
        values.push(v);
        targets.push(v == null ? null : 120);
        tooltips.push(v == null ? null : `note-${date.getDate()}`);
        if (category !== undefined) categoryVals.push(category);
    };

    const groups = cats.length ? cats : [undefined as unknown as string];
    for (const g of groups) {
        for (let y = startY; y <= endY; y++) {
            const start = new Date(y, 0, 1), end = new Date(y, 11, 31);
            for (let d = new Date(start); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
                emit(new Date(d), g);
            }
        }
    }

    const dateCol = col("Date", "date");
    const valueCol = col("Tickets resolved", "value");
    const categories: any[] = [{ source: dateCol, values: dates }];
    const valuesCols: any[] = [{ source: valueCol, values }];
    const metaColumns: any[] = [dateCol, valueCol];

    if (cats.length) {
        const catCol = col("Team", "category");
        categories.push({ source: catCol, values: categoryVals });
        metaColumns.push(catCol);
    }
    if (opts.withTarget) {
        const tCol = col("Target", "target");
        valuesCols.push({ source: tCol, values: targets });
        metaColumns.push(tCol);
    }
    if (opts.withTooltip) {
        const ttCol = col("SLA note", "tooltips");
        valuesCols.push({ source: ttCol, values: tooltips });
        metaColumns.push(ttCol);
    }

    const notesObjects = opts.notes
        ? { notesStore: { data: JSON.stringify({ v: 1, items: opts.notes }) } }
        : undefined;
    const objects = notesObjects || opts.objects
        ? { ...notesObjects, ...opts.objects }
        : undefined;

    return {
        metadata: { columns: metaColumns, objects },
        categorical: { categories, values: valuesCols },
    } as unknown as DataView;
}
