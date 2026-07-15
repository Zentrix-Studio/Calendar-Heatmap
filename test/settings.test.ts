/**
 * Z-137 §1 — the Colors card must only surface the pickers that apply to the
 * current palette type, so the native Format pane never shows an inert control.
 * The formatting service calls onPreProcess() before populating the card; we call
 * it directly here and assert each slice's `.visible` flag.
 */
import { VisualFormattingSettingsModel } from "../src/settings";

type Colors = VisualFormattingSettingsModel["colors"];

function visibilityFor(mode: string): Record<string, boolean | undefined> {
    const m = new VisualFormattingSettingsModel();
    const c: Colors = m.colors;
    c.paletteMode.value = { value: mode, displayName: mode };
    c.onPreProcess();
    return {
        ramp: c.ramp.visible, start: c.startColor.visible, end: c.endColor.visible,
        low: c.splitLow.visible, mid: c.splitMid.visible, high: c.splitHigh.visible,
        noData: c.noDataColor.visible, scale: c.scaleMode.visible, buckets: c.bucketCount.visible,
    };
}

describe("Colors card conditional visibility (Z-137 §1)", () => {
    test("ramp mode shows only the preset", () => {
        const v = visibilityFor("ramp");
        expect(v.ramp).toBe(true);
        expect(v.start).toBe(false);
        expect(v.end).toBe(false);
        expect(v.low).toBe(false);
    });

    test("split mode shows exactly the three split pickers, hides ramp/start/end", () => {
        const v = visibilityFor("split");
        expect(v.low).toBe(true); expect(v.mid).toBe(true); expect(v.high).toBe(true);
        expect(v.ramp).toBe(false); expect(v.start).toBe(false); expect(v.end).toBe(false);
    });

    test("duotone mode shows start + end, hides ramp/split", () => {
        const v = visibilityFor("duotone");
        expect(v.start).toBe(true); expect(v.end).toBe(true);
        expect(v.ramp).toBe(false); expect(v.low).toBe(false);
    });

    test("mono and theme show the single hue (start) only", () => {
        for (const mode of ["mono", "theme"]) {
            const v = visibilityFor(mode);
            expect(v.start).toBe(true);
            expect(v.end).toBe(false);
            expect(v.ramp).toBe(false);
            expect(v.low).toBe(false);
        }
    });

    test("no-data / scale / buckets are always shown regardless of mode", () => {
        for (const mode of ["mono", "ramp", "duotone", "split", "theme"]) {
            const v = visibilityFor(mode);
            // these aren't toggled, so they stay undefined (= shown) — assert never hidden.
            expect(v.noData).not.toBe(false);
            expect(v.scale).not.toBe(false);
            expect(v.buckets).not.toBe(false);
        }
    });
});

describe("Cells card row/column gap split (Z-137 §3)", () => {
    test("default gaps are 3/3 and the old single cellGap is gone", () => {
        const m = new VisualFormattingSettingsModel();
        expect(m.cells.cellGapX.value).toBe(3);
        expect(m.cells.cellGapY.value).toBe(3);
        expect((m.cells as unknown as { cellGap?: unknown }).cellGap).toBeUndefined();
    });
});
