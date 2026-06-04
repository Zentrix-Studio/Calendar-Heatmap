"use strict";

import { interpolateRgbBasis, scaleQuantile, scaleQuantize } from "d3";
import { CalendarModel, DayCell } from "../types";

/**
 * Zentrix brand violet sequential ramps, ordered low → high.
 * Direction is theme-aware so "more value = more visual weight" reads correctly:
 *  - Light background: low = pale, high = deep/saturated (ink grows with value).
 *  - Dark background:  low = dark (sinks into bg), high = bright (glows).
 */
export const VIOLET_RAMP_LIGHT = ["#EDE8FF", "#C4B5FD", "#9B7CF6", "#6D4DE0", "#4A36A8"];
export const VIOLET_RAMP_DARK = ["#241E45", "#3D2F86", "#5A45C2", "#7C5CFF", "#B59CFF"];
/** Back-compat default alias (dark-oriented brand ramp). */
export const VIOLET_RAMP = VIOLET_RAMP_DARK;

/** Perceptually-uniform option (viridis stops) — better step distinguishability. */
export const VIRIDIS_RAMP = ["#440154", "#3B528B", "#21918C", "#5EC962", "#FDE725"];
/** Colorblind-safe sequential (blue→yellow, CVD-friendly). */
export const COLORBLIND_RAMP = ["#FFF7BC", "#FEC44F", "#FE9929", "#D95F0E", "#993404"];

/** Palette MODE — how cell colors are produced. */
export type PaletteMode = "mono" | "ramp" | "duotone" | "split" | "theme";
/** Named sequential ramp presets (used when mode = "ramp"). */
export type RampPreset = "violet" | "ocean" | "forest" | "magma" | "viridis" | "colorblind";

/** Preset ramps, low → high, with a theme-appropriate variant. */
const PRESETS: Record<RampPreset, { light: string[]; dark: string[] }> = {
    violet: { light: VIOLET_RAMP_LIGHT, dark: VIOLET_RAMP_DARK },
    ocean: { light: ["#E1F0FB", "#A8D5F2", "#5BAEE0", "#2E7DC4", "#13478A"],
             dark: ["#0E2233", "#16466B", "#2E7DC4", "#5BAEE0", "#A8D5F2"] },
    forest: { light: ["#E8F5E9", "#A5D6A7", "#66BB6A", "#388E3C", "#1B5E20"],
              dark: ["#10240F", "#1B5E20", "#388E3C", "#66BB6A", "#A5D6A7"] },
    magma: { light: ["#3B0F70", "#8C2981", "#DE4968", "#FE9F6D", "#FCFDBF"],
             dark: ["#000004", "#3B0F70", "#8C2981", "#DE4968", "#FE9F6D"] },
    viridis: { light: VIRIDIS_RAMP, dark: VIRIDIS_RAMP },
    colorblind: { light: COLORBLIND_RAMP, dark: COLORBLIND_RAMP },
};

export function rampForPreset(p: RampPreset, dark: boolean): string[] {
    return PRESETS[p][dark ? "dark" : "light"];
}

/** @deprecated old 3-ramp name; kept so older callers still resolve. */
export type RampName = "violet" | "viridis" | "colorblind";
export function resolveRamp(name: RampName, dark: boolean): string[] {
    return rampForPreset(name as RampPreset, dark);
}

const hex2 = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
/** Linear blend of two #rrggbb colors, t in [0,1]. */
function mix(a: string, b: string, t: string | number): string {
    const k = typeof t === "number" ? t : 0;
    const ch = (i: number) => Math.round(hex2(a, i) + (hex2(b, i) - hex2(a, i)) * k);
    const to2 = (n: number) => n.toString(16).padStart(2, "0");
    return `#${to2(ch(1))}${to2(ch(3))}${to2(ch(5))}`;
}

/** Single-hue ramp: a tint of the hue (toward the theme base) up to the full hue. */
function monoRamp(hue: string, dark: boolean): string[] {
    const base = dark ? "#0F0F16" : "#FFFFFF";
    return [0.86, 0.64, 0.42, 0.2, 0].map(t => mix(hue, base, t));
}

export interface PaletteSpec {
    mode: PaletteMode;
    preset: RampPreset;
    /** Mono hue / Duotone start (low). */
    startColor: string;
    /** Duotone end (high). */
    endColor: string;
    /** Split (diverging) low / mid / high. */
    splitLow: string;
    splitMid: string;
    splitHigh: string;
    /** Report-theme accent (from the host color palette). */
    themeAccent: string;
    dark: boolean;
}

/** Resolve the final low→high color stops for the chosen palette mode. */
export function resolvePalette(p: PaletteSpec): string[] {
    switch (p.mode) {
        case "mono": return monoRamp(p.startColor, p.dark);
        case "duotone": return [p.startColor, p.endColor];
        case "split": return [p.splitLow, p.splitMid, p.splitHigh];
        case "theme": return monoRamp(p.themeAccent, p.dark);
        default: return rampForPreset(p.preset, p.dark);
    }
}

