import { buildFacetedModel } from "../src/model/dataTransform";

/** Minimal IVisualHost stub — selection IDs are opaque in these assertions. */
const host: any = {
    createSelectionIdBuilder: () => ({
        withCategory: () => ({ createSelectionId: () => ({}) }),
    }),
};

const D = (m: number, d: number) => new Date(2025, m, d);

/** Build a categorical DataView with date + value and an optional highlights[]. */
function makeDataView(opts: {
    dates: Date[]; values: number[]; highlights?: (number | null)[];
}): any {
    const valueCol: any = { source: { roles: { value: true }, displayName: "Sales" }, values: opts.values };
    if (opts.highlights) valueCol.highlights = opts.highlights;
    return {
        categorical: {
            categories: [{ source: { roles: { date: true }, displayName: "Date" }, values: opts.dates }],
            values: [valueCol],
        },
    };
}

describe("supportsHighlight — consuming values[].highlights[]", () => {
    test("no highlights array → cells carry no highlight fields (normal render)", () => {
        const dv = makeDataView({ dates: [D(0, 1), D(0, 2), D(0, 3)], values: [10, 20, 30] });
        const m = buildFacetedModel(dv, host, 0, "sum")!.combined;
        expect(m.hasHighlights).toBeFalsy();
        for (const d of m.days) {
            expect(d.highlightValue).toBeUndefined();
            expect(d.isHighlighted).toBeUndefined();
        }
    });

    test("highlights array present → flags highlighted vs dimmed days", () => {
        // Jan2 highlighted (20), Jan1/Jan3 not part of the highlight (null/0).
        const dv = makeDataView({
            dates: [D(0, 1), D(0, 2), D(0, 3)],
            values: [10, 20, 30],
            highlights: [null, 20, 0],
        });
        const m = buildFacetedModel(dv, host, 0, "sum")!.combined;
        expect(m.hasHighlights).toBe(true);
        const byDay = new Map(m.days.filter(d => !d.noData).map(d => [d.date.getTime(), d]));
        expect(byDay.get(D(0, 1).getTime())!.isHighlighted).toBe(false); // null highlight
        expect(byDay.get(D(0, 2).getTime())!.isHighlighted).toBe(true);  // 20
        expect(byDay.get(D(0, 3).getTime())!.isHighlighted).toBe(false); // 0 highlight
        expect(byDay.get(D(0, 2).getTime())!.highlightValue).toBe(20);
        expect(byDay.get(D(0, 1).getTime())!.highlightValue).toBeNull();
    });

    test("highlights aggregate per day with the same mode as values", () => {
        // Two rows on Jan1; sum mode → highlight 5+7=12.
        const dv = makeDataView({
            dates: [D(0, 1), D(0, 1)],
            values: [10, 20],
            highlights: [5, 7],
        });
        const m = buildFacetedModel(dv, host, 0, "sum")!.combined;
        const jan1 = m.days.find(d => !d.noData && d.date.getTime() === D(0, 1).getTime())!;
        expect(jan1.highlightValue).toBe(12);
        expect(jan1.isHighlighted).toBe(true);
    });
});
