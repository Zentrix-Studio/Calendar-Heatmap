"use strict";

/**
 * Landing / onboarding page — shown when the visual is loaded but no data is
 * bound. A full-bleed, two-column hero carousel: each page pairs a **live
 * calendar-heatmap illustration** (rendered with the visual's real ramp colors)
 * with its copy. Disappears the moment a Date + Value land.
 *
 * Mounted from the visual's CONSTRUCTOR (Power BI doesn't call update() until a
 * field is bound, so an update()-only landing page never shows on a fresh visual).
 *
 * Cert-safe: built entirely with createElement / textContent / inline SVG — no
 * innerHTML, no network, no external assets. Motion is CSS-only and gated behind
 * `prefers-reduced-motion`. Theme-aware via a CSS-variable block injected once.
 */

import {
    VIOLET_RAMP_LIGHT, VIOLET_RAMP_DARK, COLORBLIND_RAMP, NO_DATA_LIGHT, NO_DATA_DARK,
} from "../render/ramps";
import { VERSION } from "../version";

const NS = "http://www.w3.org/2000/svg";
const STYLE_ID = "zx-landing-style";
type Cleanup = () => void;

// --- small SVG + color helpers (pure) ---------------------------------------
function svgNode(viewBox: string, w: number, h: number): SVGSVGElement {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", viewBox);
    s.setAttribute("width", String(w));
    s.setAttribute("height", String(h));
    return s;
}
function rectNode(x: number, y: number, w: number, h: number, rx: number, fill: string): SVGRectElement {
    const r = document.createElementNS(NS, "rect");
    r.setAttribute("x", String(x)); r.setAttribute("y", String(y));
    r.setAttribute("width", String(w)); r.setAttribute("height", String(h));
    r.setAttribute("rx", String(rx)); r.setAttribute("fill", fill);
    return r;
}
function textNode(x: number, y: number, str: string, opts: { size?: number; fill?: string; weight?: number; anchor?: string }): SVGTextElement {
    const t = document.createElementNS(NS, "text");
    t.setAttribute("x", String(x)); t.setAttribute("y", String(y));
    t.setAttribute("font-family", "Segoe UI, system-ui, sans-serif");
    t.setAttribute("font-size", String(opts.size ?? 11));
    t.setAttribute("fill", opts.fill ?? "#64647a");
    if (opts.weight) t.setAttribute("font-weight", String(opts.weight));
    if (opts.anchor) t.setAttribute("text-anchor", opts.anchor);
    t.textContent = str;
    return t;
}