/** No-data surface tokens per theme — neutral, never reads as a low value. */
export const NO_DATA_LIGHT = "#E6E6EC";
export const NO_DATA_DARK = "#1C1C26";

/** Color scaling mode (spec DECISION 1). */
export type ScaleMode = "quantile" | "linear" | "log";

export interface ColorOptions {
    mode: ScaleMode;
    /** 0 = continuous gradient; otherwise discrete bucket count (3/5/7). */
    buckets: number;
    ramp: string[];
    noData: string;
}

export interface GradientStop { offset: number; color: string; }

export interface ColorAccessor {
    /** Resolve the fill color for one cell (handles null / no-data). */
    of(cell: DayCell): string;
    /** 0 = continuous; otherwise the bucket count. */
    buckets: number;
    /** Discrete swatch colors (bucketed) or ramp stops (continuous), low → high. */
    swatches: string[];
    /** Stops for a continuous gradient legend. */
    gradientStops: GradientStop[];
    noData: string;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Non-null values from the model, used to fit the scale. */
function valuesOf(model: CalendarModel): number[] {
    const out: number[] = [];
    for (const d of model.days) if (!d.noData && d.value != null) out.push(d.value);
    return out;
}

/**
 * Build a color accessor per the chosen scaling mode and bucket count.
 *
 * - quantile: equal-count buckets (bucketed) or empirical-CDF rank (continuous).
 *   The default — keeps right-skewed data legible instead of mostly-pale.
 * - linear: equal-width over [min,max].
 * - log: equal-width over log10, with a positive floor; values ≤ 0 clamp low.
 */
export function buildColorAccessor(model: CalendarModel, opts: ColorOptions): ColorAccessor {
    const values = valuesOf(model);
    const interp = interpolateRgbBasis(opts.ramp);
    const [min, max] = model.valueDomain;
    const span = max - min || 1;

    const gradientStops: GradientStop[] = opts.ramp.map((color, i) => ({
        offset: opts.ramp.length === 1 ? 0 : i / (opts.ramp.length - 1),
        color,
    }));

    // ---- Continuous gradient ----------------------------------------------
    if (!opts.buckets || opts.buckets < 2 || values.length === 0) {
        let t: (v: number) => number;
        if (opts.mode === "quantile") {
            const sorted = values.slice().sort((a, b) => a - b);
            t = (v: number) => empiricalCdf(sorted, v);
        } else if (opts.mode === "log") {
            const floor = Math.max(1e-6, min > 0 ? min : minPositive(values));
            const lo = Math.log10(floor), hi = Math.log10(Math.max(floor, max));
            const lspan = hi - lo || 1;
            t = (v: number) => (v <= floor ? 0 : clamp01((Math.log10(v) - lo) / lspan));
        } else {
            t = (v: number) => clamp01((v - min) / span);
        }
        return {
            of: (c) => (c.noData || c.value == null ? opts.noData : interp(t(c.value))),
            buckets: 0,
            swatches: opts.ramp.slice(),
            gradientStops,
            noData: opts.noData,
        };
    }

    // ---- Discrete buckets --------------------------------------------------
    const n = opts.buckets;
    const bucketColors = Array.from({ length: n }, (_, i) => interp(n === 1 ? 0 : i / (n - 1)));
    const indices = Array.from({ length: n }, (_, i) => i);
    let bucketOf: (v: number) => number;

    if (opts.mode === "quantile") {
        const q = scaleQuantile<number>().domain(values).range(indices);
        bucketOf = (v) => q(v);
    } else if (opts.mode === "log") {
        const floor = Math.max(1e-6, min > 0 ? min : minPositive(values));
        const lo = Math.log10(floor), hi = Math.log10(Math.max(floor, max));
        const q = scaleQuantize<number>().domain([lo, hi]).range(indices);
        bucketOf = (v) => q(Math.log10(Math.max(floor, v)));
    } else {
        const q = scaleQuantize<number>().domain([min, max]).range(indices);
        bucketOf = (v) => q(v);
    }

    return {
        of: (c) => (c.noData || c.value == null ? opts.noData : bucketColors[bucketOf(c.value)]),
        buckets: n,
        swatches: bucketColors,
        gradientStops,
        noData: opts.noData,
    };
}

/** Fraction of sorted values ≤ v, in [0,1] — empirical CDF for quantile-continuous. */
function empiricalCdf(sorted: number[], v: number): number {
    if (sorted.length <= 1) return 0.5;
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid; }
    return clamp01((lo - 1) / (sorted.length - 1));
}

function minPositive(values: number[]): number {
    let m = Infinity;
    for (const v of values) if (v > 0 && v < m) m = v;
    return m === Infinity ? 1 : m;
}

/** @deprecated since M4 — kept for any callers; use buildColorAccessor. */
export function buildSequential(model: CalendarModel, ramp: string[] = VIOLET_RAMP, noData: string = NO_DATA_LIGHT): ColorAccessor {
    return buildColorAccessor(model, { mode: "linear", buckets: 0, ramp, noData });
}
