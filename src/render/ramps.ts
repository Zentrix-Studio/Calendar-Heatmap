"use strict";

/**
 * Pure color-ramp definitions and palette resolution - NO d3, NO Power BI.
 *
 * Split out of colors.ts so the ramp values can be unit-tested (including the
 * CVD / colorblind-safety check, spec acceptance criterion #8) without pulling
 * d3's ESM into the Jest runtime. colors.ts re-exports everything here, so all
 * existing `from "./colors"` imports keep resolving unchanged.
 */

/**
 * Zentrix brand violet sequential ramps, ordered low -> high.
 * Direction is theme-aware so "more value = more visual weight" reads correctly:
 *  - Light background: low = pale, high = deep/saturated (ink grows with value).
 *  - Dark background:  low = dark (sinks into bg), high = bright (glows).
 */
export const VIOLET_RAMP_LIGHT = ["#EDE8FF", "#C4B5FD", "#9B7CF6", "#6D4DE0", "#4A36A8"];
export const VIOLET_RAMP_DARK = ["#241E45", "#3D2F86", "#5A45C2", "#7C5CFF", "#B59CFF"];
/** Back-compat default alias (dark-oriented brand ramp). */
export const VIOLET_RAMP = VIOLET_RAMP_DARK;

/** Perceptually-uniform option (viridis stops) - better step distinguishability. */
export const VIRIDIS_RAMP = ["#440154", "#3B528B", "#21918C", "#5EC962", "#FDE725"];
/** Colorblind-safe sequential (yellow->brown, CVD-friendly, luminance-monotonic). */
export const COLORBLIND_RAMP = ["#FFF7BC", "#FEC44F", "#FE9929", "#D95F0E", "#993404"];

/** Palette MODE - how cell colors are produced. */
export type PaletteMode = "mono" | "ramp" | "duotone" | "split" | "theme";
/** Named sequential ramp presets (used when mode = "ramp"). */
export type RampPreset = "violet" | "ocean" | "forest" | "magma" | "viridis" | "colorblind";

/** Preset ramps, low -> high, with a theme-appropriate variant. */
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

/** Resolve the final low->high color stops for the chosen palette mode. */
export function resolvePalette(p: PaletteSpec): string[] {
    switch (p.mode) {
        case "mono": return monoRamp(p.startColor, p.dark);
        case "duotone": return [p.startColor, p.endColor];
        case "split": return [p.splitLow, p.splitMid, p.splitHigh];
        case "theme": return monoRamp(p.themeAccent, p.dark);
        default: return rampForPreset(p.preset, p.dark);
    }
}

/** No-data surface tokens per theme - neutral, never reads as a low value. */
export const NO_DATA_LIGHT = "#E6E6EC";
export const NO_DATA_DARK = "#1C1C26";