const hx = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
function lerpHex(a: string, b: string, t: number): string {
    const ch = (i: number) => Math.round(hx(a, i) + (hx(b, i) - hx(a, i)) * t);
    const p = (n: number) => n.toString(16).padStart(2, "0");
    return `#${p(ch(1))}${p(ch(3))}${p(ch(5))}`;
}
/** Multi-stop ramp sample at t in [0,1]. */
function rampAt(stops: string[], t: number): string {
    if (t <= 0) return stops[0];
    if (t >= 1) return stops[stops.length - 1];
    const seg = t * (stops.length - 1);
    const i = Math.floor(seg);
    return lerpHex(stops[i], stops[i + 1], seg - i);
}
/** Deterministic LCG — stable illustrations, and avoids Math.random (lint-safe). */
function seeded(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// --- the live heatmap illustration ------------------------------------------
interface MiniOpts {
    stops: string[];
    noData: string;
    weeks?: number;
    cell?: number;
    gap?: number;
    seed?: number;
    gapRate?: number;
    /** "rank" spreads values (quantile-like); "raw" leaves skew (linear-like). */
    mapping?: "rank" | "raw";
    animate?: boolean;
}
/** A 7-row × N-week heatmap built from a right-skewed series with weekday rhythm. */
function miniHeatmap(o: MiniOpts): { svg: SVGSVGElement; w: number; h: number; cell: number; gap: number } {
    const weeks = o.weeks ?? 24, cell = o.cell ?? 13, gap = o.gap ?? 3, rows = 7;
    const w = weeks * (cell + gap) - gap, h = rows * (cell + gap) - gap;
    const svg = svgNode(`0 0 ${w} ${h}`, w, h);
    const rnd = seeded(o.seed ?? 7);

    // Build a right-skewed value per cell with a Friday-ish bump; mark ~gapRate as no-data.
    const N = weeks * rows;
    const vals: (number | null)[] = [];
    for (let i = 0; i < N; i++) {
        if (rnd() < (o.gapRate ?? 0.07)) { vals.push(null); continue; }
        const row = i % rows;
        const base = Math.pow(rnd(), 2.4);                 // right-skew
        const rhythm = row === 5 ? 0.28 : row === 6 || row === 0 ? -0.12 : 0;
        vals.push(Math.max(0, Math.min(1, base + rhythm)));
    }
    const real = vals.filter((v): v is number => v != null).slice().sort((a, b) => a - b);
    const rankOf = (v: number) => real.length <= 1 ? 0.5 : real.indexOf(v) / (real.length - 1);

    let idx = 0;
    for (let col = 0; col < weeks; col++) {
        for (let row = 0; row < rows; row++) {
            const v = vals[col * rows + row];
            const t = v == null ? 0 : o.mapping === "raw" ? v : rankOf(v);
            const fill = v == null ? o.noData : rampAt(o.stops, 0.12 + t * 0.88);
            const r = rectNode(col * (cell + gap), row * (cell + gap), cell, cell, 2.5, fill);
            if (v == null) { r.setAttribute("stroke", o.noData); r.setAttribute("opacity", "0.55"); }
            if (o.animate !== false) {
                r.setAttribute("class", "zx-lp-cell");
                (r as unknown as SVGElement).style.animationDelay = `${Math.round(idx * 6)}ms`;
            }
            svg.appendChild(r);
            idx++;
        }
    }
    return { svg, w, h, cell, gap };
}

/** A floating insight chip (pill) for the insights scene. */
function chip(x: number, y: number, label: string, tone: string, dark: boolean): SVGGElement {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "zx-lp-chip");
    const padX = 9, fs = 11, wApprox = label.length * fs * 0.56 + padX * 2 + 14;
    const bg = rectNode(x, y, wApprox, 24, 12, dark ? "#1d1d2a" : "#ffffff");
    bg.setAttribute("stroke", dark ? "rgba(255,255,255,.14)" : "rgba(20,23,50,.10)");
    g.appendChild(bg);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", String(x + padX + 3)); dot.setAttribute("cy", String(y + 12));
    dot.setAttribute("r", "3.5"); dot.setAttribute("fill", tone);
    g.appendChild(dot);
    g.appendChild(textNode(x + padX + 13, y + 16, label, { size: fs, weight: 600, fill: dark ? "#e8e8f0" : "#26263a" }));
    return g;
}

// --- per-page illustration scenes -------------------------------------------
interface SceneCtx { dark: boolean; violet: string[]; }

