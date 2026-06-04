import { groupByMonth } from "../../src/render/monthBlocks";
import { DayCell } from "../../src/types";

// Minimal DayCell — groupByMonth only reads `.date`; the rest is filler.
function day(year: number, month: number): DayCell {
    return { date: new Date(year, month, 1), value: 1, noData: false, col: 0, row: 0, selectionId: null, sourceIndex: 0 };
}
/** Contiguous run of `count` consecutive months starting at (startY, startM). */
function monthsRun(startY: number, startM: number, count: number): DayCell[] {
    const out: DayCell[] = [];
    for (let i = 0; i < count; i++) {
        const dt = new Date(startY, startM + i, 1);
        out.push(day(dt.getFullYear(), dt.getMonth()));
    }
    return out;
}

describe("month-block labels: year disambiguation", () => {
    test("single-year data is labelled by month name only — no year", () => {
        const labels = groupByMonth(monthsRun(2025, 0, 12)).map(g => g.label);
        expect(labels).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
        expect(labels.some(l => /\d{4}/.test(l))).toBe(false);
    });

    test("multi-year data stamps the year on the first month of each year only", () => {
        const labels = groupByMonth(monthsRun(2024, 0, 24)).map(g => g.label); // Jan 2024 .. Dec 2025
        expect(labels[0]).toBe("Jan 2024");   // first month of 2024
        expect(labels[12]).toBe("Jan 2025");  // first month of 2025
        expect(labels[1]).toBe("Feb");        // mid-year months stay plain
        expect(labels[11]).toBe("Dec");
        expect(labels[13]).toBe("Feb");
        // exactly one year-stamped label per year, and nowhere else
        expect(labels.filter(l => /\d{4}/.test(l))).toEqual(["Jan 2024", "Jan 2025"]);
    });

    test("a range that crosses the year boundary mid-stream still disambiguates", () => {
        // Nov 2024, Dec 2024, Jan 2025, Feb 2025
        const labels = groupByMonth(monthsRun(2024, 10, 4)).map(g => g.label);
        expect(labels).toEqual(["Nov 2024", "Dec", "Jan 2025", "Feb"]);
    });

    test("empty input yields no groups", () => {
        expect(groupByMonth([])).toEqual([]);
    });
});
