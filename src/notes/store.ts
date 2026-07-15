"use strict";

import type { DayCell } from "../types";

/**
 * The CALENDAR-SPECIFIC half of the annotation system (Z-152).
 *
 * `./core.ts` is a mirror of `@zentrix/visual-annotations` and is generic: it knows
 * about a `Note` with an opaque `anchor` string, and nothing else. THIS file is the
 * one thing the shared package deliberately cannot own — how a calendar day turns
 * into an anchor.
 *
 * Everything else (store, editor, blob format, caps, validation) is shared. Keep it
 * that way: a calendar-shaped assumption leaking into core.ts is what stops the bar
 * and bullet charts from inheriting this.
 */

export * from "./core";

/**
 * Local ISO date, "YYYY-MM-DD".
 *
 * Built from LOCAL date parts on purpose. `Date.toISOString()` is UTC, which would
 * render midnight-local 1 Jan as "2024-12-31" for everyone east of Greenwich — i.e.
 * it would silently hang every annotation on the wrong day for half the world.
 */
export function isoDate(d: Date): string {
    const p = (n: number) => (n < 10 ? "0" : "") + n;
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The anchor key for a calendar day: `"2026-03-14|North"`.
 *
 * Date FIRST so that `NoteStore.ordered()` — which sorts by the raw anchor string —
 * numbers the on-grid markers chronologically, which is the only order that reads
 * sensibly on a calendar. The facet suffix keeps small-multiple panels from colliding
 * on the same date.
 *
 * This is a NATURAL key, not a selectionId. Selection ids here are built from a row
 * index into the date category (`dataTransform.ts`): the index churns on every data
 * refresh, and it is `null` for no-data days — so a selectionId-keyed note could not
 * survive a refresh and could never be attached to an empty day. A calendar's date IS
 * its identity.
 */
export function anchorFor(date: Date, facetKey?: string): string {
    return `${isoDate(date)}|${facetKey ?? ""}`;
}

/** The anchor key for a rendered day cell. */
export function cellNoteKey(d: DayCell): string {
    return anchorFor(d.date, d.facetKey);
}