function sceneWelcome(c: SceneCtx): SVGSVGElement {
    const { svg } = miniHeatmap({ stops: c.violet, noData: c.dark ? NO_DATA_DARK : NO_DATA_LIGHT, weeks: 26, seed: 11 });
    svg.setAttribute("width", "100%"); svg.removeAttribute("height");
    return svg;
}
function sceneFields(c: SceneCtx): SVGSVGElement {
    const m = miniHeatmap({ stops: c.violet, noData: c.dark ? NO_DATA_DARK : NO_DATA_LIGHT, weeks: 22, seed: 5 });
    const pad = 22;
    const W = m.w + pad * 2, H = m.h + 40;
    const wrap = svgNode(`0 0 ${W} ${H}`, W, H);
    wrap.setAttribute("width", "100%"); wrap.removeAttribute("height");
    const g = document.createElementNS(NS, "g");
    g.setAttribute("transform", `translate(${pad}, 6)`);
    g.appendChild(m.svg);
    wrap.appendChild(g);
    const axis = c.dark ? "#8a8a99" : "#70707f";
    wrap.appendChild(textNode(pad, m.h + 26, "Date →", { size: 11, weight: 600, fill: c.violet[c.violet.length - 1] }));
    wrap.appendChild(textNode(W - pad, m.h + 26, "Value = color intensity", { size: 11, weight: 600, fill: axis, anchor: "end" }));
    return wrap;
}
function sceneSmallMultiples(c: SceneCtx): SVGSVGElement {
    const ramps = [c.violet, ["#DCEBFB", "#6BA6F0", "#1D52AE"], ["#E8F5E9", "#66BB6A", "#1B5E20"]];
    const names = ["Region A", "Region B", "Region C"];
    const each = { weeks: 18, cell: 10, gap: 2 };
    const one = miniHeatmap({ ...each, stops: ramps[0], noData: c.dark ? NO_DATA_DARK : NO_DATA_LIGHT });
    const rowH = one.h + 26, W = one.w + 16, H = rowH * 3;
    const wrap = svgNode(`0 0 ${W} ${H}`, W, H);
    wrap.setAttribute("width", "100%"); wrap.removeAttribute("height");
    ramps.forEach((stops, i) => {
        const m = miniHeatmap({ ...each, stops, noData: c.dark ? NO_DATA_DARK : NO_DATA_LIGHT, seed: 3 + i * 7 });
        const g = document.createElementNS(NS, "g");
        g.setAttribute("transform", `translate(8, ${i * rowH + 16})`);
        g.appendChild(textNode(0, -4, names[i], { size: 10, weight: 700, fill: c.dark ? "#cfcfe0" : "#3a3a4a" }));
        g.appendChild(m.svg);
        wrap.appendChild(g);
    });
    return wrap;
}
function sceneRead(c: SceneCtx): SVGSVGElement {
    const stops = c.violet, noData = c.dark ? NO_DATA_DARK : NO_DATA_LIGHT;
    const cell = 26, gap = 6, W = 360, H = 150;
    const wrap = svgNode(`0 0 ${W} ${H}`, W, H);
    wrap.setAttribute("width", "100%"); wrap.removeAttribute("height");
    const muted = c.dark ? "#8a8a99" : "#70707f", strong = c.dark ? "#e8e8f0" : "#26263a";
    // Row of intensity cells low → high.
    [0.1, 0.35, 0.6, 0.85, 1].forEach((t, i) => {
        wrap.appendChild(rectNode(8 + i * (cell + gap), 16, cell, cell, 5, rampAt(stops, 0.12 + t * 0.88)));
    });
    wrap.appendChild(textNode(8, 62, "Darker = higher value", { size: 12, weight: 600, fill: strong }));
    // No-data + today examples.
    const nd = rectNode(8, 84, cell, cell, 5, noData); nd.setAttribute("stroke", muted); nd.setAttribute("opacity", "0.7");
    wrap.appendChild(nd);
    wrap.appendChild(textNode(8 + cell + 8, 102, "No data — never a low value", { size: 12, fill: muted }));
    const todayCell = rectNode(8, 116, cell, cell, 5, rampAt(stops, 0.7));
    wrap.appendChild(todayCell);
    const ring = rectNode(6, 114, cell + 4, cell + 4, 6, "none");
    ring.setAttribute("stroke", stops[stops.length - 1]); ring.setAttribute("stroke-width", "2");
    wrap.appendChild(ring);
    wrap.appendChild(textNode(8 + cell + 8, 134, "Today is ringed", { size: 12, fill: muted }));
    return wrap;
}
function sceneScaling(c: SceneCtx): SVGSVGElement {
    const noData = c.dark ? NO_DATA_DARK : NO_DATA_LIGHT;
    const each = { weeks: 13, cell: 11, gap: 2, seed: 9 };
    const linear = miniHeatmap({ ...each, stops: c.violet, noData, mapping: "raw", gapRate: 0.03 });
    const quant = miniHeatmap({ ...each, stops: c.violet, noData, mapping: "rank", gapRate: 0.03 });
    const colW = linear.w, W = colW * 2 + 28, H = linear.h + 30;
    const wrap = svgNode(`0 0 ${W} ${H}`, W, H);
    wrap.setAttribute("width", "100%"); wrap.removeAttribute("height");
    const lab = c.dark ? "#8a8a99" : "#70707f";
    const place = (m: { svg: SVGSVGElement }, x: number, label: string) => {
        const g = document.createElementNS(NS, "g");
        g.setAttribute("transform", `translate(${x}, 18)`);
        g.appendChild(textNode(0, -6, label, { size: 11, weight: 700, fill: lab }));
        g.appendChild(m.svg);
        wrap.appendChild(g);
    };
    place(linear, 8, "Linear — mostly pale");
    place(quant, colW + 20, "Quantile — legible");
    return wrap;
}
function sceneInsights(c: SceneCtx): SVGSVGElement {
    const m = miniHeatmap({ stops: c.violet, noData: c.dark ? NO_DATA_DARK : NO_DATA_LIGHT, weeks: 22, seed: 21 });
    const W = m.w, H = m.h + 6;
    const wrap = svgNode(`0 0 ${W} ${H}`, W, H);
    wrap.setAttribute("width", "100%"); wrap.removeAttribute("height");
    wrap.appendChild(m.svg);
    wrap.appendChild(chip(W * 0.04, H * 0.12, "Fridays +18%", "#2EA043", c.dark));
    wrap.appendChild(chip(W * 0.40, H * 0.42, "Aug 18 outlier", "#E5484D", c.dark));
    wrap.appendChild(chip(W * 0.10, H * 0.72, "9-day streak", c.violet[c.violet.length - 1], c.dark));
    return wrap;
}

