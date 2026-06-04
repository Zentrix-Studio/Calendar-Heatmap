import { enumerateDays, weekdayRow, layout, monthLabels } from "../src/model/dateGrid";

describe("enumerateDays", () => {
    test("full non-leap year is 365 days", () => {
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 11, 31));
        expect(days.length).toBe(365);
    });

    test("leap year is 366 days and includes Feb 29", () => {
        const days = enumerateDays(new Date(2024, 0, 1), new Date(2024, 11, 31));
        expect(days.length).toBe(366);
        const hasLeap = days.some(d => d.getMonth() === 1 && d.getDate() === 29);
        expect(hasLeap).toBe(true);
    });

    test("single day range yields one day", () => {
        const days = enumerateDays(new Date(2025, 5, 15), new Date(2025, 5, 15));
        expect(days.length).toBe(1);
    });

    test("spans a DST spring-forward without skipping or duplicating days", () => {
        // US DST 2025 starts Sun Mar 9. Walking calendar days must stay 1-per-day.
        const days = enumerateDays(new Date(2025, 2, 7), new Date(2025, 2, 12));
        const dates = days.map(d => d.getDate());
        expect(dates).toEqual([7, 8, 9, 10, 11, 12]);
    });
});

describe("weekdayRow", () => {
    test("Sunday-start: Sunday is row 0, Saturday row 6", () => {
        expect(weekdayRow(new Date(2025, 0, 5), 0)).toBe(0); // Jan 5 2025 = Sunday
        expect(weekdayRow(new Date(2025, 0, 11), 0)).toBe(6); // Jan 11 = Saturday
    });

    test("Monday-start: Monday is row 0, Sunday row 6", () => {
        expect(weekdayRow(new Date(2025, 0, 6), 1)).toBe(0); // Jan 6 2025 = Monday
        expect(weekdayRow(new Date(2025, 0, 5), 1)).toBe(6); // Sunday -> row 6
    });
});

describe("layout", () => {
    test("first day anchors column 0 even mid-week", () => {
        // Jan 1 2025 is a Wednesday. Sunday-start => row 3, still col 0.
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 0, 20));
        const { rows, cols } = layout(days, 0);
        expect(rows[0]).toBe(3);
        expect(cols[0]).toBe(0);
    });

    test("column increments when the first weekday is reached", () => {
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 0, 20));
        const { cols } = layout(days, 0);
        // Jan 5 (Sunday) is the first new-week boundary -> col 1.
        const jan5Index = days.findIndex(d => d.getDate() === 5);
        expect(cols[jan5Index]).toBe(1);
        expect(cols[jan5Index - 1]).toBe(0); // Jan 4 still col 0
    });

    test("full 2025 Sunday-start spans 53 week columns", () => {
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 11, 31));
        const { weeks } = layout(days, 0);
        expect(weeks).toBe(53);
    });

    test("empty input yields zero weeks", () => {
        expect(layout([], 0)).toEqual({ rows: [], cols: [], weeks: 0 });
    });
});

describe("monthLabels", () => {
    test("full year yields 12 labels, Jan at col 0", () => {
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 11, 31));
        const { cols } = layout(days, 0);
        const labels = monthLabels(days, cols);
        expect(labels.length).toBe(12);
        expect(labels[0]).toEqual({ label: "Jan", col: 0 });
        expect(labels[11].label).toBe("Dec");
    });

    test("labels are monotonically non-decreasing in column", () => {
        const days = enumerateDays(new Date(2025, 0, 1), new Date(2025, 11, 31));
        const { cols } = layout(days, 0);
        const labels = monthLabels(days, cols);
        for (let i = 1; i < labels.length; i++) {
            expect(labels[i].col).toBeGreaterThanOrEqual(labels[i - 1].col);
        }
    });

    test("range crossing a year boundary keeps months in order", () => {
        const days = enumerateDays(new Date(2024, 10, 15), new Date(2025, 1, 15));
        const { cols } = layout(days, 0);
        const labels = monthLabels(days, cols);
        expect(labels.map(l => l.label)).toEqual(["Nov", "Dec", "Jan", "Feb"]);
    });
});
