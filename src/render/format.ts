"use strict";

/**
 * Number formatting — Labels › Numbers (display units + decimals).
 *
 * `formatValue` is the family's formatter, byte-for-byte the Sankey Pro's
 * (`render/format.ts`): display units incl. the Indian lakh / crore units, fixed
 * decimals, ASCII thousands grouping. Pure and deterministic.
 *
 * ONE heatmap difference, deliberate (ledger HM-V2-31): units "auto" means each
 * surface keeps the scale it has always used — the tooltip and day panel print the
 * full number, the Table and Insight page switch to M / B past a million, the KPI
 * chips and cell labels go compact (K / M / B). That is what every saved report looks
 * like today, and a published visual's numbers must not change under its readers. An
 * author who picks a unit gets it everywhere at once, with their decimals.
 *
 * The chosen format is module state set once per render (`setNumberFormat`), so the
 * ~40 call sites across tooltip, panel, Table, Insight and header need no new
 * parameter. Each visual instance runs in its own sandboxed iframe, so the state is
 * never shared between two visuals on a page.
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

function autoUnit(abs: number): Unit | null {
    if (abs >= 1e9) return UNITS.billions;
    if (abs >= 1e6) return UNITS.millions;
    if (abs >= 1e3) return UNITS.thousands;
    return null;
}

function trimZeros(s: string): string {
    return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s;
}

/** Format a value with display units + decimals. Negatives keep their sign.
 *  In `accounting` mode negatives are wrapped in parentheses (finance convention). */
export function formatValue(value: number, units: DisplayUnits = "auto", decimals = 1, accounting = false): string {
    if (!isFinite(value)) return "—";
    if (accounting && value < 0) return `(${formatValue(-value, units, decimals, false)})`;
    const sign = value < 0 ? "-" : "";
    const abs = Math.abs(value);
    let unit: Unit | null = null;
    if (units === "auto") unit = autoUnit(abs);
    else if (units !== "none") unit = UNITS[units];
    if (unit) {
        const scaled = abs / unit.div;
        return `${sign}${trimZeros(scaled.toFixed(Math.max(0, decimals)))}${unit.suffix}`;
    }
    // Plain number with thousands separators (grouping is display-only, ASCII-safe).
    const fixed = abs.toFixed(Math.max(0, decimals));
    const [ip, fp] = fixed.split(".");
    const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const body = fp && Number(fp) !== 0 ? `${grouped}.${fp}` : grouped;
    return `${sign}${body}`;
}

const UNIT_SET = new Set<string>(["auto", "none", "thousands", "millions", "billions", "lakhs", "crores"]);

let units: DisplayUnits = "auto";
let decimals = 1;

/** Apply Labels › Numbers for the render about to run. Unknown units fall back to
 *  auto; decimals are clamped to the stepper's 0–4. */
export function setNumberFormat(u: string, d: number): void {
    units = (UNIT_SET.has(u) ? u : "auto") as DisplayUnits;
    decimals = Math.min(4, Math.max(0, Math.round(Number(d) || 0)));
}

/** The author's choice, or null when units are "auto" (each surface keeps its own). */
export function chosenFormat(): { units: DisplayUnits; decimals: number } | null {
    return units === "auto" ? null : { units, decimals };
}

/** Format with the author's units when they picked one, else with the surface's own
 *  long-standing formatter. */
export function formatWith(n: number, surfaceDefault: (n: number) => string): string {
    return units === "auto" ? surfaceDefault(n) : formatValue(n, units, decimals);
}