interface PageDef { eyebrow: string; title: string; lines: string[]; scene: (c: SceneCtx) => SVGSVGElement; }

const PAGES: PageDef[] = [
    { eyebrow: "Welcome", title: "Zentrix Calendar Heatmap", scene: sceneWelcome, lines: [
        "See a whole year of daily activity at a glance — one cell per day, color = the day's value.",
        "Built for real analytics: scales to 5+ years, cross-filters your report, and surfaces plain-English insights.",
        "Let's get it set up. →",
    ] },
    { eyebrow: "Step 1 · Required fields", title: "Add a Date and a Value", scene: sceneFields, lines: [
        "• Date — a date or date/time column. One row per day sets the day axis.",
        "• Value — a numeric measure. Its magnitude drives each cell's color intensity.",
        "That's all it takes to draw the calendar.",
    ] },
    { eyebrow: "Step 2 · Optional fields", title: "Add depth when you need it", scene: sceneSmallMultiples, lines: [
        "• Split by — one small-multiple calendar per category (Region, Team…).",
        "• Target — show each day's value vs a goal in the tooltip.",
        "• Annotations — flag notable days (holidays, releases, incidents).",
        "• Tooltips — extra measures to surface on hover.",
    ] },
    { eyebrow: "How to read it", title: "Darker means more", scene: sceneRead, lines: [
        "• Deeper color = a higher value that day.",
        "• A blank / outlined cell means no data — never a low value.",
        "• Click a day to cross-filter your report; Ctrl-click to multi-select.",
    ] },
    { eyebrow: "Color & scaling", title: "Legible even on spiky data", scene: sceneScaling, lines: [
        "• Quantile scaling (default) keeps a skewed year readable — not 90% pale.",
        "• Switch to Linear or Log, and 3/5/7 buckets or continuous, any time.",
        "• 6 palettes incl. a colorblind-safe ramp; light & dark auto-adapt.",
    ] },
    { eyebrow: "Insights", title: "It tells you what it means", scene: sceneInsights, lines: [
        "A deterministic, in-sandbox engine surfaces findings — no AI black box:",
        "• Longest active / inactive streaks.",
        "• Weekday rhythm — “Fridays run 18% above baseline.”",
        "• Outlier days and year-over-year change (fiscal-aware).",
    ] },
];

