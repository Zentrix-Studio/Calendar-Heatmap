/*
 * Synthetic categorical DataView builder. Produces the same role-tagged shape
 * Power BI hands the visual, so the real buildFacetedModel/parseDataView path
 * runs unchanged. Deterministic (seeded) so snapshots are stable.
 */
"use strict";

import powerbi from "powerbi-visuals-api";
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
}

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

    return {
        metadata: { columns: metaColumns, objects: undefined },
        categorical: { categories, values: valuesCols },
    } as unknown as DataView;
}
