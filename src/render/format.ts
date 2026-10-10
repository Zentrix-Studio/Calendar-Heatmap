"use strict";

import { valueFormatter } from "powerbi-visuals-utils-formattingutils";

/**
 * Number formatting — one formatter for every surface (HM-V2-31, zentrix-qa#2/#3/#11/#19).
 *
 * Ported from the Pie·Donut·Sunburst (`render/format.ts`, ledger PDS-011/012), the
 * family's newest base:
 *   · the measure's own Power BI format string (currency, %, fixed places) through
 *     Microsoft's `valueFormatter` — a "₹#,0.00" Revenue prints with its symbol, a
 *     Percentage measure prints "25.00%", never 0.25;
 *   · the report's locale (`host.locale`) for grouping and separators, the SAME on every
 *     surface — the tooltip used the browser locale and the Table hard-coded en-US;
 *   · display units incl. lakh / crore, which Power BI's formatter doesn't have.
 *
 * Two heatmap rules on top:
 *   · An author-chosen unit keeps its decimals as asked: 999 at K, 2 dp → "1.00K", not
 *     "1K" (zentrix-qa#3). Only the automatic compact scale trims zeros.
 *   · Units "Auto" keeps each surface's long-standing SCALE (ledger HM-V2-31): the
 *     tooltip and day panel print the full number, the Table and Insight switch to M / B
 *     past a million, the KPI chips and cell values go compact (K / M / B). Format string
 *     and locale apply on all of them.
 *
 * State is set once per update / render (`setFormatLocale`, `setValueFormat`,
 * `setNumberFormat`); each visual instance runs in its own sandboxed iframe.
 */

export type DisplayUnits = "auto" | "none" | "thousands" | "millions" | "billions" | "lakhs" | "crores";

interface Unit { div: number; suffix: string; }

const UNITS: Record<Exclude<DisplayUnits, "auto" | "none">, Unit> = {
    thousands: { div: 1e3, suffix: "K" },
    millions: { div: 1e6, suffix: "M" },
    billions: { div: 1e9, suffix: "B" },
    lakhs: { div: 1e5, suffix: "L" },
    crores: { div: 1e7, suffix: "Cr" },
};

function autoUnit(abs: number, from = 1e3): Unit | null {
    if (abs >= 1e9) return UNITS.billions;
    if (abs >= 1e6) return UNITS.millions;
    if (abs >= 1e3 && from <= 1e3) return UNITS.thousands;
    return null;
}

function trimZeros(s: string): string {
    return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s;
}

// --- locale ------------------------------------------------------------------

let numberLocale = "en-US";
const nfCache = new Map<string, Intl.NumberFormat>();

/** The report's locale (`host.locale`); anything Intl rejects falls back to en-US. */
export function setFormatLocale(locale: string | undefined): void {
    let next = "en-US";
    try { if (locale) { new Intl.NumberFormat(locale); next = locale; } } catch { next = "en-US"; }
    if (next !== numberLocale) { numberLocale = next; nfCache.clear(); formatters.clear(); }
}

function nf(minFrac: number, maxFrac: number): Intl.NumberFormat {
    const k = `${minFrac}|${maxFrac}`;
    let f = nfCache.get(k);
    if (!f) {
        f = new Intl.NumberFormat(numberLocale, { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac, useGrouping: true });
        nfCache.set(k, f);
    }
    return f;
}

// --- the measure's format string ---------------------------------------------------

let measureFormat: string | null = null;

/** The Value measure's format string, read each update. "General" / empty = none. */
export function setValueFormat(format: string | null | undefined): void {
    measureFormat = usableFormat(format);
}

function usableFormat(format: string | null | undefined): string | null {
    const f = (format ?? "").trim();
    return f && !/^(general|g)$/i.test(f) ? f : null;
}

/**
 * Cap a format's OPTIONAL decimals ("#") so digits before + after the point stay within
 * 15 — all a double holds (Pie PDS-QA-51). Power BI's "Auto" currency format carries 15
 * optional places, which printed 456.7 as "$456.69999999999999".
 */
export function capOptionalDecimals(format: string, value: number): string {
    const abs = Math.abs(value);
    const intDigits = abs >= 1 ? Math.floor(Math.log10(abs)) + 1 : 0;
    const max = Math.max(0, 15 - intDigits);
    return format.replace(/\.(0*)(#+)/g, (whole, zeros: string, hashes: string) => {
        if (zeros.length + hashes.length <= max) return whole;
        const keep = Math.max(0, max - zeros.length);
        return keep || zeros.length ? `.${zeros}${"#".repeat(keep)}` : "";
    });
}

const formatters = new Map<string, { format(v: unknown): string }>();
function formatterFor(format: string, scale: number, precision: number | undefined): { format(v: unknown): string } | null {
    const k = `${numberLocale}|${format}|${scale}|${precision ?? ""}`;
    let f = formatters.get(k);
    if (!f) {
        try {
            f = valueFormatter.create({ format, value: scale, precision, cultureSelector: numberLocale });
        } catch {
            return null;
        }
        if (formatters.size > 200) formatters.clear();
        formatters.set(k, f);
    }
    return f;
}

