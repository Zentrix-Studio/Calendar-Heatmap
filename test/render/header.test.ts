/**
 * @jest-environment jsdom
 *
 * Regression guard for the KPI header. The header band is a fixed 42px strip at
 * the very top of the visual; its text is positioned by hand-tuned `y` baselines.
 * A previous build placed the eyebrow labels at y=8, so a 10px font's ascenders
 * were sliced by the viewport's top edge ("Peak day" rendered as "Peak uay").
 * The settings sweep only stores a structural signature, so it never caught this —
 * this test asserts the actual baseline geometry stays inside the safe band.
 */
import "../harness/svgPolyfill";
import { select } from "d3";
import { renderHeader } from "../../src/render/header";
import { defaultText } from "../../src/render/text";
import { CalendarModel } from "../../src/types";

const HEADER_H = 42; // mirrors visual.ts — content must stay within this band

function mockModel(): CalendarModel {
    const days = [];
    for (let i = 0; i < 60; i++) {
        days.push({
            date: new Date(2025, 8, i + 1), value: (i % 7) * 4 + 1,
            noData: false, col: 0, row: 0, selectionId: null, sourceIndex: i,
        });
    }
    return { days, valueName: "SLA Breaches" } as unknown as CalendarModel;
}

/** Render the header into a throwaway SVG and return every text node's baseline + content. */
function renderHeaderTexts(): { y: number; text: string }[] {
    const svg = select(document.body).append("svg");
    const g = svg.append("g");
    renderHeader(g as any, mockModel(), {
        width: 600, title: "Sum of SLA Breaches", align: "left",
        headline: defaultText(13), stat: defaultText(12),
        ruleShow: true, ruleColor: "#7C5CFF", ruleWidth: 2,
        textColor: "#1A1A22", mutedColor: "#70707F", showChips: true,
    });
    const out = g.selectAll<SVGTextElement, unknown>("text").nodes()
        .map(n => ({ y: +(n.getAttribute("y") ?? "0"), text: n.textContent ?? "" }));
    svg.remove();
    return out;
}

describe("KPI header — top padding (no clipping)", () => {
    test("the topmost text baseline clears the top edge so ascenders aren't sliced", () => {
        const ys = renderHeaderTexts().map(t => t.y);
        expect(ys.length).toBeGreaterThan(0);
        // Smallest font is the 10px eyebrow ("Total"/"Peak day"); pre-fix this was 8
        // (clipped). Require >= 11 so ~10px of cap/ascender clears y=0.
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(11);
    });

    test("header text stays within the reserved 42px band", () => {
        expect(Math.max(...renderHeaderTexts().map(t => t.y))).toBeLessThanOrEqual(HEADER_H);
    });
});

describe("KPI header — peak-day chip", () => {
    test("uses a pipe separator and includes the year (unambiguous across years)", () => {
        // The peak-day value line is the one carrying a 4-digit year.
        const peak = renderHeaderTexts().map(t => t.text).find(t => /\b\d{4}\b/.test(t));
        expect(peak).toBeDefined();
        expect(peak).toContain("|");        // pipe separator, not "·"
        expect(peak).not.toContain("·");
        expect(peak).toMatch(/\b20\d{2}\b/); // year present (locale-robust)
    });
});

/** Render the header with align=right and return all text nodes as {x, y, text, anchor}. */
function renderHeaderRightAlign(): { x: number; text: string; anchor: string | null }[] {
    const svg = select(document.body).append("svg");
    const g = svg.append("g");
    const WIDTH = 600;
    renderHeader(g as any, mockModel(), {
        width: WIDTH, title: "Sum of SLA Breaches", align: "right",
        headline: defaultText(13), stat: defaultText(12),
        ruleShow: false, ruleColor: "#7C5CFF", ruleWidth: 2,
        textColor: "#1A1A22", mutedColor: "#70707F", showChips: true,
    });
    const out = g.selectAll<SVGTextElement, unknown>("text").nodes()
        .map(n => ({
            x: +(n.getAttribute("x") ?? "0"),
            text: n.textContent ?? "",
            anchor: n.getAttribute("text-anchor"),
        }));
    svg.remove();
    return out;
}

describe("KPI header — right-align no overlap (B3.1)", () => {
    test("title has text-anchor=end at the right edge (width-2)", () => {
        const WIDTH = 600;
        const nodes = renderHeaderRightAlign();
        const title = nodes.find(n => n.text === "Sum of SLA Breaches");
        expect(title).toBeDefined();
        expect(title!.anchor).toBe("end");
        expect(title!.x).toBe(WIDTH - 2);
    });

    test("chip block starts from the left (x ≈ 2, no chip x > width/2)", () => {
        const WIDTH = 600;
        const nodes = renderHeaderRightAlign();
        // Chips are the non-title text nodes (labels + values).
        const chips = nodes.filter(n => n.text !== "Sum of SLA Breaches");
        expect(chips.length).toBeGreaterThan(0);
        // All chips must start well to the left so they don't reach the right-anchored title.
        // At align=right: chips start at cx=2 and grow rightward.
        const minX = Math.min(...chips.map(c => c.x));
        expect(minX).toBeGreaterThanOrEqual(2);
        // No chip should overlap the right half where the title lives.
        const maxX = Math.max(...chips.map(c => c.x));
        expect(maxX).toBeLessThan(WIDTH / 2);
    });
});
