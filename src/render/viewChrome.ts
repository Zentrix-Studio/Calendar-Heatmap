"use strict";

/**
 * Shared chrome for the two HTML alternate views (Table + Insight). One recipe, so the
 * two views can never disagree about what the current canvas looks like — the Sankey's
 * SP-102 lesson. Page tint, hairline and shadow are ALPHA BLENDS of ink over the themed
 * surface (the Gantt's recipe) because a light "page grey" is not a token and raw hexes
 * are banned here — only `zentrixTokens` values may name a colour.
 *
 * These views are DOM overlays, not SVG drawers: they wrap real sentences and the
 * browser lays them out. The "no getBBox / arithmetic widths only" rule governs the
 * SVG render path; nothing here measures text.
 */

import {
    SurfaceTheme, HcColors, resolveSurface, surfaceElevatedLight, surfaceElevated, posSafe, negSafe,
} from "../theme/zentrixTokens";
import { formatWith } from "./format";

export const SERIF = "Georgia, 'Times New Roman', serif";
export const MONO = "'SF Mono', 'Cascadia Mono', Consolas, ui-monospace, monospace";
/** Clear the floating pill + gear cluster at the bottom of a scrolled view. */
export const VIEW_END_GUTTER = 72;

export interface ViewChrome {
    surface: SurfaceTheme;
    pageBg: string;
    cardBg: string;
    border: string;
    zebra: string;
    track: string;
    shadow: string;
    hover: string;
    hc: boolean;
}

export function viewChrome(dark: boolean, hc: HcColors | null): ViewChrome {
    const surface = resolveSurface(dark, hc);
    if (hc) {
        return {
            surface, pageBg: surface.bg, cardBg: surface.bg, border: surface.fg,
            zebra: "transparent", track: "transparent", shadow: "none", hover: "transparent", hc: true,
        };
    }
    return dark
        ? {
            surface, pageBg: surface.bg, cardBg: surfaceElevated,
            border: "rgba(255,255,255,0.10)", zebra: "rgba(255,255,255,0.03)",
            track: "rgba(255,255,255,0.10)", shadow: "0 2px 10px rgba(0,0,0,0.45)",
            hover: "rgba(255,255,255,0.06)", hc: false,
        }
        : {
            surface, pageBg: "rgba(11,16,32,0.05)", cardBg: surfaceElevatedLight,
            border: "rgba(11,16,32,0.08)", zebra: "rgba(11,16,32,0.025)",
            track: "rgba(11,16,32,0.08)", shadow: "0 2px 10px rgba(11,16,32,0.06)",
            hover: "rgba(11,16,32,0.05)", hc: false,
        };
}

export type Tone = "positive" | "negative" | "neutral";

/** Tone → dot / number colour. HC strips the colour cue (weight still carries it). */
export function toneColor(t: Tone, c: ViewChrome): string {
    if (c.hc) return c.surface.fg;
    return t === "positive" ? posSafe : t === "negative" ? negSafe : c.surface.muted;
}

export const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Compact, deterministic number formatting — the KPI-chip scale (B / M, ≤1 dp). */
export function fmtNum(n: number | null | undefined): string {
    if (n == null || !isFinite(n)) return "–";
    // Labels › Numbers (HM-V2-31): the author's units win; "auto" keeps this scale.
    return formatWith(n, viewScale);
}

function viewScale(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (abs >= 1e6) return (n / 1e6).toFixed(1) + "M";
    const isInt = Math.abs(n - Math.round(n)) < 1e-9;
    if (isInt) return Math.round(n).toLocaleString("en-US");
    return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Signed whole-percent, e.g. "+12%" / "−4%" (true minus sign). */
export function fmtPct(frac: number, signed = true): string {
    if (!isFinite(frac)) return "–";
    const p = Math.round(frac * 100);
    if (!signed) return `${Math.abs(p)}%`;
    return p > 0 ? `+${p}%` : p < 0 ? `−${Math.abs(p)}%` : "0%";
}

/** "Mar 4, 2025" — the calendar's short, unambiguous date. */
export function fmtDate(d: Date): string {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function icon(paths: string[], size = 14): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", String(size)); s.setAttribute("height", String(size));
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const d of paths) { const p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", d); s.appendChild(p); }
    return s;
}
export const SEARCH_ICON = ["M21 21l-4.8-4.8", "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0z"];

/** Stop an interaction inside a view from reaching the canvas-click that clears the
 *  cross-filter and closes the day panel. */
export function swallow(el: HTMLElement): void {
    el.addEventListener("click", (e) => e.stopPropagation());
}
