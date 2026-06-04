"use strict";

/**
 * Pure calendar geometry — no Power BI dependencies, fully unit-testable.
 *
 * Coordinate model (GitHub-style): each day maps to (row, col) where
 *   row = weekday index 0..6 ordered by the configured first-day-of-week,
 *   col = week index, incremented every time a day lands on the first weekday.
 * Columns are assigned by walking consecutive calendar days (never by ms math),
 * so DST transitions and leap days can't drift the grid.
 */

const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Row index 0..6 for a date, given the first day of week (0=Sun..6=Sat). */
export function weekdayRow(date: Date, firstDayOfWeek: number): number {
    return (date.getDay() - firstDayOfWeek + 7) % 7;
}

/**
 * Every local calendar day in [min, max] inclusive.
 * Increments via setDate so 23h/25h DST days and Feb 29 are preserved exactly.
 */
export function enumerateDays(min: Date, max: Date): Date[] {
    const days: Date[] = [];
    const cursor = new Date(min.getFullYear(), min.getMonth(), min.getDate());
    const end = new Date(max.getFullYear(), max.getMonth(), max.getDate());
    while (cursor <= end) {
        days.push(new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()));
        cursor.setDate(cursor.getDate() + 1);
    }
    return days;
}

export interface GridLayout {
    rows: number[];
    cols: number[];
    weeks: number;
}

/**
 * Assign (row, col) to each day in order. `days` must be consecutive ascending
 * calendar days (as produced by enumerateDays). The first partial week is col 0.
 */
export function layout(days: Date[], firstDayOfWeek: number): GridLayout {
    const rows: number[] = [];
    const cols: number[] = [];
    let col = 0;
    for (let i = 0; i < days.length; i++) {
        const row = weekdayRow(days[i], firstDayOfWeek);
        // A new week begins whenever a day falls on the first weekday — except
        // the very first day, which always anchors column 0 even if mid-week.
        if (i > 0 && row === 0) col++;
        rows.push(row);
        cols.push(col);
    }
    return { rows, cols, weeks: days.length ? col + 1 : 0 };
}

export interface MonthLabel {
    label: string;
    col: number;
}

/**
 * One label per month present, anchored to the column of that month's first
 * rendered day (the first week containing the month). Handles partial first/last
 * weeks and year boundaries because it keys on (year, month) in render order.
 */
export function monthLabels(days: Date[], cols: number[]): MonthLabel[] {
    const labels: MonthLabel[] = [];
    let lastKey = "";
    for (let i = 0; i < days.length; i++) {
        const key = `${days[i].getFullYear()}-${days[i].getMonth()}`;
        if (key !== lastKey) {
            labels.push({ label: MONTH_NAMES[days[i].getMonth()], col: cols[i] });
            lastKey = key;
        }
    }
    return labels;
}