export class LandingPage {
    private root: HTMLElement;
    private host?: HTMLElement;
    private page = 0;
    private dark = false;
    private cleanups: Cleanup[] = [];

    constructor(root: HTMLElement) {
        this.root = root;
        this.injectStyle();
    }

    setTheme(dark: boolean): void {
        if (dark === this.dark && this.host) return;
        this.dark = dark;
        if (this.host) { this.host.setAttribute("data-theme", dark ? "dark" : "light"); this.render(); }
    }

    show(): void {
        if (this.host) { this.render(); return; }
        if (getComputedStyle(this.root).position === "static") this.root.style.position = "relative";
        const host = document.createElement("div");
        host.className = "zx-lp";
        host.setAttribute("data-theme", this.dark ? "dark" : "light");
        host.setAttribute("role", "region");
        host.setAttribute("aria-label", "Getting started with Zentrix Calendar Heatmap");
        host.tabIndex = 0;
        this.root.appendChild(host);
        this.host = host;

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") { this.go(1); e.preventDefault(); }
            else if (e.key === "ArrowLeft") { this.go(-1); e.preventDefault(); }
        };
        host.addEventListener("keydown", onKey);
        this.cleanups.push(() => host.removeEventListener("keydown", onKey));

        this.page = 0;
        this.render();
    }

    hide(): void {
        for (const c of this.cleanups) c();
        this.cleanups = [];
        if (this.host) { this.host.remove(); this.host = undefined; }
    }

    private go(delta: number): void {
        const next = this.page + delta;
        if (next < 0 || next >= PAGES.length) return;
        this.page = next;
        this.render();
    }

    private render(): void {
        if (!this.host) return;
        const host = this.host;
        while (host.firstChild) host.removeChild(host.firstChild);
        const p = PAGES[this.page];
        const ctx: SceneCtx = { dark: this.dark, violet: this.dark ? VIOLET_RAMP_DARK : VIOLET_RAMP_LIGHT };

        const card = el("div", "zx-lp-card");

        // Left — illustration panel (gradient + live heatmap), keyed so its
        // entrance animation replays on each page change.
        const art = el("div", "zx-lp-art");
        art.setAttribute("key", String(this.page));
        const artInner = el("div", "zx-lp-art-inner");
        let scene: SVGSVGElement;
        try { scene = p.scene(ctx); } catch { scene = sceneWelcome(ctx); }
        artInner.appendChild(scene);
        art.appendChild(artInner);
        card.appendChild(art);

        // Right — content.
        const content = el("div", "zx-lp-content");
        const brand = el("div", "zx-lp-brand");
        brand.appendChild(brandGlyph());
        brand.appendChild(textEl("span", "zx-lp-brandname", "ZENTRIX"));
        brand.appendChild(textEl("span", "zx-lp-ver", "v" + VERSION));
        content.appendChild(brand);

        content.appendChild(textEl("div", "zx-lp-eyebrow", p.eyebrow));
        content.appendChild(textEl("h2", "zx-lp-title", p.title));

        const body = el("div", "zx-lp-body");
        for (const line of p.lines) {
            if (line.startsWith("• ")) {
                const row = el("div", "zx-lp-bullet");
                row.appendChild(textEl("span", "zx-lp-tick", "✓"));
                row.appendChild(textEl("span", "zx-lp-bulltext", line.slice(2)));
                body.appendChild(row);
            } else {
                body.appendChild(textEl("p", "zx-lp-line", line));
            }
        }
        content.appendChild(body);

        // Footer — back · dots · next.
        const footer = el("div", "zx-lp-footer");
        const prev = button("zx-lp-nav", "‹ Back", () => this.go(-1));
        prev.disabled = this.page === 0;
        footer.appendChild(prev);

        const dots = el("div", "zx-lp-dots");
        PAGES.forEach((_, i) => {
            const d = el("button", "zx-lp-pip" + (i === this.page ? " is-on" : ""));
            d.setAttribute("aria-label", `Page ${i + 1} of ${PAGES.length}`);
            const idx = i;
            d.addEventListener("click", () => { this.page = idx; this.render(); });
            dots.appendChild(d);
        });
        footer.appendChild(dots);

        const last = this.page === PAGES.length - 1;
        const next = button("zx-lp-nav zx-lp-next", last ? "Add fields to begin" : "Next ›", () => { if (!last) this.go(1); });
        next.disabled = last;
        footer.appendChild(next);
        content.appendChild(footer);

        card.appendChild(content);
        host.appendChild(card);
    }

    private injectStyle(): void {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = LANDING_CSS;
        (document.head || document.documentElement).appendChild(style);
    }
}