/**
 * Format a value with display units + decimals.
 *
 * `trim` drops trailing zeros after a unit — only the automatic compact scale does that;
 * a unit the author chose keeps the decimals they asked for. `format`: undefined = the
 * measure's format; a string = that one (a Tooltips-well field carries its own); null =
 * the plain path. A value that rounds to zero never prints as "-0".
 */
export function formatValue(
    value: number, units: DisplayUnits = "auto", decimals = 1, accounting = false,
    format?: string | null, trim = units === "auto",
): string {
    if (!isFinite(value)) return "—";
    if (accounting && value < 0) return `(${formatValue(-value, units, decimals, false, format, trim)})`;
    const abs = Math.abs(value);
    let unit: Unit | null = null;
    if (units === "auto") unit = autoUnit(abs);
    else if (units !== "none") unit = UNITS[units];
    const d = Math.max(0, decimals);
    const fmt = format === undefined ? measureFormat : usableFormat(format);
    if (fmt) {
        // Lakh / crore aren't Power BI units: scale here, format, add the suffix. K/M/B
        // are the formatter's own, so it places and localises them.
        const indian = unit === UNITS.lakhs || unit === UNITS.crores;
        const f = formatterFor(unit ? fmt : capOptionalDecimals(fmt, value), unit && !indian ? unit.div : 0, unit ? d : undefined);
        if (f) {
            if (indian && unit) return `${f.format(value / unit.div)}${unit.suffix}`;
            return f.format(value);
        }
    }
    if (unit) {
        const rounded = Number((abs / unit.div).toFixed(d));
        const sign = value < 0 && rounded !== 0 ? "-" : "";
        if (trim) return `${sign}${nf(0, d).format(Number(trimZeros(rounded.toFixed(d))))}${unit.suffix}`;
        return `${sign}${nf(d, d).format(rounded)}${unit.suffix}`;
    }
    const rounded = Number(abs.toFixed(d));
    const sign = value < 0 && rounded !== 0 ? "-" : "";
    if (!trim) return `${sign}${nf(d, d).format(rounded)}`;
    // Automatic: the fraction shows in full when it isn't all zeros, else it's dropped.
    const fp = abs.toFixed(d).split(".")[1];
    const keep = fp && Number(fp) !== 0 ? d : 0;
    return `${sign}${nf(keep, keep).format(rounded)}`;
}

// --- Labels › Numbers + the three surface scales ------------------------------------

const UNIT_SET = new Set<string>(["auto", "none", "thousands", "millions", "billions", "lakhs", "crores"]);

let units: DisplayUnits = "auto";
let decimals = 1;

/** Apply Labels › Numbers for the render about to run. Unknown units fall back to
 *  auto; decimals are clamped to the stepper's 0–4. */
export function setNumberFormat(u: string, d: number): void {
    units = (UNIT_SET.has(u) ? u : "auto") as DisplayUnits;
    decimals = Math.min(4, Math.max(0, Math.round(Number(d) || 0)));
}

/** The author's choice, or null when units are "auto" (each surface keeps its scale). */
export function chosenFormat(): { units: DisplayUnits; decimals: number } | null {
    return units === "auto" ? null : { units, decimals };
}

/** A surface's automatic formatter, used while units are "auto". */
export type SurfaceScale = (n: number, format?: string | null) => string;

/** Tooltip / day panel: the whole number in the measure's format (up to 2 places
 *  without one — the pre-port toLocaleString, now in the report's locale). */
export const fullScale: SurfaceScale = (n, format) => {
    const fmt = format === undefined ? measureFormat : usableFormat(format);
    if (fmt) return formatValue(n, "none", 0, false, fmt);
    return isFinite(n) ? nf(0, 2).format(n) : "—";
};

/** Table / Insight: M / B past a million, else whole numbers or one place. */
export const viewScale: SurfaceScale = (n, format) => {
    if (!isFinite(n)) return "—";
    if (Math.abs(n) >= 1e6) return formatValue(n, "auto", 1, false, format, false);
    const fmt = format === undefined ? measureFormat : usableFormat(format);
    if (fmt) return formatValue(n, "none", 0, false, fmt);
    const isInt = Math.abs(n - Math.round(n)) < 1e-9;
    return isInt ? nf(0, 0).format(Math.round(n)) : nf(1, 1).format(n);
};

/** KPI chips / cell values: compact K / M / B with one place. */
export const compactScale: SurfaceScale = (n, format) => {
    if (!isFinite(n)) return "—";
    if (Math.abs(n) < 1e3) {
        const fmt = format === undefined ? measureFormat : usableFormat(format);
        if (fmt) return formatValue(n, "none", 0, false, fmt);
        return nf(0, 0).format(Math.round(n));
    }
    return formatValue(n, "auto", 1, false, format, false);
};

/** Format with the author's unit when they picked one, else the surface's own scale.
 *  `format` overrides the measure's format (a Tooltips-well field carries its own). */
export function formatWith(n: number, surface: SurfaceScale, format?: string | null): string {
    if (units === "auto") return surface(n, format);
    return formatValue(n, units, decimals, false, format, false);
}

/** A signed change ("+4.55", "−734", "± 0"), on the same surface rules. */
export function formatDelta(n: number, surface: SurfaceScale = fullScale): string {
    const text = formatWith(Math.abs(n), surface);
    if (!/[1-9]/.test(text)) return `± ${text}`;
    return n > 0 ? `+${text}` : `−${text}`;
}
