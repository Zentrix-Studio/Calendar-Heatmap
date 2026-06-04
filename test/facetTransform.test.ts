import { buildFacetedModel } from "../src/model/dataTransform";

/** Minimal IVisualHost stub — selection IDs are opaque in these assertions. */
const host: any = {
    createSelectionIdBuilder: () => ({
        withCategory: () => ({ createSelectionId: () => ({}) }),
    }),
};

const D = (m: number, d: number) => new Date(2025, m, d);

/** Build a categorical DataView with date, value, and optional category/target. */
function makeDataView(opts: {
    dates: Date[]; values: number[]; categories?: string[]; targets?: number[];
}): any {
    const categories: any[] = [
        { source: { roles: { date: true }, displayName: "Date" }, values: opts.dates },
    ];
    if (opts.categories) {
        categories.push({ source: { roles: { category: true }, displayName: "Region" }, values: opts.categories });
    }
    const values: any[] = [
        { source: { roles: { value: true }, displayName: "Sales" }, values: opts.values },
    ];
    if (opts.targets) {
        values.push({ source: { roles: { target: true }, displayName: "Goal" }, values: opts.targets });
    }
    return { categorical: { categories, values } };
}

describe("buildFacetedModel — single grid (no Split-by)", () => {
    const dv = makeDataView({ dates: [D(0, 1), D(0, 2), D(0, 3)], values: [10, 20, 30] });
    const res = buildFacetedModel(dv, host, 0, "sum")!;

    test("returns one facet whose model is the combined rollup", () => {
        expect(res.facets).toHaveLength(1);
        expect(res.facets[0].model).toBe(res.combined);
        expect(res.totalCategories).toBe(1);
        expect(res.categoryName).toBeUndefined();
    });

    test("shared domain matches the combined value extent", () => {
        expect(res.sharedDomain).toEqual([10, 30]);
    });
});

describe("buildFacetedModel — split by category", () => {
    // A: Jan1=10, Jan3=30 ; B: Jan2=20, Jan4=40 — over a shared Jan1–Jan4 grid.
    const dv = makeDataView({
        dates: [D(0, 1), D(0, 2), D(0, 3), D(0, 4)],
        values: [10, 20, 30, 40],
        categories: ["A", "B", "A", "B"],
    });
    const res = buildFacetedModel(dv, host, 0, "sum")!;

    test("one facet per distinct category, in first-seen order", () => {
        expect(res.facets.map(f => f.key)).toEqual(["A", "B"]);
        expect(res.categoryName).toBe("Region");
        expect(res.totalCategories).toBe(2);
    });

    test("panels share the same synthesized date grid", () => {
        const lens = res.facets.map(f => f.model.days.length);
        expect(lens[0]).toBe(lens[1]);
        expect(lens[0]).toBe(4); // Jan 1..4 inclusive
    });

    test("each panel only carries its own category's values", () => {
        const a = res.facets[0].model.days.filter(d => !d.noData).map(d => d.value);
        const b = res.facets[1].model.days.filter(d => !d.noData).map(d => d.value);
        expect(a.sort((x, y) => x - y)).toEqual([10, 30]);
        expect(b.sort((x, y) => x - y)).toEqual([20, 40]);
    });

    test("cells are stamped with their facet key/index", () => {
        expect(res.facets[0].model.days.every(d => d.facetKey === "A" && d.facetIndex === 0)).toBe(true);
        expect(res.facets[1].model.days.every(d => d.facetKey === "B" && d.facetIndex === 1)).toBe(true);
    });

    test("shared color domain spans every panel; per-panel domains differ", () => {
        expect(res.sharedDomain).toEqual([10, 40]);
        expect(res.facets[0].model.valueDomain).toEqual([10, 30]);
        expect(res.facets[1].model.valueDomain).toEqual([20, 40]);
    });

    test("combined rollup aggregates across categories per day", () => {
        const byDay = new Map(res.combined.days.filter(d => !d.noData).map(d => [d.date.getTime(), d.value]));
        expect(byDay.get(D(0, 1).getTime())).toBe(10);
        expect(byDay.get(D(0, 4).getTime())).toBe(40);
    });
});

describe("buildFacetedModel — target per facet", () => {
    const dv = makeDataView({
        dates: [D(0, 1), D(0, 2)],
        values: [10, 20],
        categories: ["A", "B"],
        targets: [8, 25],
    });
    const res = buildFacetedModel(dv, host, 0, "sum")!;

    test("target is attached to the right facet's day", () => {
        const a = res.facets[0].model.days.find(d => !d.noData)!;
        const b = res.facets[1].model.days.find(d => !d.noData)!;
        expect(a.target).toBe(8);
        expect(b.target).toBe(25);
        expect(res.combined.targetName).toBe("Goal");
    });
});