// --- DOM helpers (no innerHTML) ---------------------------------------------
function el(tag: string, className: string): HTMLElement { const e = document.createElement(tag); e.className = className; return e; }
function textEl(tag: string, className: string, text: string): HTMLElement { const e = el(tag, className); e.textContent = text; return e; }
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = className; b.type = "button"; b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
}
/** The 5×3 mini-heatmap brand mark. */
function brandGlyph(): SVGSVGElement {
    const s = svgNode("0 0 24 24", 18, 18);
    s.setAttribute("fill", "currentColor");
    const fills = [0.3, 0.55, 1, 0.45, 0.75, 0.9, 0.35, 1, 0.6, 0.85];
    let i = 0;
    for (let row = 0; row < 2; row++) for (let col = 0; col < 5; col++) {
        const r = rectNode(2 + col * 4.3, 7 + row * 5, 3.5, 3.5, 0.9, "currentColor");
        r.setAttribute("opacity", String(fills[i++]));
        s.appendChild(r);
    }
    return s;
}

const LANDING_CSS = `
.zx-lp{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  padding:18px;box-sizing:border-box;overflow:auto;z-index:5;
  font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
  --lp-fg:#15161E;--lp-muted:#54566B;--lp-sub:#8A8C9E;--lp-accent:#7C5CFF;
  --lp-soft:rgba(124,92,255,0.12);--lp-border:rgba(20,23,50,0.09);--lp-card:#FFFFFF;
  --lp-art-a:#F3EFFE;--lp-art-b:#E5DBFB;
  background:radial-gradient(120% 120% at 100% 0%, rgba(124,92,255,.10), transparent 55%),
             radial-gradient(120% 120% at 0% 100%, rgba(124,92,255,.07), transparent 55%),#FBFBFE;}
.zx-lp[data-theme="dark"]{--lp-fg:#F4F4F6;--lp-muted:#A6A6B5;--lp-sub:#70707F;
  --lp-soft:rgba(124,92,255,0.20);--lp-border:rgba(255,255,255,0.10);--lp-card:#15151F;
  --lp-art-a:#1B1633;--lp-art-b:#120F24;
  background:radial-gradient(120% 120% at 100% 0%, rgba(124,92,255,.16), transparent 55%),
             radial-gradient(120% 120% at 0% 100%, rgba(124,92,255,.10), transparent 55%),#0C0C12;}
.zx-lp-card{width:min(960px,100%);height:min(520px,100%);min-height:0;display:flex;
  background:var(--lp-card);border:1px solid var(--lp-border);border-radius:20px;overflow:hidden;
  box-shadow:0 24px 60px -24px rgba(16,24,64,0.34);box-sizing:border-box;}
.zx-lp-art{flex:1 1 46%;min-width:0;min-height:0;display:flex;align-items:center;justify-content:center;
  padding:26px 24px;box-sizing:border-box;overflow:hidden;
  background:linear-gradient(150deg,var(--lp-art-a),var(--lp-art-b));}
/* viewBox + default preserveAspectRatio = scale-to-fit, centered, never distorts
   or overflows — the art letterboxes inside whatever height the card has. */
.zx-lp-art-inner{flex:1;min-width:0;min-height:0;align-self:stretch;display:flex;
  align-items:center;justify-content:center;}
.zx-lp-art-inner svg{width:100% !important;height:100% !important;
  filter:drop-shadow(0 10px 22px rgba(80,50,180,.18));}
.zx-lp-content{flex:1 1 54%;min-width:0;min-height:0;display:flex;flex-direction:column;
  padding:26px 30px 18px;box-sizing:border-box;overflow:hidden;}
/* Narrow tiles: drop the art, give the copy the full width (still legible). */
@media (max-width:560px){.zx-lp-art{display:none;}.zx-lp-content{flex:1 1 100%;}}
.zx-lp-brand{display:flex;align-items:center;gap:7px;color:var(--lp-accent);margin-bottom:16px;}
.zx-lp-brandname{font-size:11px;font-weight:700;letter-spacing:2.5px;}
.zx-lp-ver{font-size:10px;font-weight:600;letter-spacing:.5px;opacity:.5;}
.zx-lp-eyebrow{font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;
  color:var(--lp-accent);margin-bottom:7px;}
.zx-lp-title{font-size:25px;font-weight:800;color:var(--lp-fg);margin:0 0 16px;line-height:1.18;
  letter-spacing:-.3px;}
.zx-lp-body{flex:1;min-height:0;overflow-y:auto;}
.zx-lp-line{font-size:14px;line-height:1.55;color:var(--lp-muted);margin:0 0 10px;}
.zx-lp-bullet{display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;}
.zx-lp-tick{flex:none;width:18px;height:18px;border-radius:50%;background:var(--lp-soft);
  color:var(--lp-accent);font-size:11px;font-weight:800;display:grid;place-items:center;margin-top:1px;}
.zx-lp-bulltext{font-size:13.5px;line-height:1.5;color:var(--lp-muted);}
.zx-lp-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;
  margin-top:18px;padding-top:16px;border-top:1px solid var(--lp-border);}
.zx-lp-nav{appearance:none;border:1px solid var(--lp-border);background:transparent;
  color:var(--lp-muted);font:600 12.5px inherit;padding:8px 14px;border-radius:10px;
  cursor:pointer;transition:.15s;white-space:nowrap;}
.zx-lp-nav:hover:not(:disabled){color:var(--lp-fg);border-color:var(--lp-accent);}
.zx-lp-nav:disabled{opacity:0;pointer-events:none;}
.zx-lp-next{background:var(--lp-accent);border-color:var(--lp-accent);color:#fff;
  box-shadow:0 6px 16px -6px rgba(124,92,255,.7);}
.zx-lp-next:hover:not(:disabled){filter:brightness(1.07);color:#fff;}
.zx-lp-next:disabled{opacity:.6;background:var(--lp-soft);border-color:transparent;
  color:var(--lp-accent);box-shadow:none;}
.zx-lp-dots{display:flex;gap:7px;align-items:center;}
.zx-lp-pip{width:7px;height:7px;border-radius:50%;border:0;padding:0;cursor:pointer;
  background:var(--lp-border);transition:.2s;}
.zx-lp-pip.is-on{background:var(--lp-accent);width:22px;border-radius:4px;}
@media (prefers-reduced-motion: no-preference){
  .zx-lp-cell{animation:zxCell .42s cubic-bezier(.2,.7,.3,1) backwards;}
  @keyframes zxCell{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
  .zx-lp-chip{animation:zxChip .5s ease backwards .35s;}
  @keyframes zxChip{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .zx-lp-card{animation:zxCard .4s cubic-bezier(.2,.7,.3,1);}
  @keyframes zxCard{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
}
`;
