"use strict";

/**
 * Dates in the report's language (zentrix-qa#19) — month and weekday names on the axes,
 * the day card, the Table and the Insight page, and the medium date ("Jan 17, 2025" /
 * "17.01.2025"). Numbers already follow `host.locale` through render/format.ts; this is
 * the date half. Pure `Intl`, no Power BI dependency, so `model/` can use it.
 *
 * State is set once per update (`setDateLocale(host.locale)`, next to setFormatLocale);
 * each visual instance runs in its own iframe. en-US output is identical to the strings
 * the visual used before, so a US report does not change.
 *
 * Sentences (Insight narratives, "Less / More") stay English: translating UI text is the
 * separate Localizations backlog item.
 */

let locale = "en-US";
const cache = new Map<string, string[]>();
let mediumFmt: Intl.DateTimeFormat | null = null;
let longFmt: Intl.DateTimeFormat | null = null;

/** Anything Intl rejects falls back to en-US. */
export function setDateLocale(next: string | undefined): void {
    let ok = "en-US";
    try { if (next) { new Intl.DateTimeFormat(next); ok = next; } } catch { ok = "en-US"; }
    if (ok === locale) return;
    locale = ok;
    cache.clear();
    mediumFmt = longFmt = null;
}

/** The active date locale (for tests and the few callers that format their own). */
export function dateLocale(): string { return locale; }

function names(kind: string, make: (fmt: Intl.DateTimeFormat) => string[], opts: Intl.DateTimeFormatOptions): string[] {
    let out = cache.get(kind);
    if (!out) { out = make(new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" })); cache.set(kind, out); }
    return out;
}
// UTC anchors, so a local timezone can never shift a name onto the neighbouring day.
const months = (fmt: Intl.DateTimeFormat) => Array.from({ length: 12 }, (_, m) => fmt.format(Date.UTC(2021, m, 15)));
// 2021-01-03 was a Sunday → index 0 = Sunday, matching Date#getDay().
const weekdays = (fmt: Intl.DateTimeFormat) => Array.from({ length: 7 }, (_, d) => fmt.format(Date.UTC(2021, 0, 3 + d)));

/** "Jan" … "Dec" (de: "Jan." … "Dez."), indexed by Date#getMonth(). */
export const monthShort = (m: number): string => names("ms", months, { month: "short" })[m];
/** "January" … (de: "Januar" …). */
export const monthLong = (m: number): string => names("ml", months, { month: "long" })[m];
/** "Sun" … "Sat" (de: "So." … "Sa."), indexed by Date#getDay(). */
export const weekdayShort = (d: number): string => names("ws", weekdays, { weekday: "short" })[d];
/** "Sunday" … (de: "Sonntag" …). */
export const weekdayLong = (d: number): string => names("wl", weekdays, { weekday: "long" })[d];

/** "Jan 17, 2025" (de-DE "17.01.2025") — the calendar's short, unambiguous date. */
export function dateMedium(d: Date): string {
    if (!mediumFmt) mediumFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
    return mediumFmt.format(d);
}

/** "Friday, January 17, 2025" (de-DE "Freitag, 17. Januar 2025") — screen-reader labels. */
export function dateLong(d: Date): string {
    if (!longFmt) longFmt = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
    return longFmt.format(d);
}
