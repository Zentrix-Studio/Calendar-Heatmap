"use strict";

// MIRROR OF @zentrix/visual-settings — do not hand-edit.
// Edit the golden source (zentrix/packages/visual-settings/src/...) 
// and re-mirror via scripts/sync-shared.mjs. Verified by sync-shared.mjs --check.

/**
 * Zentrix Settings Bar — the canonical in-visual settings component.
 *
 * A self-contained, dependency-free, schema-driven port of the Zentrix
 * "category master–detail + modern control kit" design (see the build prompt).
 * Framework-agnostic vanilla DOM/TS so it drops into any Power BI custom visual.
 *
 * GLOBAL / REUSABLE: this file is the GOLDEN SOURCE (@zentrix/visual-settings).
 * Per-visual code only provides a `cfg` adapter (get/set by string key) + a
 * `cats` schema; the bar, controls, styling, animations and interaction model
 * are identical everywhere. Each visual vendors a byte-faithful MIRROR of this
 * file (verified by sync-shared.mjs --check). To change the look/behavior:
 * edit HERE, then re-mirror into every visual. Never style-edit a vendored copy.
 *
 * Z-151: re-promoted from the heatmap's drifted vendored copy (isOpen / labelFn /
 * visibleIf / SBSub.info / two-tap Reset / Escape-dismiss / reveal animations).
 * The heatmap-specific swatch ramp-mode gating was reverted to generic here.
 */

/* ───────────────────────── public schema types ───────────────────────── */

/** Live settings access — the host maps string keys to its real model + persist. */
export interface SBCfg {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    /** Optional: revert every visual property to its model default. When absent,
     *  the bar hides its Reset action. */
    reset?(): void;
}

/** A menu/seg option: a bare string (value === label) or an explicit [value, label]. */
export type SBOption = string | [value: string | number, label: string];

export interface SBPalette { name: string; light: string[]; }
export interface SBFont { id: string; label: string; css: string; }

/** Power BI high-contrast colours (from host.colorPalette when isHighContrast).
 *  Any subset is fine — missing roles fall back to CSS system colours. */
export interface SBHCColors {
    foreground?: string;          // CanvasText  → text + borders
    background?: string;          // Canvas      → all surfaces
    foregroundSelected?: string;  // Highlight   → accent / active fills
    hyperlink?: string;           // LinkText    → accent fallback
}

/** One control inside a `fields` detail pane. */
export interface SBField {
    control: "switch" | "stepper" | "segText" | "segIcon" | "multiSeg" | "text" | "font" | "color" | "emoji" | "divider" | "heading";
    label?: string;
    /** Dynamic label computed from the live cfg (e.g. a rule's current condition
     *  summary). When present it overrides `label` for both display and aria name. */
    labelFn?: (get: (key: string) => unknown) => string;
    key?: string;                         // single-key controls
    keys?: string[];                      // multiSeg → [boldKey, italicKey, underlineKey]
    glyphs?: string[];                    // multiSeg glyph labels (B/I/U)
    options?: SBOption[];                 // segText
    iconOptions?: [string | number, "left" | "center" | "right"][]; // segIcon → [value, icon]
    min?: number; max?: number; step?: number; suffix?: string;     // stepper
    placeholder?: string;                 // text
    /** When present, the field is only rendered when this predicate returns true.
     *  `get` reads any engine-key value via the live cfg (cross-section reads are fine). */
    visibleIf?: (get: (key: string) => unknown) => boolean;
}

/** A sub-group: one row in the left rail, one detail pane. */
export interface SBSub {
    id: string;
    name?: string;
    info?: string;                        // hover-tooltip text describing what this group does
    desc?: string;                        // short one-line description shown under the rail row name
    badge?: string;                       // small uppercase pill on the rail row (e.g. "Grid mode")
    special?: boolean;                    // mark a featured row (⚡ accent) — e.g. Quick start
    kind: "menu" | "swatch" | "fields";
    key?: string;                         // menu / swatch
    options?: SBOption[];                 // menu
    swatches?: string[];                  // swatch → palette ids (resolved via opts.palettes)
    fields?: SBField[];                   // fields
    width?: number;                       // detail-pane width override
}

/** A top-level category: one button in the open bar. */
export interface SBCategory { id: string; name: string; flat?: boolean; subs: SBSub[]; }

export interface SBOptions {
    cfg: SBCfg;
    cats: SBCategory[];
    fonts: SBFont[];
    palettes: Record<string, SBPalette>;
    presets?: string[];                   // color-picker preset swatches
    emoji?: string[];
    corner?: string;                      // bl | tl | tr | br
    dark?: boolean;
    hc?: boolean;                         // start in high-contrast mode
    hcColors?: SBHCColors;                // host high-contrast palette
    closeOnAway?: boolean;
}

/* ───────────────────────── layout constants ───────────────────────── */

const RAIL_W = 198;   // wider rail to fit the per-row description line
const POP_PAD = 18;
const VIEWPORT_MAX = 600;

function defaultWidth(sub: SBSub): number {
    if (sub.width != null) return sub.width;
    if (sub.kind === "swatch") return 196;
    if (sub.kind === "menu") return 184;
    return 282; // fields
}
const catMaxWidth = (c: SBCategory): number => Math.max(...c.subs.map(defaultWidth));

const optValue = (o: SBOption): string => String(Array.isArray(o) ? o[0] : o);
const optLabel = (o: SBOption): string => String(Array.isArray(o) ? o[1] : o);

/** Rough rendered width (px) of a segmented-text control. Used to decide whether
 *  it can sit inline beside its label or must drop to a full-width stacked row
 *  (so long option sets like a 4-way palette mode wrap instead of clipping). */
const estimateSegWidth = (opts: SBOption[]): number =>
    opts.reduce((w, o) => w + optLabel(o).length * 6.8 + 24, 0) + 8;
/** A segText wider than this many px stacks below the label and wraps its buttons. */
const SEG_INLINE_MAX = 150;

/* ───────────────────────── color math (manual HSV picker) ───────────────────────── */

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
function hexToRgb(h: string): [number, number, number] {
    h = (h || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return [124, 92, 255];
    const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
    const f = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
    return "#" + f(r) + f(g) + f(b);
}
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return { h, s: mx ? d / mx : 0, v: mx };
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c; let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const hexToHsv = (hex: string) => { const [r, g, b] = hexToRgb(hex); return rgbToHsv(r, g, b); };
const hsvToHex = (h: number, s: number, v: number) => { const [r, g, b] = hsvToRgb(h, s, v); return rgbToHex(r, g, b); };
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/* ───────────────────────── DOM + SVG helpers ───────────────────────── */

const NS = "http://www.w3.org/2000/svg";
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); if (cls) e.className = cls; return e;
}
const div = (cls?: string) => el("div", cls);
const btn = (cls?: string) => el("button", cls);

function svg(paths: string[], viewBox: string, sw: string, w: number, extra?: (s: SVGSVGElement) => void): SVGSVGElement {
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("width", String(w)); s.setAttribute("height", String(w));
    s.setAttribute("viewBox", viewBox); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", sw); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    for (const d of paths) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); s.appendChild(p); }
    if (extra) extra(s);
    return s;
}
function gearIcon(): SVGSVGElement {
    const s = svg(["M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"], "0 0 24 24", "1.55", 17);
    const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "3"); s.appendChild(c);
    return s;
}
function infoIcon(): SVGSVGElement {
    const s = svg(["M12 11.5v5", "M12 7.75h.01"], "0 0 24 24", "2", 15);
    const c = document.createElementNS(NS, "circle"); c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "9.25"); s.appendChild(c);
    return s;
}
const resetIcon = () => svg(["M2.5 8a5.5 5.5 0 1 0 1.7-3.98", "M2.2 2v3.3h3.3"], "0 0 16 16", "1.6", 15); // circular arrow
const caretIcon = () => svg(["M3.5 6 8 10.5 12.5 6"], "0 0 16 16", "1.8", 12);   // down; rotate 180 when open
const chevR = () => svg(["M6 3.5 10.5 8 6 12.5"], "0 0 16 16", "1.8", 13);          // rail ›
const dblChev = (left: boolean) => svg(["M4 4 8.5 9 4 14", "M9.5 4 14 9 9.5 14"], "0 0 18 18", "2.1", 17, s => { if (left) s.style.transform = "rotate(180deg)"; });
const checkIcon = () => svg(["M3.5 8.5 6.5 11.5 12.5 4.5"], "0 0 16 16", "2", 14);
function alignIcon(dir: "left" | "center" | "right"): SVGSVGElement {
    const ys = [4, 7.5, 11, 14.5], ws = [14, 9, 13, 8];
    const ds = ys.map((y, i) => {
        const w = ws[i]; const x = dir === "left" ? 3 : dir === "right" ? 15 - w : 9 - w / 2;
        return `M${x} ${y} h${w}`;
    });
    return svg(ds, "0 0 18 18", "1.7", 16);
}

/* ───────────────────────── injected styles ───────────────────────── */

const STYLE_ID = "zx-settingsbar-style";
function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const st = document.createElement("style"); st.id = STYLE_ID; st.textContent = CSS;
    document.head.appendChild(st);
}

/* ═════════════════════════ the component ═════════════════════════ */

export class ZentrixSettingsBar {
    private anchor: HTMLDivElement;
    private gear: HTMLButtonElement;
    private bar: HTMLDivElement | null = null;
    private vp: HTMLDivElement | null = null;
    private row: HTMLDivElement | null = null;
    private pageL: HTMLButtonElement | null = null;
    private pageR: HTMLButtonElement | null = null;
    private pop: HTMLDivElement | null = null;
    private detailWrap: HTMLDivElement | null = null;
    private detailInner: HTMLDivElement | null = null;
    private infoBtn: HTMLButtonElement | null = null;
    private infoTip: HTMLDivElement | null = null;
    private ro: ResizeObserver | null = null;
    private onDoc: ((e: MouseEvent) => void) | null = null;
    private onKey: ((e: KeyboardEvent) => void) | null = null;   // Escape-to-dismiss (keyboard escape hatch)
    private closeTimer: number | null = null;   // pending bar-teardown after the close animation
    private resetBtn: HTMLButtonElement | null = null;
    private resetArmed = false;                  // two-tap confirm state for Reset
    private resetTimer: number | null = null;    // auto-disarm timer for Reset

    private open = false;
    private activeCat: string | null = null;
    private activeSub: string | null = null;
    private exp: string | null = null;        // id of the one expanded picker
    private popLeft = 0;
    private offset = 0;
    private maxOffset = 0;
    private corner = "bl";
    private hc = false;                       // high-contrast mode active

    constructor(private host: HTMLElement, private opts: SBOptions) {
        ensureStyle();
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        this.corner = opts.corner || "bl";
        this.hc = Boolean(opts.hc);
        this.anchor = div("zsb-anchor");
        this.anchor.setAttribute("data-corner", this.corner);
        if (opts.hcColors) this.writeHCColors(opts.hcColors);
        this.applyTheme();
        this.gear = btn("zsb-gear zsb-collapsed");
        this.gear.title = "Visual settings";
        this.gear.setAttribute("aria-label", "Visual settings");
        this.gear.setAttribute("aria-haspopup", "true");
        this.gear.appendChild(gearIcon());
        this.gear.onclick = (e) => { e.stopPropagation(); this.open ? this.collapse() : this.expand(); };
        this.anchor.appendChild(this.gear);
        host.appendChild(this.anchor);
    }

    /* ---- public host API ---- */
    /** True while the settings bar is expanded — the host suppresses competing
     *  hover tooltips/rings so the open menu isn't fighting a cursor card (issue #7). */
    isOpen(): boolean { return this.open; }
    /** Switch light/dark. High contrast (when active) takes precedence over both. */
    setTheme(dark: boolean): void { this.opts.dark = dark; this.applyTheme(); }
    /** Enter/leave Power BI high-contrast mode. When `on`, the bar themes itself
     *  from the host palette (or CSS system colours if none given) instead of the
     *  brand palette, and HC wins over light/dark until turned off. */
    setHighContrast(on: boolean, colors?: SBHCColors): void {
        this.hc = on;
        if (on && colors) this.writeHCColors(colors);
        this.applyTheme();
    }
    /** Resolve the active theme attribute: hc → dark → light. */
    private applyTheme(): void {
        this.anchor.setAttribute("data-theme", this.hc ? "hc" : (this.opts.dark ? "dark" : "light"));
    }
    /** Push host HC roles into CSS custom properties the [data-theme="hc"] block reads. */
    private writeHCColors(c: SBHCColors): void {
        const s = this.anchor.style;
        if (c.foreground) s.setProperty("--hc-fg", c.foreground);
        if (c.background) s.setProperty("--hc-bg", c.background);
        const accent = c.foregroundSelected || c.hyperlink;
        if (accent) s.setProperty("--hc-accent", accent);
    }
    setVisible(show: boolean): void { this.anchor.style.display = show ? "flex" : "none"; }
    setCloseOnAway(v: boolean): void { this.opts.closeOnAway = v; }
    setCorner(corner: string): void {
        if (corner === this.corner && this.anchor.getAttribute("data-corner") === corner) return;
        this.corner = corner; this.anchor.setAttribute("data-corner", corner);
        if (this.pop) this.pop.classList.toggle("zsb-pop--down", this.opensDown);
    }
    private get opensDown(): boolean { return this.corner === "tl" || this.corner === "tr"; }

    /** Harness/host helper: open the bar and, if given, the category containing `subId`. */
    forceOpen(subId?: string): void {
        this.expand();
        if (!subId) return;
        const cat = this.opts.cats.find(c => c.subs.some(s => s.id === subId));
        if (!cat) return;
        const b = this.row?.querySelector(`[data-cat="${cat.id}"]`) as HTMLButtonElement | null;
        this.openCat(cat, b ?? undefined, subId);
    }

    destroy(): void {
        if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
        if (this.resetTimer) { clearTimeout(this.resetTimer); this.resetTimer = null; }
        if (this.ro) { this.ro.disconnect(); this.ro = null; }
        if (this.onDoc) { document.removeEventListener("mousedown", this.onDoc); this.onDoc = null; }
        if (this.onKey) { document.removeEventListener("keydown", this.onKey); this.onKey = null; }
        this.open = false;
        this.anchor.remove();
    }

    /* ---- open / collapse ---- */
    private expand(): void {
        // cancel any in-flight close so a quick re-open rebuilds cleanly
        if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
        this.open = true; this.buildBar();
    }
    private collapse(): void {
        if (!this.open && !this.bar) return;
        this.disarmReset(); this.resetBtn = null;
        this.open = false; this.activeCat = this.activeSub = this.exp = null;
        if (this.ro) { this.ro.disconnect(); this.ro = null; }
        if (this.onDoc) { document.removeEventListener("mousedown", this.onDoc); this.onDoc = null; }
        if (this.onKey) { document.removeEventListener("keydown", this.onKey); this.onKey = null; }
        // the popover (if any) is torn down at once; only the bar + gear animate out
        if (this.pop) { this.pop.remove(); this.pop = null; }
        this.detailWrap = this.detailInner = null;
        this.infoBtn = this.infoTip = null;

        const bar = this.bar;
        const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!bar || reduce) { this.finalizeClose(bar); return; }

        // play the reverse reveal + gear spin-back, then tear the bar down
        this.gear.className = "zsb-gear zsb-gear--closing"; this.gear.title = "Visual settings";
        bar.classList.add("zsb-bar--closing");
        const done = (e?: AnimationEvent) => {
            if (e && e.target !== bar) return;   // ignore the gear svg's bubbled animationend
            bar.removeEventListener("animationend", done as EventListener);
            if (this.closeTimer) { clearTimeout(this.closeTimer); this.closeTimer = null; }
            this.finalizeClose(bar);
        };
        bar.addEventListener("animationend", done as EventListener);
        this.closeTimer = (setTimeout(done, 480) as unknown) as number;   // fallback if animationend is missed
    }
    /** Re-parent the gear back to the anchor (collapsed) and remove the bar. */
    private finalizeClose(bar: HTMLDivElement | null): void {
        if (this.open) return;   // a re-open won the race; leave the rebuilt bar alone
        this.gear.className = "zsb-gear zsb-collapsed"; this.gear.title = "Visual settings";
        this.anchor.appendChild(this.gear);
        if (bar) bar.remove();
        if (this.bar === bar) this.bar = null;
    }

    private buildBar(): void {
        if (this.bar) this.bar.remove();
        this.bar = div("zsb-bar");
        this.gear.className = "zsb-gear is-open"; this.gear.title = "Hide settings";
        this.bar.appendChild(this.gear);
        this.bar.appendChild(div("zsb-div"));

        this.pageL = btn("zsb-page zsb-page-anim"); this.pageL.title = "Previous"; this.pageL.setAttribute("aria-label", "Previous settings"); this.pageL.appendChild(dblChev(true));
        this.pageL.onclick = (e) => { e.stopPropagation(); this.page(-1); };

        this.vp = div("zsb-viewport");
        this.row = div("zsb-row");
        for (const c of this.opts.cats) {
            const wrap = div("zsb-mwrap");
            const b = btn("zsb-group"); b.setAttribute("data-cat", c.id);
            b.appendChild(Object.assign(document.createElement("span"), { textContent: c.name }));
            b.appendChild(caretIcon());
            b.onclick = (e) => { e.stopPropagation(); this.toggleCat(c, b); };
            wrap.appendChild(b); this.row.appendChild(wrap);
        }
        this.vp.appendChild(this.row);

        this.pageR = btn("zsb-page zsb-page-anim"); this.pageR.title = "More"; this.pageR.setAttribute("aria-label", "More settings"); this.pageR.appendChild(dblChev(false));
        this.pageR.onclick = (e) => { e.stopPropagation(); this.page(1); };

        this.bar.appendChild(this.pageL); this.bar.appendChild(this.vp); this.bar.appendChild(this.pageR);
        this.buildResetAction();
        this.buildBrand();
        this.anchor.appendChild(this.bar);

        this.offset = 0; this.measure();
        this.ro = new ResizeObserver(() => this.measure());
        this.ro.observe(this.vp); this.ro.observe(this.row);
        this.onDoc = (e) => {
            if (!this.bar || this.bar.contains(e.target as Node)) return;
            if (this.opts.closeOnAway) this.collapse(); else this.closePop();
        };
        document.addEventListener("mousedown", this.onDoc);
        // Escape-to-dismiss — a reliable keyboard escape hatch (the in-host pointer
        // path can be flaky to dismiss). Unwinds one layer at a time: an expanded
        // picker → the open category popover → finally the whole bar.
        this.onKey = (e) => {
            if (!this.open || (e.key !== "Escape" && e.key !== "Esc")) return;
            if (this.exp) { this.exp = null; this.rerenderExpandable(); }
            else if (this.activeCat) { this.closePop(); }
            else { this.collapse(); }
            e.stopPropagation(); e.preventDefault();
        };
        document.addEventListener("keydown", this.onKey);
        this.applyOffset();
    }

    /* ---- reset action (two-tap confirm) ---- */
    /** Append the "Reset to defaults" action to the bar — only when the host
     *  provides cfg.reset. A first tap arms it (label → "Confirm"); a second tap
     *  within the timeout commits and reverts every setting to its default. */
    private buildResetAction(): void {
        if (!this.bar || typeof this.cfg.reset !== "function") return;
        this.bar.appendChild(div("zsb-div"));
        const b = btn("zsb-reset"); b.type = "button"; b.title = "Reset all settings to defaults";
        b.appendChild(resetIcon());
        b.appendChild(Object.assign(document.createElement("span"), { className: "zsb-reset-label", textContent: "Reset" }));
        b.onclick = (e) => { e.stopPropagation(); this.onReset(b); };
        this.resetBtn = b;
        this.bar.appendChild(b);
    }

    /** Append the small "● ZENTRIX" brand mark to the right end of the dark bar. */
    private buildBrand(): void {
        if (!this.bar) return;
        this.bar.appendChild(div("zsb-div"));
        const brand = div("zsb-brand");
        brand.appendChild(div("zsb-brand-dot"));
        brand.appendChild(Object.assign(document.createElement("span"), { className: "zsb-brand-name", textContent: "ZENTRIX" }));
        this.bar.appendChild(brand);
    }

    private onReset(b: HTMLButtonElement): void {
        if (!this.resetArmed) {
            this.resetArmed = true;
            b.classList.add("zsb-reset--armed");
            (b.querySelector(".zsb-reset-label") as HTMLElement).textContent = "Confirm";
            if (this.resetTimer) clearTimeout(this.resetTimer);
            this.resetTimer = (setTimeout(() => this.disarmReset(), 2600) as unknown) as number;
            return;
        }
        this.disarmReset();
        this.cfg.reset?.();
        this.closePop();
    }

    private disarmReset(): void {
        if (this.resetTimer) { clearTimeout(this.resetTimer); this.resetTimer = null; }
        this.resetArmed = false;
        if (this.resetBtn) {
            this.resetBtn.classList.remove("zsb-reset--armed");
            const lbl = this.resetBtn.querySelector(".zsb-reset-label") as HTMLElement | null;
            if (lbl) lbl.textContent = "Reset";
        }
    }

    /* ---- paging ---- */
    private measure(): void {
        if (!this.vp || !this.row) return;
        this.maxOffset = Math.max(0, this.row.scrollWidth - this.vp.clientWidth);
        this.offset = Math.min(this.offset, this.maxOffset);
        this.applyOffset();
    }
    private applyOffset(): void {
        if (!this.row || !this.vp || !this.pageL || !this.pageR) return;
        const canL = this.offset > 1, canR = this.offset < this.maxOffset - 1;
        this.pageL.style.display = canL ? "grid" : "none";
        this.pageR.style.display = canR ? "grid" : "none";
        // IMPORTANT: a standing transform (even translateX(0)) or a mask-image promotes the
        // category names onto a GPU compositing layer. That layer renders text with grayscale
        // (not subpixel) AA and re-rasterizes on every repaint — so a click that triggers the
        // visual's update()/repaint momentarily blurs the names. Only apply them while there is
        // actually content to page; otherwise paint the names crisply, direct to screen.
        if (this.offset > 0) this.row.style.transform = `translateX(${-this.offset}px)`;
        else this.row.style.removeProperty("transform");
        if (canL || canR) {
            const mask = `linear-gradient(90deg, ${canL ? "transparent 0," : ""} #000 ${canL ? "26px" : "0"}, #000 calc(100% - ${canR ? "26px" : "0px"}) ${canR ? ", transparent 100%" : ""})`;
            this.vp.style.setProperty("mask-image", mask);
            this.vp.style.setProperty("-webkit-mask-image", mask);
        } else {
            this.vp.style.removeProperty("mask-image");
            this.vp.style.removeProperty("-webkit-mask-image");
        }
    }
    private page(dir: number): void {
        this.closePop();
        const step = (this.vp ? this.vp.clientWidth : VIEWPORT_MAX) * 0.78;
        this.offset = Math.max(0, Math.min(this.maxOffset, this.offset + dir * step));
        this.applyOffset();
    }

    /* ---- category popover (master-detail) ---- */
    private toggleCat(c: SBCategory, b: HTMLButtonElement): void {
        if (this.activeCat === c.id) { this.closePop(); return; }
        this.openCat(c, b);
    }
    private closePop(): void {
        this.activeCat = this.activeSub = this.exp = null;
        if (this.pop) { this.pop.remove(); this.pop = null; }
        this.detailWrap = this.detailInner = null;
        this.infoBtn = this.infoTip = null;
        this.markCats();
    }
    private markCats(): void {
        this.row?.querySelectorAll(".zsb-group").forEach(g => {
            const on = g.getAttribute("data-cat") === this.activeCat;
            g.setAttribute("data-open", String(on));
            const c = g.querySelector("svg"); if (c) (c as SVGElement).style.transform = on ? "rotate(180deg)" : "rotate(0deg)";
        });
    }

    private openCat(c: SBCategory, b?: HTMLButtonElement, subId?: string): void {
        if (this.pop) { this.pop.remove(); this.pop = null; }
        this.activeCat = c.id;
        this.activeSub = subId && c.subs.some(s => s.id === subId) ? subId : c.subs[0].id;
        this.exp = null;
        this.markCats();
        if (!this.bar) return;
        // position the popover left, clamped within the bar
        const barRect = this.bar.getBoundingClientRect();
        const trigger = b ?? (this.row!.querySelector(`[data-cat="${c.id}"]`) as HTMLElement);
        const r = trigger.getBoundingClientRect();
        const popW = (c.flat ? 0 : RAIL_W) + catMaxWidth(c) + POP_PAD;
        this.popLeft = Math.max(8, Math.min(r.left - barRect.left, barRect.width - popW - 6));
        this.buildPop(c);
    }

    private buildPop(c: SBCategory): void {
        if (!this.bar) return;
        this.pop = div("zsb-pop zsb-pop-anim" + (this.opensDown ? " zsb-pop--down" : ""));
        this.pop.style.left = `${Math.round(this.popLeft)}px`;
        this.pop.onclick = (e) => e.stopPropagation();

        const head = div("zsb-pop-head");
        const headL = div("zsb-pop-head-l");
        headL.appendChild(div("zsb-pop-accent"));   // gradient accent bar above the category title
        headL.appendChild(Object.assign(document.createElement("span"), { className: "zsb-pop-title", textContent: c.name }));
        head.appendChild(headL);
        this.infoBtn = btn("zsb-info"); this.infoBtn.type = "button"; this.infoBtn.setAttribute("aria-label", "About this setting");
        this.infoBtn.appendChild(infoIcon());
        this.infoTip = div("zsb-info-tip"); this.infoBtn.appendChild(this.infoTip);
        head.appendChild(this.infoBtn);
        this.pop.appendChild(head);
        const body = div("zsb-pop-body"); this.pop.appendChild(body);

        if (!c.flat) {
            const rail = div("zsb-rail");
            for (const s of c.subs) {
                const rb = btn("zsb-rail-row"); rb.setAttribute("data-active", String(s.id === this.activeSub));
                if (s.special) rb.setAttribute("data-special", "true");
                const txt = div("zsb-rail-txt");
                const nameRow = div("zsb-rail-name-row");
                nameRow.appendChild(Object.assign(document.createElement("span"), { className: "zsb-rail-name", textContent: s.name || s.id }));
                if (s.special) nameRow.appendChild(Object.assign(document.createElement("span"), { className: "zsb-rail-spark", textContent: "⚡" }));
                if (s.badge) nameRow.appendChild(Object.assign(document.createElement("span"), { className: "zsb-rail-badge", textContent: s.badge }));
                txt.appendChild(nameRow);
                if (s.desc) txt.appendChild(Object.assign(div("zsb-rail-desc"), { textContent: s.desc }));
                rb.appendChild(txt);
                rb.appendChild(chevR());
                rb.onclick = (e) => { e.stopPropagation(); if (this.activeSub === s.id) return; this.activeSub = s.id; this.exp = null; this.syncRail(); this.renderDetail(c); };
                rail.appendChild(rb);
            }
            body.appendChild(rail);
        }

        this.detailWrap = div("zsb-detail"); this.detailWrap.style.width = `${catMaxWidth(c)}px`;
        this.detailInner = div("zsb-detail-inner");
        this.detailWrap.appendChild(this.detailInner);
        body.appendChild(this.detailWrap);

        this.bar.appendChild(this.pop);
        this.renderDetail(c, true);
    }

    private syncRail(): void {
        this.pop?.querySelectorAll(".zsb-rail-row").forEach((rb, i) => {
            const cat = this.opts.cats.find(c => c.id === this.activeCat);
            const id = cat?.subs[i]?.id;
            rb.setAttribute("data-active", String(id === this.activeSub));
        });
    }

    /** Rebuild the detail inner and animate the wrapper to its new measured height. */
    private renderDetail(c: SBCategory, first = false): void {
        if (!this.detailWrap || !this.detailInner) return;
        const sub = c.subs.find(s => s.id === this.activeSub) || c.subs[0];
        this.updateInfo(sub);
        this.detailInner.textContent = "";
        this.renderSub(sub, this.detailInner);
        const h = this.detailInner.offsetHeight;
        if (first) {
            // popover itself animates in; set height with no separate transition jump
            this.detailWrap.style.transition = "none";
            this.detailWrap.style.height = `${h}px`;
            // re-enable transition next frame
            requestAnimationFrame(() => { if (this.detailWrap) this.detailWrap.style.transition = ""; });
        } else {
            this.detailWrap.style.height = `${h}px`;
        }
    }

    private remeasure(): void {
        if (!this.detailWrap || !this.detailInner) return;
        this.detailWrap.style.height = `${this.detailInner.offsetHeight}px`;
    }

    /**
     * Re-render the currently open sub so `visibleIf`-gated fields appear/disappear
     * the moment their controlling toggle/segment changes. Without this a field
     * change only persists + re-renders the chart; the open panel keeps showing
     * the stale field set (e.g. Number format → Custom revealed no input,
     * Variance bar → Show revealed no options). No-op when the panel is closed.
     */
    private refreshActiveDetail(): void {
        if (!this.pop || !this.detailWrap || !this.detailInner) return;
        const c = this.opts.cats.find(cat => cat.id === this.activeCat);
        if (c) this.renderDetail(c);
    }

    /** Point the header info icon + hover tooltip at the active sub-group's description. */
    private updateInfo(sub: SBSub): void {
        if (!this.infoBtn || !this.infoTip) return;
        const text = sub.info || "";
        this.infoBtn.style.display = text ? "grid" : "none";
        this.infoTip.textContent = text;
    }

    /* ---- detail renderers per kind ---- */
    private renderSub(sub: SBSub, host: HTMLElement): void {
        if (sub.kind === "menu") { this.renderMenu(sub, host); return; }
        if (sub.kind === "swatch") { this.renderSwatch(sub, host); return; }
        const getter = (k: string) => this.cfg.get(k);
        for (const f of (sub.fields || [])) {
            if (f.visibleIf && !f.visibleIf(getter)) continue;
            host.appendChild(this.renderField(f, sub));
        }
    }

    /** Resolve a control's accessible name. Generic field labels ("Size", "Color",
     *  "Align"…) are qualified with the sub-group name so the name is unambiguous
     *  out of context — e.g. "Months Size", "Header Align" (issue #3). */
    private ariaName(label: string, subName: string): string {
        const generic = /^(size|font|style|colou?r|width|align)$/i.test(label.trim());
        return generic && subName && !label.toLowerCase().includes(subName.toLowerCase())
            ? `${subName} ${label}` : label;
    }

    private renderMenu(sub: SBSub, host: HTMLElement): void {
        const key = sub.key!; const cur = String(this.cfg.get(key));
        for (const o of (sub.options || [])) {
            const v = optValue(o); const active = cur === v;
            const b = btn("zsb-opt"); b.setAttribute("data-active", String(active));
            b.appendChild(Object.assign(div("zsb-opt-label"), { textContent: optLabel(o) }));
            if (active) this.addCheck(b);
            b.onclick = () => { this.selectOpt(host, b, key, Array.isArray(o) ? o[0] : o); };
            host.appendChild(b);
        }
    }

    private renderSwatch(sub: SBSub, host: HTMLElement): void {
        const key = sub.key!; const cur = String(this.cfg.get(key));
        for (const id of (sub.swatches || [])) {
            const pal = this.opts.palettes[id]; if (!pal) continue;
            const active = cur === id;
            const b = btn("zsb-opt"); b.setAttribute("data-active", String(active));
            const sw = div("zsb-opt-sw"); sw.style.background = `linear-gradient(135deg, ${pal.light[1]}, ${pal.light[3]})`; b.appendChild(sw);
            b.appendChild(Object.assign(div("zsb-opt-label"), { textContent: pal.name }));
            if (active) this.addCheck(b);
            b.onclick = () => { this.selectOpt(host, b, key, id); };
            host.appendChild(b);
        }
    }

    private addCheck(b: HTMLElement): void { const c = checkIcon(); c.classList.add("zsb-check"); const wrap = div("zsb-accent"); wrap.appendChild(c); b.appendChild(wrap); }
    private selectOpt(host: HTMLElement, b: HTMLElement, key: string, value: string | number): void {
        host.querySelectorAll(".zsb-opt").forEach(o => { o.setAttribute("data-active", "false"); o.querySelector(".zsb-accent")?.remove(); });
        b.setAttribute("data-active", "true"); if (!b.querySelector(".zsb-accent")) this.addCheck(b);
        this.cfg.set(key, value);
    }

    private get cfg(): SBCfg { return this.opts.cfg; }

    /* ---- field controls ---- */
    private renderField(f: SBField, sub?: SBSub): HTMLElement {
        // Resolve the display label (labelFn wins — e.g. live rule summaries, issue #6)
        // and a sub-qualified accessible name for the control (issue #3).
        const label = (f.labelFn ? f.labelFn(k => this.cfg.get(k)) : f.label) ?? "";
        const subName = sub?.name ?? "";
        const aria = this.ariaName(label, subName);
        switch (f.control) {
            case "divider": return div("zsb-div-h");
            case "heading": { const d = div("zsb-field-head"); d.textContent = label; return d; }
            case "switch": return this.fieldRow(label, this.makeSwitch(f.key!, aria));
            case "stepper": return this.fieldRow(label, this.makeStepper(f, aria));
            case "segText": {
                const stack = estimateSegWidth(f.options || []) > SEG_INLINE_MAX;
                return this.fieldRow(label, this.makeSegText(f, aria, stack), stack);
            }
            case "segIcon": return this.fieldRow(label, this.makeSegIcon(f, aria));
            case "multiSeg": return this.fieldRow(label, this.makeMultiSeg(f, subName || aria));
            case "text": return this.fieldRow(label, this.makeText(f, aria));
            case "font": return this.makeExpandable(f, "font", aria);
            case "color": return this.makeExpandable(f, "color", aria);
            case "emoji": return this.makeExpandable(f, "emoji", aria);
        }
    }

    /** label-left / control-right inline row. */
    private fieldRow(label: string, control: HTMLElement, stack = false): HTMLElement {
        const wrap = div("zsb-field"); const top = div("zsb-field-top" + (stack ? " zsb-field-stack" : ""));
        top.appendChild(Object.assign(div("zsb-label"), { textContent: label }));
        top.appendChild(control); wrap.appendChild(top); return wrap;
    }

    private makeSwitch(key: string, aria?: string): HTMLElement {
        let on = Boolean(this.cfg.get(key));
        const b = btn("zsb-switch"); b.setAttribute("data-on", String(on)); b.appendChild(document.createElement("i"));
        b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on));
        if (aria) b.setAttribute("aria-label", aria);
        b.onclick = () => { on = !on; b.setAttribute("data-on", String(on)); b.setAttribute("aria-checked", String(on)); this.cfg.set(key, on); this.refreshActiveDetail(); };
        return b;
    }

    private makeStepper(f: SBField, aria?: string): HTMLElement {
        const min = f.min ?? 0, max = f.max ?? 999, step = f.step ?? 1;
        const name = aria ?? f.label ?? "value";
        let val = Number(this.cfg.get(f.key!)) || 0;
        const shell = div("zsb-step"); shell.setAttribute("role", "group"); shell.setAttribute("aria-label", name);
        const dec = btn("zsb-step-btn"); dec.textContent = "−"; dec.setAttribute("aria-label", `Decrease ${name}`);
        const inp = el("input", "zsb-step-in"); inp.type = "number"; inp.value = String(val); inp.setAttribute("aria-label", name);
        const suf = div("zsb-step-suffix"); if (f.suffix) suf.textContent = f.suffix; else suf.style.display = "none";
        const inc = btn("zsb-step-btn"); inc.textContent = "+"; inc.setAttribute("aria-label", `Increase ${name}`);
        const commit = (n: number) => { val = Math.max(min, Math.min(max, n)); inp.value = String(val); this.cfg.set(f.key!, val); };
        dec.onclick = () => commit(val - step); inc.onclick = () => commit(val + step);
        inp.onchange = () => commit(parseFloat(inp.value) || 0);
        shell.append(dec, inp, suf, inc); return shell;
    }

    private makeSegText(f: SBField, aria?: string, stack = false): HTMLElement {
        const key = f.key!; const cur = () => String(this.cfg.get(key));
        const seg = div("zsb-seg zsb-seg-text" + (stack ? " zsb-seg-wrap" : "")); seg.setAttribute("role", "radiogroup");
        if (aria) seg.setAttribute("aria-label", aria);
        for (const o of (f.options || [])) {
            const v = optValue(o); const b = btn("zsb-seg-btn"); b.textContent = optLabel(o);
            b.setAttribute("role", "radio");
            const sel = cur() === v; b.setAttribute("data-active", String(sel)); b.setAttribute("aria-checked", String(sel));
            b.setAttribute("aria-label", aria ? `${aria}: ${optLabel(o)}` : optLabel(o));
            b.onclick = () => { seg.querySelectorAll(".zsb-seg-btn").forEach(x => { x.setAttribute("data-active", "false"); x.setAttribute("aria-checked", "false"); }); b.setAttribute("data-active", "true"); b.setAttribute("aria-checked", "true"); this.cfg.set(key, Array.isArray(o) ? o[0] : o); this.refreshActiveDetail(); };
            seg.appendChild(b);
        }
        return seg;
    }

    private makeSegIcon(f: SBField, aria?: string): HTMLElement {
        const key = f.key!; const cur = () => String(this.cfg.get(key));
        const seg = div("zsb-seg"); seg.setAttribute("role", "radiogroup");
        if (aria) seg.setAttribute("aria-label", aria);
        for (const [v, icon] of (f.iconOptions || [])) {
            const b = btn("zsb-seg-btn"); b.appendChild(alignIcon(icon));
            b.setAttribute("role", "radio");
            // Icon-only buttons have no text node, so an explicit aria-label is mandatory.
            b.setAttribute("aria-label", aria ? `${aria}: ${icon}` : icon);
            const sel = cur() === String(v); b.setAttribute("data-active", String(sel)); b.setAttribute("aria-checked", String(sel));
            b.onclick = () => { seg.querySelectorAll(".zsb-seg-btn").forEach(x => { x.setAttribute("data-active", "false"); x.setAttribute("aria-checked", "false"); }); b.setAttribute("data-active", "true"); b.setAttribute("aria-checked", "true"); this.cfg.set(key, v); this.refreshActiveDetail(); };
            seg.appendChild(b);
        }
        return seg;
    }

    private makeMultiSeg(f: SBField, target?: string): HTMLElement {
        const keys = f.keys || []; const glyphs = f.glyphs || ["B", "I", "U"];
        // B/I/U are glyph-only — name each by its target + the style it toggles, e.g.
        // "Legend text bold" (issue #3). Falls back to the glyph if unmapped.
        const styleWord: Record<string, string> = { b: "bold", i: "italic", u: "underline" };
        const seg = div("zsb-seg"); seg.setAttribute("data-multi", "true"); seg.setAttribute("role", "group");
        if (target) seg.setAttribute("aria-label", target);
        keys.forEach((k, i) => {
            let on = Boolean(this.cfg.get(k));
            const glyph = glyphs[i] || "";
            const b = btn("zsb-seg-btn zsb-glyph-" + glyph.toLowerCase());
            b.textContent = glyph; b.setAttribute("data-active", String(on));
            b.setAttribute("role", "switch"); b.setAttribute("aria-checked", String(on));
            const word = styleWord[glyph.toLowerCase()] || glyph;
            b.setAttribute("aria-label", target ? `${target} ${word}` : word);
            b.onclick = () => { on = !on; b.setAttribute("data-active", String(on)); b.setAttribute("aria-checked", String(on)); this.cfg.set(k, on); this.refreshActiveDetail(); };
            seg.appendChild(b);
        });
        return seg;
    }

    private makeText(f: SBField, aria?: string): HTMLElement {
        const inp = el("input", "zsb-input"); inp.type = "text";
        inp.value = String(this.cfg.get(f.key!) ?? ""); if (f.placeholder) inp.placeholder = f.placeholder;
        if (aria) inp.setAttribute("aria-label", aria);
        inp.onchange = () => this.cfg.set(f.key!, inp.value);
        return inp;
    }

    /* ---- expandable controls (one open at a time) ---- */
    private makeExpandable(f: SBField, kind: "font" | "color" | "emoji", aria?: string): HTMLElement {
        const id = f.key!; const wrap = div("zsb-field");
        const trigger = btn("zsb-trigger"); trigger.setAttribute("data-open", String(this.exp === id));
        const labelSpan = Object.assign(document.createElement("span"), { textContent: aria ?? f.label ?? "", className: "zsb-label" });
        const valWrap = div("zsb-trigger-val");
        this.fillTriggerValue(valWrap, f, kind);
        // Accessible name = control + its current value, e.g. "Start / hue #7C5CFF",
        // "No-data Auto", "Font Segoe UI" (issue #3).
        trigger.setAttribute("aria-haspopup", "true"); trigger.setAttribute("aria-expanded", String(this.exp === id));
        trigger.setAttribute("aria-label", `${aria ?? f.label ?? ""} ${this.triggerValueText(f, kind)}`.trim());
        const chev = caretIcon(); chev.classList.add("zsb-chev");
        const head = div("zsb-trigger-head"); head.appendChild(labelSpan); head.appendChild(valWrap);
        trigger.appendChild(head); trigger.appendChild(chev);
        trigger.onclick = (e) => { e.stopPropagation(); this.exp = this.exp === id ? null : id; this.rerenderExpandable(); };
        wrap.appendChild(trigger);
        if (this.exp === id) wrap.appendChild(this.buildExpansion(f, kind, valWrap));
        return wrap;
    }

    /** The current value of an expandable control as plain text, for its aria name. */
    private triggerValueText(f: SBField, kind: "font" | "color" | "emoji"): string {
        const cur = String(this.cfg.get(f.key!) ?? "");
        if (kind === "color") return isHex(cur) ? cur.toUpperCase() : "Auto";
        if (kind === "font") { const font = this.opts.fonts.find(x => x.id === cur || x.css === cur); return font ? font.label : cur; }
        return cur;
    }

    private rerenderExpandable(): void {
        const cat = this.opts.cats.find(c => c.id === this.activeCat); if (cat) this.renderDetail(cat);
    }

    private fillTriggerValue(valWrap: HTMLElement, f: SBField, kind: "font" | "color" | "emoji"): void {
        valWrap.textContent = "";
        if (kind === "font") {
            const cur = String(this.cfg.get(f.key!)); const font = this.opts.fonts.find(x => x.id === cur || x.css === cur);
            const s = document.createElement("span"); s.textContent = font ? font.label : cur; if (font) s.style.fontFamily = font.css;
            valWrap.appendChild(s);
        } else if (kind === "color") {
            const cur = String(this.cfg.get(f.key!) || ""); const chip = div("zsb-color-chip");
            chip.style.background = isHex(cur) ? cur : "transparent";
            if (!isHex(cur)) chip.style.boxShadow = "inset 0 0 0 1px var(--border-default)";
            const hex = Object.assign(document.createElement("span"), { className: "zsb-mono", textContent: isHex(cur) ? cur.toUpperCase() : "Auto" });
            valWrap.append(chip, hex);
        } else {
            const s = Object.assign(document.createElement("span"), { className: "zsb-emoji-cur", textContent: String(this.cfg.get(f.key!) || "") });
            valWrap.appendChild(s);
        }
    }

    private buildExpansion(f: SBField, kind: "font" | "color" | "emoji", valWrap: HTMLElement): HTMLElement {
        const box = div("zsb-field-exp");
        if (kind === "font") box.appendChild(this.buildFontList(f, valWrap));
        else if (kind === "color") box.appendChild(this.buildColorPicker(f, valWrap));
        else box.appendChild(this.buildEmojiGrid(f, valWrap));
        return box;
    }

    private buildFontList(f: SBField, valWrap: HTMLElement): HTMLElement {
        const list = div("zsb-fontlist"); const cur = String(this.cfg.get(f.key!));
        for (const font of this.opts.fonts) {
            const o = btn("zsb-fontopt"); o.style.fontFamily = font.css;
            o.setAttribute("data-active", String(font.id === cur || font.css === cur));
            o.appendChild(Object.assign(document.createElement("span"), { textContent: font.label }));
            o.onclick = () => {
                list.querySelectorAll(".zsb-fontopt").forEach(x => x.setAttribute("data-active", "false")); o.setAttribute("data-active", "true");
                this.cfg.set(f.key!, font.id); this.fillTriggerValue(valWrap, f, "font");
            };
            list.appendChild(o);
        }
        return list;
    }

    private buildEmojiGrid(f: SBField, valWrap: HTMLElement): HTMLElement {
        const grid = div("zsb-emojigrid"); const cur = String(this.cfg.get(f.key!) || "");
        for (const em of (this.opts.emoji || [])) {
            const b = btn("zsb-emojibtn"); b.textContent = em; b.setAttribute("data-active", String(em === cur));
            b.onclick = () => {
                grid.querySelectorAll(".zsb-emojibtn").forEach(x => x.setAttribute("data-active", "false")); b.setAttribute("data-active", "true");
                this.cfg.set(f.key!, em); this.fillTriggerValue(valWrap, f, "emoji");
            };
            grid.appendChild(b);
        }
        return grid;
    }

    private buildColorPicker(f: SBField, valWrap: HTMLElement): HTMLElement {
        const cur0 = String(this.cfg.get(f.key!) || ""); const start = isHex(cur0) ? cur0 : "#7C5CFF";
        const cp = div("zsb-cp");
        const sv = div("zsb-cp-sv"); sv.appendChild(div("zsb-cp-sv-white")); sv.appendChild(div("zsb-cp-sv-black"));
        const svThumb = div("zsb-cp-thumb"); sv.appendChild(svThumb);
        const hue = div("zsb-cp-hue"); const hueThumb = div("zsb-cp-hue-thumb"); hue.appendChild(hueThumb);
        const rowEl = div("zsb-cp-row");
        const chip = div("zsb-color-chip"); const hex = el("input", "zsb-input zsb-hex");
        rowEl.append(chip, hex);
        const presetGrid = div("zsb-cp-presets");
        cp.append(sv, hue, rowEl, presetGrid);

        const state = hexToHsv(start);
        const paint = (commit: boolean) => {
            const col = hsvToHex(state.h, state.s, state.v);
            sv.style.background = `hsl(${state.h}, 100%, 50%)`;
            svThumb.style.left = `${state.s * 100}%`; svThumb.style.top = `${(1 - state.v) * 100}%`; svThumb.style.background = col;
            hueThumb.style.left = `${(state.h / 360) * 100}%`;
            chip.style.background = col; hex.value = col.toUpperCase();
            presetGrid.querySelectorAll(".zsb-swatch2").forEach(s => s.setAttribute("data-active", String((s.getAttribute("data-c") || "").toLowerCase() === col.toLowerCase())));
            if (commit) { this.cfg.set(f.key!, col); this.fillTriggerValue(valWrap, f, "color"); }
        };
        const drag = (apply: (cx: number, cy: number) => void) => (e: PointerEvent) => {
            e.preventDefault(); apply(e.clientX, e.clientY);
            const mv = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
            const up = () => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); };
            window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
        };
        sv.addEventListener("pointerdown", drag((cx, cy) => {
            const r = sv.getBoundingClientRect(); state.s = clamp01((cx - r.left) / r.width); state.v = clamp01(1 - (cy - r.top) / r.height); paint(true);
        }));
        hue.addEventListener("pointerdown", drag((cx) => {
            const r = hue.getBoundingClientRect(); state.h = clamp01((cx - r.left) / r.width) * 360; paint(true);
        }));
        hex.onchange = () => { let x = hex.value.trim(); if (x && !x.startsWith("#")) x = "#" + x; if (isHex(x)) { Object.assign(state, hexToHsv(x)); paint(true); } };
        for (const c of (this.opts.presets || [])) {
            const s = btn("zsb-swatch2"); s.style.background = c; s.setAttribute("data-c", c); s.title = c;
            s.onclick = () => { Object.assign(state, hexToHsv(c)); paint(true); };
            presetGrid.appendChild(s);
        }
        paint(false);
        return cp;
    }
}

/* ───────────────────────── CSS (tokens + components) ───────────────────────── */

const CSS = `
/* Outfit — the canonical Zentrix UI font (component library --font-ui). Power BI
   visuals are sandboxed and can't fetch Google Fonts, so the latin-subset variable
   woff2 (weights 300-800, OFL-licensed) is embedded here as a data URI. Single
   golden-source copy → mirrored byte-for-byte into every visual. */
@font-face{font-family:'Outfit';font-style:normal;font-weight:300 800;font-display:swap;src:url(data:font/woff2;base64,d09GMgABAAAAAH3kABMAAAABEuAAAH1vAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGokKG4GFEhyEfD9IVkFShwg/TVZBUlAGYD9TVEFUgR4AhQwvbBEICoGIUOtMC4N0ADCB3i4BNgIkA4dkBCAFhVoHhwBbHwFRwzYG1v56s4oV/Bf7Px4jEbpbFbILmqxmIyLYOBDI4F/V7P8/I+kYogG/BEBtZ/uBnkJOVlT2RBWqVmCBWd2chcqZC2XSTO0IInHVXbwa0SFEpEka0dQyJPJOsRqKcEk7wZQaFSPfzz0DpEnzvPG45NjXf4ZuL+6FQOM/bDJShiBYcvaRc1AUQnOfbvQ78WJe2Ib+2e4tyJG8kjxJnkCPy5+nKUt70flxkJY/R9BfX24dueSHLAPsFngxoSzHi0P//2PPb2af++S7aTKtao2ukQqZ0C1r0sSi0vD387zb/tz3HshDQEREVMQnmRKSIpmZLcSRmRrfzDErZ2rmymy7v7k+GrozM/RrY9pctmwsm8uW2bLxR2YtdSWd9LUg2ymdMGO4X4YHEw8PQeEh0IvvzSQf1O7HGTnKyUEVVF9/tVSjkjuqwgyPm/YPq8pKZVuFzrXbtTtV4bvs1GdW26q0iBU8JFgS4oQEAkV/tGnfE8xopAEDb4Ac+ExY/ttsfFe0V13RE+ACOmHbsQfY0g84Z/82h2FlOyi0aUuN1pNGKpYmqVqgjoyiU4HdHZufqG87Edt2/+/M1Afes3qtUzEdtSN0yaz1hbuc+A3lLWAMwP9Jp/VFFYakO5VU+gSXDtiSkCwxqECa0w2qGBQI2JTqKbXbs6X6cfG0apPbbj/ltP20p+bNaQ0Wspk/WLECM3H/Z6YdTpeeOvu6OV2NUTeTGhGMJiOM+Jg/QWSEMQ9hRPB0qKZWJeBmNVQDqUENstACtIwB2wEaINgjiMY+wN8SQ4aTDKMDbECVi+oTVHVJMff93i23uumBW0LWBNUX682b5vnn5cbfJInb0lbKUQQPm38g+GAHVad+Uo+rd+vrTpCq6czTdYm8d+I6EjIsUQgLdfdlyi/8nqpyi3MKY85WD5gPQGn396aa7T48LgmIZ5tfvEBnQjLmBNOJjqVCrC4WnUOuXO3+jwX278OSACnRBJcUGC4AYJK0F8iL5ILUgJCoEEk55MRwgbwQQ+m52rkKsXQru+pCKkp3dtXH9noXXeeiM8///95qtn9vQlURLzG4YZVsYUYYnH/9fvekA1kxnxx6ra/I2eLQoBCSNQVZpSANf/mq2S7w8Ugw3BmkHFYnh6Xjo6/5jrUCnHOXisbVAhCkD4CivzJEKvwjxZslefQtyQuf0EUSvBGVLtEpXUjxMcizFC98Bs/AIcbqUnKXO4/rEKd37bbyuHXbuC8N1abk7EJskkKCyCMihxxp6odoYv7r2S1Je+dRRAjCCGOMWIQQQgjXGBNMelzvn36/pvGplsqYN3ERsKGHy2YYm7p8h1GA5IQhpQ0moU6ys9oyDr7METjG3L9nYm+MbWMhICIRId4z1x+dIBxG/+cC4bEFYCxIB+Rk+BhR7jJTjJBHO0diGCTPaoAIeMihQ7b1AH2JIgRScyUjxoNPOwYdDuuBmjodOhzqgZp8BTqMZQ9Qk0Khw/B7gJrwBDoMqweqTYYOQ+uBymF0yI4eoCIPOqQmWfn0BAS6G+0TNk7xB03wmI9dPnEcGmCXDy9vzHErVkHu5XVMpmBLiAWfZL+ULLLGA8hDP2TiA+zFdGiJ1A0Nim0ar2hz2d/oBfXfuiGEMCCGTCCmTCFmLCFWxBCKFDKWC8SVK8SNGuLFG+LLHxIoEKIxBxIqHBJpHiROPCTZAkiqDEiWLEiOJY1PYS6224u89BrunfdwCAL0ITQvvfJ66v5FIOshQOYDvA9YCZgMh8EAKoz1VEQ5bXEyaw1Aj6d/vAAFG1G5PVq3x97d0b0ntHvhyn5OH2TLIbYc6u1hnhwTxB+cO17hqf47DaVnenl2TLiOLG5C/YWaL1V5daTeh73Xh/UTFPQUjt7q5J0OAwLwZ0F/HBbWBfN8/cXyRS4zjN04jukqn5G18vVMnstUStlAiNgYhhEYHWfhZmXe/m9VBJ1Yb4GiwKJEjRZrZOxxnZgWaS8iJlWaULpMWctWrvLKzCPPvM4frUp17Tp06kKXutat7vWgRz3pufyVffGc4s1FxiCMJVKZbK62ZWxmbr2kdogRJMVwgkJlOHrd9R+JIIoY4kggBanIZVoDgAIDDjwEKKCCJtNZmU1o0GHAChtsscMeB5xwwx0PvKU769jANvYi3KITk7gW9+JTTqlB3erVGDOZa7e4a3fv/tycH/av/mIeyP8LtrrcLvbk3FkKW+WydHX1scmFV5bnlrVirgwMgNBPf9IKFoc3ExAMzKZCUVEBAUNJaWAHHhTmgHPl9WoROAgAg98MIAx+xe1yESS/xbWDxVWpbgD+T2KOco3YfDO2yUz0QzwmOi6ECXDSYG8QNGkFLDTuFOyIsOBOpV2vGCaMeQ9QzqRvr7ipwC3Lxl55KwXX+GPa5n9RO9Ol19qCoIHVqEVJV3XL1rJW+DNES3l9MAJ0eJywH+akRJA9xlQ/hhBYcmlDBPPiwhb/zcEnts7nlGC4y8sn2EqJfYzyZgvwfFh5uvDirW78Dr83M0bTPxv7fgYm3kRDSgNOEwE9AXoJQbORerBV6ZtlUye6DrpAU/cHNwcH3s5c0r0CDGmJGKQhB9dCFNJxNPjjdto3hskQEq1dRUX2ByYocRcVAxJYeFWiWWqFlVZZjWhHy4R/Jzip5dqEt6/aQOtre1tXq2+lLbcltlsb1fzb5KZs0iZu/MbEfzV8g9eDul4na39t2x4NfTWXtkort9IqqvxrcilLWuLiFxP7lXziGUhf9qYr9SlNbhITxWD/qOMWx9jGjxV+mBigf4Lxgf0edpcdNlptscvMcK4aVSq0UyRPBvww6JGbTuuFa88amPu+AmRMwexV9ANF/uPMP7kN8S4eiw7Cj2d8PtD+61M2RqbCexwvIeUoo0x7d0Ia1SETh47AQmkuD4Ben3mVntQHmh2+ikYDc6BDd7owhmJftDus48vkeIhkIEBrEKE1SNAapGgNamJHA5vxHSX2JEh9skaxeSy2BQM4FxhYa83VBnrhbLAprBTbodNkb0yguUp/QVZQ2oNDWXAoD461CgE0IjPc2P6N20hZtyK+pGwgiqkYVzYSUWaGfqpRpQvuKOJzIEsjB0GLkn0iKYgRt0ZVwZUWAD3Z0rMyJu1Hvx5h0U9SMFiD8zViBCJUZnZtfhfV08ty+w61hm3Pow4WPor2h0W/+Qg6Supo6EUaicagxzQUgw79Nq8qao0M8UWVk7BMNenOWNOGLFjMcu4iKpSx+m+0gv2IBp49vKjVGFwPi35VNdpFChtw9LH8srtQukwvC6Ruhm1i91jIN8xjAkbiRenDol89C17RlGiqVA7VwqFGONY2BNCLPJo5Bn1pT0ufAWuHiiehHInu2UWR31pboI6MDOwDaBfNnVONHRZoBK04pFqqHnJyUQju5oJUyf6nRg8XGloVtn3qOAxwYEQGGjMeMRbvRCH2gLbSBzokkGJOSINL9iELjZhjI7AaFAGjGMcs5Q6MFLZPyssvxGASvNaBXZf3cwCuih9CjGEPHse3YA1+jgehA6+F45Fy0VIfh489DqIuA5Rhco1/WifsQAfWJybW2t/ebl3b1an1XtiGB9Yie9teIW3abv5t77lKC6f+fr2n3f4BztTrMm77y6iv9z5v0ukJ1QbTv6BARhls+7nkX1qX22419RHX2/u/Ove5rPa60mq46VC+UpMqwlvGNT4f4jy27u1dt/3wh04Ibpn/00AmbNu25cnUv21N4bdGw2NI1NSob9O5rA6JbZ09rZTLacXI0x56+ItRtndNPyFsl4VVKystUIi5L1W65HITu+rn97bu/Shv7datV/XGVke59dsvyxZ3uJzjDw9MfddufqWz4rrpokBPyY9Kn/9Lw/e+dSFue7Ec20t7vr+VirXOj9s2vO61xF9Pee9Ge2bGmsjLa9F51X43deB5XSF04cV18369vraVdu7w1Xrb405WV0GxQ3U/2jm3LvCf91NzcWJneP9AfVg7//AqccrSodVtJQjiF+MQuhEh1qvA6CnvuRb5upd7Y6VbkKhrQ90u2UNja37LwetmKSfvcbF+YzSEn/LfY4X+/+KxjXiFk07vbPuW13Q8bmJrGi0nvY3Uj5cpcgzH8CHk7RuGhWTEhCERES6JMYw5cWG+Y4F1cCKKGiTZAHZmtfnkIiQaK1Umd3mFeVjB1FZfO0/tNvByyFE+TjnDz0ixAs5KAj2o0+Es1KEW9UgiF2diF0xwoOPJBzTDFbgRljohK85Nx8SElZglsPHNTJkyAcucFRtYufrGZBykvDHCWIZxcjMpuGDUAVkO26STH+mpfgNefM5/ZAA2eQoUPsssBsJe1ECEKLjozRMkwiXBkGSGS61NSpOBJjNrKEduT+VZHrEVVvFKDubqsJGRw2YcR2tznHKasTMMucQwI1kODHVXM+DIXREtRgJoWSkDY0REichGGjLJsDjAHG+ssohTEKFSAFXGwQjLHxlIJ5NuQA4ykAFcrRJPUkaONOIVsYyRId8/IygY4AV4u/1yqS6oRl9F9dqI8lpNLxgvGPf2tOpOa8r8bholU2JqtUfVLz9L9kQWkYjyAhKxWNJFCNm3e5qGWvCD4FR9Q31OKTt1jt4Cl8BFIOdPDkOMr1V1W7meN+A94u0p7StuKbiODJnIXdf+EUc2UjQSYw+NaBtRPiJo+Ivh+4cnDxcOO6fL7hjq1rvTteh0ddo6gR1Vh39NtNPMMXEDFq3Yi/lhoc8xsV/v8MGIISzAKDIscpNI1yK4ZQNNphHzFMK8hLm9RVvApyGzz5YpR7Al8oS1AiMGRypUIUqbKLEtqSRdsAW6WYqtLNV2lmY3W2gPS7ePFq1pyHD65PScO881Ny1tWmqla3jXl39/Fg+zPt6jAMCTfvOnSII9vVV6e8ZBNFcsfLi5yePybXeO6bVASwAwAPbj9xieuv5mSL2P4cLIxMzCCmXb3FdWHew1pVYHiobEQRKcESmQwdAIDCdIima5eAR5CouUqNQarU6fAWOmwLy1/OyZBmYY8nzsZpgGYESMGjP+SyYsqt6kTFpTYgBCmsqF2RwhAZgWVGxmgMERokgUGiMmjsXhCfMEqVWSSEkTSWQKlSZLl58XDC96t1BUsrh5SXxsV5af/1f1qaGeZnRaaOtkGfflfvL+0T69lPlVvSfEeL/G7gADEyAqAGxp53QarkFTA6DLVqeVhXyhipgPKzct9Lh9cr4nidWAp3Isn+1pNLPPaI/N4Arce/lmTtfxNogBmALDc3zkZA2Gn/A5sEpDLrU57ji5CYAd7Mf+9onD6Xeai5uHl49fQLAud+E4Ugflw/ZZfk5O3nj8MUv5plyxVH1qTn0nG1LZoZmBkYmZhRXKtm6HbjmQQ//cKW7wnSYuuHl4+fgFBP/WIN3vNuRpv9WEicNUk6jzvykzrbIe8nITL7w5QtfLTIfOfsHMAIMjRJEoNEZMHIvDE+YJ9gCQJCmkiSQyhUqTTT764BIepqnw0GGLqqaG+ryhXKZrLkoLbZ2feETS7/YovUnxmNOu+VPeN/h61gcR7ACN8yslBmVkYmZhhbJt7oNu+o69aKcGHg2JgyQ4I1Igg6ERGE6QFL1u7HI62Th4QZ7CKCUqtUar02fAmCkwzx/gb8JNNSMwOEIUiUJjxMSxODxhngBFSFLXZbmB+aSmkoZIIlOotGQiskCyJOfnunw3JJ8mhSez3HKKShZryUBZVU09jfWepkVaoq2TZdyX+0kvfX5VxesALL0XhZRZP2MQRiZmFlYo27q9BptqDv1zJ1pqnfZxwc3Dy8cvILh5yP2Fj2F2/czIYNSY8a+fELXLTYqDR0LZh9oCYdan+U21GRgcIYpEoTFi4lgcniA5v5z/vl8KaSKJTKFGQ1Zvshhq1NbELiYT2pwTpi537bj9VG9nJ+8Ss3N73I1/3IwfeThx6tlej3gN1+PU+NBXJKoi6Llo/vIL8SWP7mnDjWkHJGEMjpGJmYUVysY5DfEZslCcF7R7BFYpHp1i2e4xzdLV46G+mU/6enbveEoO19McdCu+dt9a1Zob2uWITQcRzg2emsvqEW7FgEcFXu2xMs9yvqf88fGeUc+JL4xGz7i4d3lYTS4t2DLuBbLeSM/6S1eGWX+qRPk4m5vusmJimWNVZu+KmW+jvdcrNgf6Tf3pfziIJ/KhReDk5haPoPq/sMAoywkyO0ths3g5DuKhxfBYHF6A6rnZioXWCiLdqrr7PKI3fJu1Ja1VLbieUHW6a6eTJ54xGDFYF5qLBovAORrYoSexGfuFNn7mX1gIpGGf3bC/rj47IWoLoexDkqDAqtviUW1HUozljfZPgoWruUF3RDY1wbzlOt76uSOkc2BwhCgShcaIiWNxeMKQOAGsuLPijwvujJDIFCpNdshfCNDU0tbZvJZj3eW6yqFSb+mE2FOP40e0E2taOY4wA4MjRJGozBqGVoyYOBaHjyBJnIAnKTkbnXPn27nscjXINVx3w3xSEUlDJJEpVFoyZIFkSc5H7/Hks8iS7B0Wb64cGQGCfUVVLdCdtk5WNpmskg8LOPEDeuc91PO3vpnlY4v61Ci9LF58pmnoJJtxMDhCFIlCY8TEsTj8ttCPdAsjRpWSJpLIFCpNdtL5GpU1Qq0xVKu7prkoLbR1NnfxjLIhCIPNIT3ryxDkvDjQtHoSYwYYHCGKRKExYuJYHJ4gmXONSkqkiSQyhUqTnXShT3iVhuf5vX4o0x3p7sR6R/XCV9xdcHe0awzJyUI3UT5WYS9+7J2Lubxz3JTIaM5/zdyOfRhs5JJNt5NpGrV4ZmBwhCgSldnMQvswIiaOxeG3hd5Xi7F4lGNnGVfwaVgG7QA1sq7uzCcVkTREEplCpSVDFkiW5Hz0rJPPYirAoREA4CSX5et7Ob7A9SA1p97EdqO0RFsny7jvxP30vXRh7SP3r5kac2jXfN7ny4cC+Jr0Mp3f5kYdtoLmYVfzgMb4NNy7ogbdgS4nsNYtRoIRGBwhikShMWLiWByeME8ouvck/X679ltUHuhqPqn5pCGSyBQqLZmILJAsyfn9Fo0p3xalq8Wlo6jS3Xs9SM2p78tolJZo67yp8DIPcLI/Qd17JKa6F/WycyEuR3Qw4OtNjGG8zU7fE1jdvyC5U4PaP8l93OoX7b3+axi6rqQpt14ogI+bDOBTX4UoDjOoWDtXcnKg3GEnmSwhjaGWZnnZLNRgxrByBaAglfvzMGNZd81+3kNFrrxT1tTS1vk0mEPuZK/qNEal4lRduHl4+fgFBDMUlwnumxTOnBIS4URSzqeZdrUZhcERokgUGiMmjsXhCfME3dghKVLSRBKZQqUlS/LR9y2xW3+qPjVVT3M+LbR1Dv4kOPDT9UPWrmf0WxE3B+zLaWOZZlCUPDIsVAojuuuxCOP2yqS/on54s29U9pDHqzjKgzXmQ80h7+dx/Cd9ard2HPnhrpfNAbd1qIZ4eHCWqtKQnTohtjHAyMTMwgplm/qq6ZlSpW8nYHGQBGdECmQwNALDCZKiY5KxccIL8hRGKVGpNVqdPgPGTIH52DI3Jhkm1JClSGcYTsYBAIqAsgBVGigNQPWa87uDwRGiSFRmI9AYMXEsDk+ohExy3I/faA8uB3Q1n5QmDZFEplBpyZAFkiU5H12STzwV8NaOMcaVAiWBMkClQBf1BlcZ0NHWaWDcmXfN6IUvI/I16eWV21t5ftXIbE39HOLKgLnsZVodHE7/3OlyLc9puLjjgZePX0Dw4CCq1xriK+ttJtg+YNHhVJ9DRRcYHCGKRKExYuJYHJ6QRJokdbpOtJsgOkkrkUSmUGlNBNFpECJEkiRJlqjlVbfeZr4HqTn1JilCCJFk5/jKhynLKusfUqHeD576SbD/vyMP8BTZL718c7sNQU74hlQ9bWzrjpGJmYUVytaoPI3v6G/Uwfrb7uMSbh5ePn4Bwf87SJZ5hnS1w4SyYxDGXN2ttnVgcIQoEoXGiIljcXhCg+q+UZ8jSVfzjbor1z4TUUhkCpWWTEQWSJbk/KR73jEUQRDEaWIJVAacdn8FrIAlYIKiKIogiHpbpnVtVCTFLp3D9tZEw73ne4Qh0zzs/6+7OI3zYIMy2k3oUm2SKeabskTxNWh/Yv7h47W5yk5TrWJnLtPYHkbp/ePnizKl3Jo80X1PmU/h/bxJlpy8p0mDvpMOKVduYWBkYmZhhbJdZq/WOPTPnZTf67SPC24eXj5+AcFpEI53NyyqUsM5MoJRY1vj4+5YdT5YvvqqKus6rtgO9xO1RXXVCAyOEEWi0BgxcSwOT5CUkiaSyBQqbTvbj3pLa38cVUcVHrJm1SA11NMtL72lE+Jog3JdDQzpqRyypmOAkYmZhRXKduRgVexlnXeWMeKd4EbFjNEoLsfNw8vHL/AG0oMjlPHimtdxnud5vlRGVFk6Vi/9UUlluGtFmEaxd+3A4AhRJAqNERPH4vCEecJQByV9UkgTSWQKlSa7//Q7WjSqUm9XRSWLjSrT/4u1rZeaapCaqjdDN0pLtHWyjPtyP1/sir3scJSN6GxKetm9wRFpuNhk2pkhd5m7Phf+KcSxxBmRAhnEcIKkaJbjBbnBaH5yhRyImNp2lz75ztr/cZQFd0bJypNSVnn+WjunhPk4R2r+JRO7+Zr8yiJbfkIorysG04uFkJqyIQZlZGJmYYWyrffVyAbtsNMuu+2x1z77HXDQIYcdcXTutNWeOSY5jhNOOuUeZwwcHML2wIR3dXBKYQNCujL0Ez40gqIw01emD8zA4AhRJAqNERPH4vAESSlpIolModJkS2dvfv/8pt7b1c4Ta2ZCJSeFXThnW2zUKOlF5Fdl73q5Ue6PU3mo3tI/jP0aB6cJzTfIJToTcs711TKpvkNRqfHlxLJDByt8/MwaG+JB3dApcuv4dEL4DYe5F58Pqb9yZXCMTMwsrFC2dXv9lIJD/9xpKJnTPi64eXj5+AUEp0G8R59/W7YrbsSoMeON+irxqSIJhdwUT5i+tS7EGoHBEaJIFBojJo7F4QmNykTvPimRJpLIFCpNNvnoUywpKhiUlWrQU//sl2qQmqqnuSgttHWm97UnJusmUfqFz5tS++pLN23I16xveGiDNtNLma2pCfFgu/OBeh5G9qyKS2her1nw9jD46VTOYqCmdL3TAAAAAOgRDjjoUAMAity/AADQjeJy3Dy8fPwCTQA9aECl6i8BYIwx1mUIy5aZmldfVxgcIYpEoTFi4lgcnjBPSHRcUqSShkgiU6g02ejPg8lbpPCckFuquFUan5Lk9VLXK9ZB1IPURD1Ni7TQ1sky7sv97P45HF9gCl3yC7sv6Xqr3hOWMcfP/gqODB5wQTuaQw3D32filIW2BrVnwS9fU5uc0eBrxb3X1E+hLRM8R2b/b52RiZmFFcr2oB0Y/6jeCowrMNZv7i7BOMLNw8vHLyA45rSrMvyrymCknG4WB7qS/LNLVs77sspTH4f6R7X86cSfXvGsgH2GP7nmuJCoya1j4x9XrMSudsfIxMzCCmVbtxek4tDfOH/MLow+LuHm4eXjFxBsKmunUzUsbhVVsKPlpO0KgyNEkSg0Rkwci8MTJKWkiSQyhUqT9QBs/XUSCwBbAVgFsABwsK5B6Pv46FzJL3+hzhotkidbz0kfH1jpU635ZbuX/b6mXjK6bURbgQNgbB8dcEjgK+B2rJxrjQYX26FXCi19Ex0thA62aH3c3oIGH6BoIp3IGI5ZaNaAswEhphnlzkHgqSgInsLztmjFCkIAmjCkkMhu9OFGW+9wqQ5iJBJcsIMBYESx+ym5pnKzI68TqS2GzaNkJfNVez28mKiZcLlfOO3OMqo0kJW25Ak6oYSs1afhxdSS5zpg5ALADcwFjH7UFA0wnAwCq6unLqbyD1isyDYeF32dSEebWBbcBhfcvLUIQa7Q9xMbcd1AfaWelWHytem1W+B6fW65CMobfb08PUKEIF3BxSUUGLhyRgTrI8UL/XrJ8QrIMmCYON/9yO3cV1xDYECcOxcumADLnFb/BZpfPE5GgGEFujSpAmikWoUcffqpfCVbGT68PggiAlxMy2HCLYUJsQxGIw8mAIILEC01OwehXwn9VZAxMFVeIatUV9ZScpiImfHlNcFtVQrDQdcwai3WOCHKfe4iJTDAkzhCvElalqETINwVapJScEbR6rl9qClJDOpGN8J4IzAh7J/NQRQZS40ZEsIhcKT5UYHzZSoA44G+fhP9dNzd4AsbVBy72S3bnr+L3j2va3d6oNkxT5fvZqXWv+wJDXYp8yT8mX0eeXjiO+pkEaxJU7pdCy97RZU+7w3Cp/ARb9zWt3wtFZhc2loDzrjmrT3U3KjfTRfvrasBKBCOMFRgoUXSYIe/dXhuq0N6ndOuRmvP+/38f/nmq+8eO+sI4D11b7Lblr+sNf9OB223Jgj4aK/9PjB9j8teyVftL6cLnJx6d5CIiQzhsFNBL344+msrWHBdoXc+q1ei2EuNzjvvfuRTqdwBOh/cGD7jNlrraIczYJj/7/zFUBjADxdccl8lBLwaAnghwB3AWsBkBAwGUBWt6gijNm6wK37hQDAI8P7W6NwLun3QuS/W7G/tQSoOUXC8h8erPknzGZrPor/UjsstAwTgc5591OAyJv5CeSfgqWDqjCVWv5DsBZnMqHFecb78QsWF1kulsH6xZXHzUutS/9KK5VJctVy33Lzcsrx+pW1l9WrDWvd64/rmzbbNK/8zBwRqBSmuBaeDK8ELg5eEAgVOLg5fFalEmpGLokQ/P3phopU8P3lhagYh1jJyLhrUpuxJdAY9F721xQ13CufhF+N3thWIWYFJFsh97bPLCozFVJnpjjLXgUXYhbNdXSF84CpRQ+xKUBqWJuUT8j2KtnG9smhdrrlRe5PugO6g7np94sIpbAy7B7sXL1VuIfvUNgo22TbRr76QKgIGECL4B4muCvpwthdk5KoA5OPQ5penPLs0WxXzNNwVnx5bVzW9wdNNxlNCWyDSmXg0kEcTBnDs/ul4Nsrgc1tXsU9R5ZRwHHvtBHzw/xz0Jon5at+NHmc2MhNiXJzxyGzuDHbL3VwVQQCMJSbjykeQGClyzc0xxEzSDZzzE1ok3z/OFlogr02nJ6KvcswkLKxw8vwxU3CKTcWL2yBmbePhGT5WicwD2I5CEGFzMtEqW/xGGDk7O4fTl3t5UAgncAY1nrKgxJSEsqPcKS/qlrk4m5q5hfMuienv38AIFAV37bZFlgUxwJvF4yghJVrxRNcv4KzbrRwgNQv+30M6SKE0G78qbBeOhz4HwK8Pv5t5D0OZb7xve95mvj7/VQ+ZAAiwFXDRIyMAfApeCR+0nMeLPtHplC2ueabPabv12mzABtu126rDRg/cc9/fzkCYDLEZ4TMlYEbEipg1ioSM3FiOnCiM52oCN+722Wa/J3b5aBJPXnz4ChBoFo0QYcJFiBQtQZJkC6RKkylLthxL7HHJXo+s1+WKG6666bJzhpyX75jHLviq30MtWg176qwe3zQrcFyjBk260WEIDDQGSCwmuIzxWBIyZ4HDhp1RbEmNdoc9F86UxpnIQYppJpvCw1Qqat78zeBnpjmCzBZsuijzxIgVZ6675suwULpFFkuUa4x4Rxx1wCGHHYQAo2EQPhJjhfghnkukT01N2JiBTfZrYGvYCibAYzAR/lImiRUsJw94LTgFoFbbU23OIVRK5xb4y6/aP4DPA2OfBZjyI0AdCqQDgAargVdNxIrDYWyixaBfY2NxlOAhXzRkQSSWx4nFy2EiWsH4tFc6sguYiiKpx2LRoEL3CLsakYTP5U8Zm784AgFH4mAvFm/CI264fGEvnQHGWNyEsQ+LWhjJiHCeF6Noo26F6J5GaOmQFkcXHoiriqLl1eMCtKgJIcS9WN0iqeWuBJ4iiGh/4Lq2/iCsJ8merk0ZEGaHGqaHctkSE9Z1w4Bfi1DQtcs5g7fkiUdnWhJPdxXOkTO4OQFzTCmQboEnvfCToX7/gUVjs3eW3+kvkgWduYAWyG55XtPv/HSmVAIVFWhmmhsAbMIxBMzmySSW5OYrTfOy/CfCa+MyHPiRttU8q68pG+Yl9Nn3tjM2vJ5Cvt8HGjuMCgZ8miGtV0t03u/zyLKBHdRvMI+sz1xV5tlRv40dkmYxP1nrsnYHTfkRxc700L3EehzlfKseLVKVVzJedWQgXeMVPvVpl/Woq5EDOoB1jZUNyjpVqkQSOhdHSKMeB3jM2F4c3eg/IFw0fTb/zfTbzekQTxU46DVUobPdzxNDQAUQ6W+6zvQ2gGfIiRCicfpoDQenUSeJiPET2fG0Gnkxxa/5kePK6UkHOQkOLTlFG5ryhXNEENZ3oE2W/aJ7OyUV2HZo6ZxqszJsUZ0sWGe67MtcrPDe8u7C0uUagtqK/xgHH4f/bvZu8KFGCDHs6KWEokZhQhsQbluXbo/g+sOnnaCd8SMIa/B+nI13TmynQ3xO8BWqTOx+f0C/49N1/HTNVwG3v1m/HbjUnR7uvU5C0WPQfhbeox0WU5e3fvhHRZO15t8bsQ41qL2n9IpyzlAZZZmhInxyOZf2qXsSbnPoIYcNkvHBpVSsQvvup4wUtqVErZAsEGcNnzmJdpiZ/nCWkKAlPBTXpMOuZ0rvIfACoOSJKlm/i00w7vKjzYkZNegVuwTwXaK5fJbY9wBkJhzkE89glnBkI1Vvc1fP9TrZis6vP4uf0YUJ28efxqW4a+X2IK77pEhq8ANtslpDD+nnnS7QSW8qhjc/cFuTfOPlO9+z+fH2o3eFm2c5JZhiMrDlYbM1stJ56CGVPI7wsZzvl15Y733FlUQBtEYOc3J1skZnZj5btLvN3hpcLbj1yiH+3dfTFxusfh7//DUO9uY1wwe4/Om/n74CnrVb4A61XevtYDTW+S6seqnrz5v6afrzX384VrqXcWykyG7s8EfECrvqkKspRXJSOnpW6DlNMFLEXaeWVNiXr2MY3pmeX0H5+O90yL0QmmP+Dlq0aSJjYgPLC01hN/QEqJ+pEh5sFDrf5nUq+PQNHoS8KvHobfY7ZYf4duWEP9xteDtcv+P62gqWPx7uzsK//QWxxS2ad3/DPGmv7koM/NG2CK0OJPqMqK+uNwxEDzLm1+pRtZEzOW8LCU41//TvNEif5X8DmrxK/NTCTegcZ4wi9hkb03QNkIvQHB92tR/xhi6pcHGag7DJQjgbuHP+/YfTElOGQuNH+JPjKD31whxj0Uu4rOhvdjdymGhN+sTNahAVl/yej9suv2iFRhWfmszks827TCEnMQjN6BSm8s9yEznoUmkrTFdQnEx5fPFnlkaIlvIFzGR4SjllTv6ZsrDJipBgR38Rl5grnWlc37+/zH2BwWny2QsB2CASLk4TiE1dWcH9IrKcwGJiYpq2NwGFelMskwk2kGxDaHsN1dGSK5QO/Umknr6XYJlJzISoGkcEtqz5EB1RKEDfxVCjVZdW2x+oNH3Ijw1q8nnToomhiU914YQmufGtRxmGyzTBfN3I2NzK9jVg8KFRYk6rQOpNIReU5DE1M+SQMESDD/epm/ZoV6vIR/VekMjjvzNqvNLTsyOlL56jgt844712l9bPRH3woHhNjXsicFrJ5T4kvLiBz7mPzYh/ERHI+dHFK/Ww/Mo2dHmPz+v/R81dQjwZIrQHq/K/R6k61fYscLJhcU8sJh6gWyXk+x74aS2z24jlvw21G3+MZGrTRULSV02tFUnBCnXOjLV2oGnx4zFr+BLAxN3i+SdcRCzz+haghi/PvghAuET54aeVgHn3o/Z2Pu+9/ua50WPr6e1kP/FS70etpz//lha6kYPDajNqsDrdSo35/JTKHE9Ddmpk/gcdGzf/hjO+MX8omlmmROvzL8CGBAZjEDO4+rTugeeACBNFywDbiQQkRy8Y/Sgx8lvyzKNnCVwwy27n0LALv39Mk8XsScHUtGWIDRsEufHwJrJJ25/PWiwxI/Qi8mGFrz05juhQgeyQlMcjneGtKHrPok61DQBNxh6zHeQzCb1Z24pEvEHFUtYuJ59WKIeOWYaQOyogy7VM3EkWMzs+7nc6QTs/NBwUhjEvp2R5LFNuzyHPKr2tS0mAmKEcVh+/z2Y0M1sBtLn86D2Vm89vMpf6nE/Ayq5/iiYpJTcJt+8ZU/Ng0jB8dSH6Y1rczs2vp/yzoma+r9+o/JfapwozSqCWOatSKDUINSUeGg+KVSDjKe3RFiQnFPWX4FyLFgnS/H7HR1YXBEs/cfzROuxnFsBl/9j8eO10Zrb4F/MjmsGf32SamIMjewkgH8Dm8vx2MmkSc6Mn8BEkBmFUsrsMAYsZkqEsBf9c5X0N/uG7mx6StNUvizwCIyGxsEUwb54ALLyrJdyrFcSe1oV7Uu8i0Uju39CdyPoFu2tt4rh4bhuyBTlwjUy/1F88KC7akXUIrLP6KjOUD5p0/miv5TfRj0w0Qvvy4dCHyDNHcK8pTLicmROjbGssxdjI7KCR/fUaTQ86IdQhSjXLTDiCTRcrW4hgeNp6vD69FmfpKXM6b1jLssZ1KX6lmebWE9P1x6ZtsFL8TnF/Mr6/WCDT/kTxDcnd6DasVMC2RcLCLRbDisiXeC8L7N3LYr4WB8zELZO0IFci7THxrLjQbnUxkv1+aKaPTSPb/chpCJxrjCzjxTI2E41aZkrVbXgku4e5dNPWzZ5YYX8mcXq5FD9tb6qQ2xbkdkPUAZMVu3CKv3B/+pC5kTa/Ohh5huDvCgyQOxOan/NXcnJUHZSbEvQ7succVeANoNxcu4rFDsVPuH/iJ5Gye5t4QsfvOrxNqJelr+l8XrhizcqCbku33vHYHxOQ38TdKVQJwSZRqGEz4Qg6XahsIoJxtL8SOBJGZwrVjURIkt+VjZ9eZA1rk/lJM21rMrHTYuuS/PUN7p5PpEwQNIphIPb1ohuJXMVQY5jJxqKSIgvlC6HTeGjx8URGl+mAWmuNfGoJ6DWEcZykoiyfIu8c4WaCdzohsc7xp/S+vPEMNIYuGKRilEYzOIj7Ye/C2xZw7RTk3Ww+w3L5dPZd5C5bMphTJEmSS2c/d+tl+itaop6ONIjJRMW1c+SCcZSJVII0OvVLVNx95v5UMwRmCmU1Nt8I5hnp5o1OLu/3GMd+jnZHkb/UHJmf4sFSIxPBSxEJAhHSX3B7JrlHZQd9VK2KO10VHDr9gOwE55k4DAZOxtWKf3fj/5ZmmFcDc/x5+bldrZ5Lz+9qc+Tbr5T43GzzM3Pg8yuxoCHn+8G2YOmEe2ltGUTo8a0feiqgrdtme4f5xp9ClO2zrVKfzAdY5w41/hOn2y+6GdmzGznSvgnEJHfT457kOPfUuJclc2pb8MpLD9t8M+q/+ZG1NdpUzRN2V5kiq243Wa1Sv7ZvW7wGXbkoPQouJMH3ukKHLr3dPb1PZWHqHueUn3NMjnrUDfdKoxpW2tZ0HmmfXCTxmtuDVwukw9FHYlWvG63yJEhI9qbXs4JjPZMTHtbCK9/nbonKDI4yRVZcbrJWtjqMMdlD3A/9SugkMYtJzu+cmrLP0qfyBK+69JDLl+992x5ColW3F6v2ua90gcSrHjdeK5Fd7dJtDWtsK+elICa9dZe77vG4Rpa73cLnzhTr3vPb/0BR/pTXOVJ3/kn1E3jRasML7KfIfpIoUhQRpkGNfrlHlLwHJKS/4PFM+TmXiK6nev5/y0F6PnR1IjW7HQ6FjMXuKhKWsocmajWSRlOKO7iPqzq4MEOuZHwqnYwnOMUVwvFO1q654JDIUwRNv41NYi3y6wbN9MDqscKGxZPo2JL0AdY5PGW1HWPHXK5xjnWOj7kZklc7gleee8gxPaf+285bzGWPGy3xhMNZIvCSy0VUSgTc6Z6ZL4WwiE4XxqKEJc2brdYMZuyzL529V7ofNP3S/tb9zUubWwTNLT0tzQpI9cv6gXtJmkhw8iuFY04nzaVCvf2W+R+hdwM9jg2rTL9uQXzzTwWSX0p4l5D+LWolXDLr1flVWsZIk6ZkSm/BYnpDklKWxihzIoy91ylKIfK7OxrsNwyHIcke6/dM5ffQJ3aUrOSA20lWSpTDUK6j8Pclx49XPr/QpOguvM99Z0gzXh7ikVeLb/jQ7dIyRC6kuEuljlf96kW5M5T+X0WXd3+5GpBfvy8QmCdzRzPwEtlPLyOs/lfjSpOdRfXqyde4pW8O6OS4DzFiafkA5wzKDLYzVaNGX+Ha3x4y2nMMEKQmgTyYG2O75LaIURU3o7pY0mh1ixDTn3JOrTYzapTNZrg2WRtpSqYNlCNl0EXNnnDpz8WeEorxNl1XUB2RwIXzpNoLDol4IvivuM5ZzEVXk3QJrk4EDKZAfjC+RNrkNJeyFvjtf8bM2YOCcwfld4+Aiz1HYpsPtre+y6/Ts/XcbXcJZUmwYd97Ux75OKXnhclPV348Ulkce+fEp0++dCwZvv/b0znHDnaS//zEig/+GXsCKK8bVfgM0IJwSpQ7JIoQfAFNcXIV41Pp9S9L7IWmHTark7VLLjxunyF69pBBb0VbZsjRv7OGHOzC/f8SZc7YAdsRlh03/qGdFIl0cY0OHQ31t/HhGpdAXLYrRYaHng72mfpw+8Xyvd023i8qF7kfPnyGTPspb9lPuZqfWv65rOifioPh5hto34bozsOisO9B61Y9ZT6lXX6dxz3P3mJGPY4eYvWf7cd/6fde9om2NwSCkS6cJ9NeeEhkLrrg0PrdBz1TNSqVktbqlL5fNCYGP618Kk3ci7nTVsrpw3AfSxAMe2m73wLOzNDdHXDzVI2HWuXTalW0T6XR/KKmtVo188tmi89PWBgWIwcvNnMQIcPNfPCSicnARZty4QiCBC6enAhcsjEXQZixmPu04SH3qewyPkjwoWH3aT/D8IReqr9zj3izGH5JA/vtM+w9QT4V9ZQoor5p1OF38gZz2q7u8Dljm7/49i+s95Vi+IN7x3AZd6SKOmxZvTlFUuZUzmBv+4mo3S80d9dIa8XptpWHiF1bOn5vXfQHd3+jeFfHHnC6tMhlGL7yNnvmU2nNPcNKyw/urRMJlb8jc0Y0bbWZslmT1ZgU3cfjwlNkHoMUNeD12KvD5Mv934m9JBJOoFmScEI36R1xuka8Kcr/A9X7XqdOXPOGf8pyt2vE43HX6643yTCKKFCqpdhPkhMKUbBZ8eJnDu5xNtzXdOpNe8T7O16CKekZxm39NqMiShMXaJddKlGpMXM4q6MoSHYxdTzRpVu1F/ycEDXabP1D+JfWPSpmwczRrN5K5fTSxSwycdc/zuXjXk8+xsl8zOMNK+EgP5XPiaLu9rpHurzeutMp7HD88yc5JuglA+U8d8nEJHvR2lxA2XLsxZMT7CVrCMQzHHOcNjzkOJUzHkjwoWHHaRRY9FL971Olt+I31c9StxgY07lzbnLMCPcEC6k4XaW4jXsmHUF3vwFN29WdtCt+wfeFXtb7NjF0kr4CTnNfDaJuR58eS5EUluo3ONsURO1+mzk9TNorTrejXCf2b+mY29o5v+20RvE5HWfA6dICl0HqcM6HUlmLgPTpRELVdf1GC6aAZvtMdlNW9BzP2m7p8VxO2YVwVkfJt+2Il1TKtWtERaaCUfZz+INHfOGfOsJHXV9SITJE1lFUgSBiRLEQPW4Z66g6GDqL7EjvctyBDMqYj7ih4laphoZzOquVMiiYdAr7td0+Qhkz2Bz9w/iftrwONU+KRvN6m5XXo0+CxvI667i/L98X83MCrC93nzjOG4A6G2P0En7zgflWhIgQEbVSITJMFvy79MWdaoOOlV8qhid+Y9kbyHfnh13CmvCufdMn+/cJqfVy5P7GHndVaRwyIAdHV61lBIEjQoRf5FXGgs+CxZ/tb+/6JZAoftr9CiiYw/n5UXlkYfvjz0p2TSr139pFP2z4vw14o+E+oxPtzN8nyN7xwYaTMluFzwlyaRJNuYHk33owxwp1QM4b8DQYThcEY22CusBP3TYGw2HG6vGO/Y2tI7m5pxq4SbBIvsNQgF03lH6FVzZO3NzmTewdBqB3a764PrN+/8J/7X01+3EyqQ0EL9A2CitOLXTzu9G+BYePL/bPvXP1lbRBGdBqlSzTa3YnifX1C2o2xpY2GVMEZsylcd9lc68nM/C/xycINWZw67l2Rz+74h2H556y+sdUJqBVcqzW5ElgaHBnoKn+PtconCUKfupZtkz2U8cJ89r4nhTMg9Qasf701DcX0NunNq7ezJz9zagD17ai18hsLoP4qKsl0VfTH3Y/6i7/0JiITGYPhwy8xmJltAKZ/U9m1nuJg8Q+Zag7rxuaKiK7rxj46ztHUydrmjMZq8m5jrYOYfhjmzfzR3kWfKkRY/mj5rGDQhxiLngdS4f7m2o7xqVjIstOv8mxgea6o5beblre1U05/Q15xyR28JstbRu/3eNmrbTlpgNUdxekYqvMQKzlAwcu+3ZjW9c3a41FHX35Gb+Ky/EtU/eNTwvVWCEibOm6uWvTv0sDHEmW3b/h4kP6fcLyPX7Lqr2e3VTyFuF/7M4gAL33IyG6d8g2z8ChkdvOmyuUK8+rH/trgWMjby1lpv7QfhjcLjCudhM4T6s83Otp89d6iE/9A4aqYb415lzevI7l0HU8v87M9O9OxU+t6FrE1z9x9wo57z9xayCRPCkcn+Vz0ZNmwjFvpUfGXjOuit/W+1Kh6tUq6E96xzFW9bDKZ7VbnDRB3WYZ+9+L8NAXt4gOi/Zyi1mUpiXNsH1m4gHNbBNpSKQNpOKO+Uvqj3FqPZtOcVqF/2i54mtwVSxkn51mp7aqFriH7KgxktThthpxKid7NNoFk9Z5e3E9R+Mz2X2IC0us9mgAHAFLtV4hY8gWfRS3nx1oGS32Ru0Gw0G2O3YCK73RIl0RVFhs/frl/FBaZfT8bdDfth9adkTc/qaoLDjfWjg92z/6TumNMRmO5zn0VxwItwmx+9csO0qVaSKWTm0iSfqKlarbicjFZAiO9VEUluctpIYT30z53Kh0CGi0QTOqDQe0evlrY6r9QUS/vXwgmzi9WEicxk45qEz8tGIxljCDnnRXrUTN6SQqZavbUxGhKqv6Tx55T/h4Q2GF2PuXp21ZiylPkUbLYjZrBpMVJPUZsiy+XzijA29tUXWGO0M9su5uWQ+c321GW/h0tkXQImYzTef/ZpY2S2a3FT3wsTVQiwnwTKnWQ6VidHqVz6fW6mg1r9DrFkBT3Gvx8FMkzeKEjyUpxg8bC6aQqU/7GDImnqffP9Azb5PmSmJ9Z3Rr4UWNakol85iFp6yWvrzlx9aeUEiwATEF9dooatKGgzpTcHTcx4xqIyH9V7oLWfftJ0JBeTD0j0AFbAeCjJZc60f2LkfpYClIo7FXwuL5K/imUk1ghlBKQ3mHMNPInzmj3Zfxe4yhl8PdYeQtpReZH+cHC1PdU3CpECgT2ZphJhwxTKcraPJH129A73kc92e3Z7jTikX/6duzmdDk5vM3dr3tuWvFlw88uVvceQAOCB/1lPmcAfel0Er9VE5Dav0KbYD49EAD8jhygrBaiwBr/c2s+jLf+P9Dyu9W2G5i4J6/lkgXxNvErbfqy8WedBy/qd2bu597UaoU/5Mw1oTPSuLdIZ8P94vzx31w32zguM2OhLwK7Vy+6ZNFh8hbZMlty+yhkfir2+DxuliiCfwyKPS4QiwV3zp8nP2wXecpJx6NGrXzeHOaSCc+euIpnVbrj0u/LYEibhf3i6FybtvrC9VnrKfy20DVt8jdfaI0/6IbkwPDmWg4WQ74y/2JpdKlTqwvZ4ahnVcrBe0kVS9V1er4Ryq7lyr8gE18NGU6gjl9aXB43ux85OG9FX1hokYyT/Lzkk+mrPf57kBoUGZIxIJ060tiEh4W6w/ctPdCcBEe/TTcdHIktfHoon3LoG+d3s7P9BqM/l47XT1i5YKOnoE/lHCaVvLlpYjVpV/GWD0fEc+fQJpl1EWIZL+a2n7grEquPUckevmw+dYBuc2TG4SdT46/ryb6bUgeSok1MP9Y+oWvn948Zr7y64H2hXU0t0tBT/x/7/srsg+D6WtG/Xjs1ks7Wm41K/nGa7W4vZu3hTu6O/fNbrW4s5vf6Li3GwSTQAAAYtjCXdzBGZ1wB2uX3z7hBjpOuIlDx+7iDGqdPVRPYyrYxzcA4mwLpwTCHFeqOFaqOHYiN3ELr9+LnJD4ffKE2O+pSvw3ZMvyQB3K0zHUDE+Ml1Q5PlDldd8QBniuBC2HayqKFSqKzSqKu21bDJ63nbTtBahpoSDDl2OrjehdGqETKehYfm46FcAHIXQrtHcSuQY2T+xQCtxYEqJoieBLU0NYQml2ib3y6xDt62DbF+DnsLSA9rUrqbCzpEKxRKB0DPDPeCX26NR3Oqj0jQN2mhGWlqRRpxEKjmHBq0vtnMVYgDmzvDwcLNLunHsgtEpXLNqkvQ6GVxbckDuM+1+TRsyEw9c4iG/xHb5XPjxoux4eDp/NP475W3OvJXd6pQDQ75gLgPoXrAW5sRqvxXLHK3JX4+ZSoS5llmcbcSALT16C7lwyNoAv8A+ggNOUYpLf3YsDPl1KR1s1j8iD172Y+5ipiIABD9Cdk1OAnJyrxruzQk5osYdQ7b4nqoPPHcBRxgVe3ojxOYEPcTIcwOcEBvPwJ9Dm96ewwTDAh4pmve9bJlSNlxaZPzZSw8+mN+/ORnNccT6nj6rJMYAeKcnXQFcwHbgHmqhgfjXrFZdAKLKT00a7TEaa5vR/GSblhgVp8CXtQYnzk3zpLsZkFoJS+oXx17kTkAk//5uCTAdgjQhpVtHq0Msq+nBHhaMP5/TJnpNngp/NbQ0eCU7Ij8nfUoTJK/OKQgdDv4TGQhbFa0oufOv82PkNYZ3yOVU9cteCyAULF6xe8Ea1VvYPCw9F8+U3Ldoab41fEH91ce7isvgn8UNxc2WEX5V4uSGnQZ8sF63kOcnrkg80zmvMbixJUtXt1H1LdiEdyOdNZcgnyCHkPLJY+8/Nx1ChLua0sHOw67AHWtZjzvpAoY5/0Xq8/liDQ7SImbZr2+5vO9LwYsOpxj2CH7jU1N72H7t3pPcs/V/3F+5j7qnmp5ovtdj0lcvmPf/z/OTxtvZP+JVvOXuoc3dXVzjRmZq4WvT5yJp+Ei8RF8UPi98gAcgtyFVJrORBKSlVS9dJX5X+ng7IHpI97EnpearntfwP+ZUKe4VPsVfxVPFU8Uk5R6lXLldeqRxWzVdZVWOqI2pG8lE3yhitH10dDY7Bt483j/cdnzguGe8lscZUs15ztmaX5qRmQOupvUX7Smeti+o26c7R7dQN6D7q2w08Q7/hT+MW408m3LTRtN+00fTTvNn8OToTPQcdQIcwBoZgHmwPtgE7iT23YBbWUrFMW+7D3fEBfDfejz/HfxJCgiPWEQeJEySQXFJGoiRNpsgBcjV5InmAElJnyuZREfQpCqqwJQDogy3NoUAfyGyiz2g/adsbW4psogonATYP16khOHDikzNMzRAqdusLc06vd6lc/OPspo01yyZ9+pxNEDC/TmOCK047Yow2jJ2An1kyMQvyFVShSADQB8X83kUzxcXy88VWL4AaHIBUZGo40B/9Nuj+j/9UVOu0vbflaNX4jIAcY2DIwa8x210u0JSwP2qmRjH6E0mtQhh56gAFVHztHOJHdNduOf5v1e8iWvVaxVc2Fe0qDlPXgmDLMyFjWR0cdkBLjnIrtbApPqHqnVc38+vXe71mwThsUz9qApIX14CIQuY0AaNHtuKF/zLX8tb4q+9NBfrsnId1mo+vBObLJdNZpgH739N8HIngkHXIB16KE92ZsM1OZ1ec075pW7S44gScBiuYNMdQbho7+smBDlhjfs/lCJyLugTbzOlA387UBoRyx6aTJGoX+KHAqs+nPTUxd+Br8mcR6Zf/0XYE1y//dhw9x2g8p1Be4jqnaE/Je877znYIUel5GRFQoLtOdjEXrkLHmcYgEuiYTy/p5CAVOxR42zBPPWyH3ZpRkegRsTKRXCrVw/rfvEKqy8U2Uy3I4Tj5f2tZSAHDgmVyjZtWiYGCC2969DYXUUpxhfEk5SM3Sx2jLKdhFyaEKfK0av7oSpLr0yt2EHgqKo0Np06N6mTAMs2LRaCWMtRMG+Hlf73zv6P8as2VnYNbGZhLeqfXhn/OyDU6IQYx/bDGwXuW3MdM4EcOJEMHxnU5PBQPvXMhPCnDdVNWmRNp5SjEzAAWdFuuFtllJEPMTN2bIVDLZETkeuDmrHh18kuJiezkpF9s1cbC+BnSkp7zDoEyPxmBmMoBs/T+URO1dL7RkKaHxlNJssbhVAQTMEPppovLyZt84mQPKoKulLpdVbP9Ag9M39bUjcKDKfAxsMJ+MwrooqKVFxTCb4yi2H9OSjjrilcU0OZOvoKfD9uLJ5khWDTfCQiU1F7C/c8KNjAHArQlbCIYNcZv7AzY6FJiCXta3wQzBYSA5yRQ4gn/mGe04IE20IucMi5STys35MN+t1Xfc+vJ8X+y/hD/WcsrzwXCSscY9KmrnM5WHlX6sqaeF4+fngiPBc3RNph8zfx0XthnXeaDbGly1IvFQPNRkijtCS+5KJw2lJdwUfP5I4v5vAIVjYDk6FKJJGxiRZoTgvyudx4F8o7a3TWZnQsf8a+wpZRSa1llpi2GIE+RyVLjiCnFh26ckarpEnvDLZ+0ZbM3Y8QYwNFfKACzlTklYyFM56fb/1NwTmip3sPAHHLnKl+w4r80XZ+0GomxlnHx8ib7nfbHAYhqTt34LTuu7ZOuOvAOQMxKNtGo55X/67QAJPTglIVJoBwq0/5hV9whq1ySHH+NdSL+R5ZR3gROpEQjXSN28R4uGiQOzyTURiEgWVBXYd0YShIsZCQh1BSsky4PYOf+mobjrhn22qQjFNgxhItFnfgHDibhL3L4guxer2nO2hnjBCpYvtDdnUe3jsIUV8bWrQ0Teiprm3BVMyjAfvXcW09eDJOkrzaBfxODwiIvSNlsmsCnZkLKIubQaceiOwM2EsshmBmyrVWfNGEFsWG2JMBvLDguvhyyh1mi+4yDL9K7sKbTAYhMNRXXhXCA4nvtUL2ODf63A5PO3nijPnj0ltxt35q+6sOnZmYgAyZrH4V50LJ90KPat2oCjDlNa5pC0C3nYwY8h+zpdNY69GAWCm2tAImKXA1/xbJf4HMwgvlmr/cahj+qMt4y03tmdvbZFdBnOCzXmD+h7G/mICyh/JWxSHMS7tr7/aWw17rcB4c/8+IeHhsj5kAtNQHTKAH3qQ7bQikopLWMRTUFiIM+hS4su8RCzCyJWkIn8MAxTgmB7cd6RoXzFixMJGeztdAroj6YBuyIfHdC7Mrz6HCsGR+xpG3v2h2jTUblgKc7n1dkx+bajpStQQqhMn8TzJ597ZMYtWY91KA+KjY5BzbT73fsYK5ySzbsx+0KX7kp2/Hnydaf4j9kBeVv4UrrllHAL1zBvCzbSBo9H5sco4hdF9PBYBR59lW3hyVE+G3vKkoaAoihTSvEcp4ShnS36jd1gT7i1oYwMmyi0JvE7oKAjcZbCo9aM45/HQMK+Z8gPRNTAJ7++/+aXS1e63/lN+G+xn9QoPJcrdJlmHQ3jFZ1dgFrF5hIvtLa+RDZpUZ0E79k9mjwmAX9jB8nhyMaRHFguiYGmc0L75heej2qdVSklHrpZJYgfJxItzFH7L2zWHuGjuQr7cD+Oi/GxoqB7nG4EOS3UHO8i2NRjgXYNf3mNmC5+ebssU9tNR83YFU92We3IUQpRokSxPC0nJVzFz6tOp/lZCIVdgZWagoFsNdqolY4glAPYPbzxIK300fMT1OqS6+3vC3rpqAla9rUGIr+az3AxmyRuj3TAhlVbtjvB1p+zK9dtVqpY319HsjhRPTAJe8RBZVY7JpgWw+dkzA0JEmAKxqvV/oBFf7k/pE5PwYnY3Ow8uTkyKum5sl2fVNycsegrZ45eZkpcqfC3RmKqDt0rVEfyCnOGjwVG5JfcaKaXV2JamUS4qsXq3GIKKDXu57cipVGehJRlPB7dB5VKlQ1z1zkF9w/1i6kOnq60mTeDZxB4yvlB99+LQVJ9CFXu0a26XfoCApjCAKeUjP3Y1bgBipXyrLEcmo5uW4Msji8cAQjRYZXBPg6lrOkOmi44FmaTEWAcrCypOxMx3HI/UQgFlwvjLU0VND8615j0FgJURzfdwyNm89QRqhzT92gzo2DJmYNNpeXpOud+pXDfxfK9vR20Jb1q8aXD+4OB03qisUwe3njlsbwcmMv2kd8CErRJcFWWNavDn63OzcQtpsM+T31mmL3AdkGYp1n/Mel74LXWg7AW4A4eNXXm3B6BTCXAmJIr27I7raNYqQRjEjg3X3d4MktZUGKLkF9dw+0BzCLDHadYe+gYau4tXCWPXCjGQIMUygWbbdrmtbEep/Jy19hVW/PYddFpdbQh7sqP24rKtny48+yDsd/wSLlBcBYcGxIVOODslB3wAMZZyR6+9hE8yq7axCmxFV/TTy/Bnof7a8x757SThiCoZmQlbEdQmqva421LSdeylkeiOImZxyFiSh6nPFA9b8P/aYRcb2VnHvrbuMbZ8KPfVq89nZo5tik3LSlYeJXfYjqy0+DDbkg5BPFBeJKdW34Xbhj3Lnu3gLEzqtIcnV9fxZL3gMo/FHMab5/y+sZhDX+0MqxVyZvpGGxP/f29wm6liGO05jlslp6GvyX9pxGbkC2tD80Ac3EL9FcdG0bfgvdWQciTRk11DQIl8FMcF614ByEheXzx36Iu+g5/YtroANNLo25WWybT4P/GjoyDXfu/XkXZCz3ryvghbqVu7/ldtr2orScfQUIad3/gn8/6A2OwS0RvmDSYvgfQjo4WOH47gO5z2K38XPhOurevPnrb/pzP5iGMio/MzVfX6X1neBa5WRRDBsDQ5M0jfp8GEuljk2CLLG06feUn/jRz2fXlqoqiPbKlCHsEl0GBEPFGYd7jtClQp8eAsoIqTkNesH5WpuPgANwUAc+Uy795PiRKYNT9dSnFpyJVeRuZmAS0cqHdR9a8tNM79gBGLJOIUpQ1arA6+06HpbgJp3RqqsFC8dqfOCcoBuq99Iwl8rKQkPT5oE+1PrA9xonMC0mOeKN2xsZj/tkJBY3EvHHTUT0cRoEeJpwSYDbhLcWgINwncEVdFZR1XRM44YwS96pPjvQqWzeBmkcKWQkspZdW5HFsg/XlhfTIGAOSBOIMMgqo4YY1+GeIxxSMvLrDeZPm3JrepZaXWqN+v0+e8Et1up0VIuvBoeyzTc/t2PHktfHa0XHsXL36q0rqoYMxLVZCrrO7Y6vKRyZJKsRjcnhXI7d6udJYuG4mXOcbkxrF/RhRql16X0mdDydoZRzNCxkltdlGh6SJU56qxMIYhZ0yHXDyn8KY/+yzol8aUNszRJ+uoneISvzWIA9EUWLFoxf3kxb+ZsZmEAClo+YkcRyYXQHA5JkikVg1pqSURjqT7f9u+A0W1++i4HZcEmld6YWgpwor1oFxA9FARPqVTece6TICBBQE4zCpAVpIog+fw3wgdNxhuXEYdfrRflRujs5ydR3uz8/OTPKTH8orCjSdApBxRGDe45AUn/QV0n65GsCIOZjQaQnCKIMHnDabC4IrVo424phpq54S3bitVc+YqqdNv34z3+GFZxyMLe76y0qmwnzniPJEw5VofvC21JjB1fADcpvSA/IkEQMT6X7sTlod7QMQqnk7BeQnSs6XmePHjrwthfAKgtWqpyqwG8bgozFEoRdnUQ1eOg4WkmHNl0aCRVt9PZ+v3IkvuaXxxEPJEwmlBTdb3TcuUuTjhwX3xtmR9EV5qENFvDKZ8fcbwWHrDSC1sWM5ZhiYiy0TU/kcCr3l/X6abu0aT6qZgGiDnfQ77rMu3R6ISuwB/apbI007FVnIkqkXkioBePN6fGLsYzINizMJnzSY5dvLqrYvF454zRKpDRgmNUuMg6aRPCikJs7CZoMqU62JsMDIDyNSadKV4o8v/Zz53m63DqwmunklPEs6FuhcSDNxGIRDHs9v9ECQhMyBO9qo6ljRGSXLGOmfgoLibn/XUaCNWZgUkxyBInbHpmO+1CEnc8DRSi6bGaRAmMzXmmrjOHMKvQptksCJJVmsVjgEVTqsN1CxDLwJw/9iFZgg4xW5yZGVjYK/PrBDXT7FL8pAyNLPSdRl1UI5DfX///gF8Kg5bn74wKA++EhqlbNEXinHEn8p3UurI5SBNmnGEk71KckRSIOR5AkpA3DqMiIZ0yvQ7tJcOmSz6PwVZ3tTEMeophW6RCSeZG0igSZlq6BwkwkmXwszynxLKB3WoGckxnLz8ZTqM2y0Q/sDKtrB1HxH5r0G4316C0Y8kOGQNA1N35g+Py8s3DsxzV0/YQA2y8cVYPdKwchmgyT8B8d2mCTAz3gKIzHxAKmheZEQVRsHfGZJOio9kKbNpfKZ9oP+y7oln3DFre578vaRAA2VdvPXcWdVfZK33+mcAwzuv6NN0x6fadj24ai6vqpAczGW3ovj9BimmZ5AQ5AP5RWUt243Xj7q2vj0Wgi218wbc79BG5UGmT/+p/4ZAQIYjLaOxteHvEC2/IIIAu5fV025ssZa9VMFvCo1LXQYKXGFJwOWzhCKtEiBNnT85rN6ZPy5tLu9euSIBf5uzXw4ku51r3Vc+rWgke1yKbo73UAzR7XTcR8oYEVtjYHVmqy4OVikiPZuIuRYNy+SOV8SujDTkqJSUKSbnJMLGh2q7A7GrnJS1qhT5pBiVH5vIbfxAW5UptB0wYXzYVGGe5UQ+k9WbtLnrDpAMwjWvFen1dfdcPcyDUWjdZ74fdBYpicfvua7V6tGi3Txs2xnlDBsYbePVC0nTQo0UHPwDQwO2n4fSBWWQzqyov3Ll5XX0FJXP8NG6o9tqJKX+iJcW//fKRVUoZM+JqoYmY5HrdE00ChSMWYN+ACKCYhTsLANiy5UuettGRMLq8jWtZx/WJF9qIXl+OLj75kocaLiuWZquPVW+iBI0/ofWIPmy2l0/TW1EeL2sik5zfWDV21ZmZbt73x366NZ8vDy8cmZbd6wXJ915WvmV21Kt3pjCS0oCLr1gaOjPl/4KN+qQQV7Z0kLv2xxifc6S2gqKP9rwMvCvSbmswX+vqKdbZrEcB5KATcYBL2Num1aVur8VGq9GSQrlLSNLzBSGb36igIWbBUwbhVpB2bRLhB4L6jHGI88p1HudQyK1SkO1gNW2SsWynkcbHNo1VdR/By9wYdGM8e1AKceLGIEva1l8LiAslqGL1+CkV7p9d2xym6tnTnWVGj2ggYeTltwKghnBy3M6KL+2iEn88Pu2DXubW8r4dbRXfucF5jnuXgFVqd74rL0QTjouYy0cHML0EzXJm6Y/g2DEsAToPrLayd+J5bmVUjgemEl5hJcpz9K4UXWbB0xSWL+C4cPQVuqQcP9NXn+jIr6H+TIffQoXEuT0udYF88+qTNQUoQoXVFTycWtQ/CpGLTtis5vuatip4Z+FMh+yW4WbJpBje05D746njNDvd5LBlYzWsThuGMwwDHjQj5raWdboOEQq/N/JI11nxH6xW5ePnMvHEiTwfBkTW3td+zVE4mSTPpoCmCojwWxZDJoxO2mnFJqJ8X/+HPZi5XVFYW453QYAP879yY6OtaiwAUQOIEzpRzfmLs8KTeoTz+iW89jZf7N/kx6iHtBxf/eHlabN8O6MqBqhCWnQ/Bqy7L2TTvS+j4vuoP5XIrMkrOdQBHpaGFBuebMB1B4cccxs2ollPL0SUltwbgYYBy/81r145VF5jUD7nQWXCuyzAHdSrfWvu//4G1bfMylJrSk5TvL+MR5rkivHCUoElBcYrXznCADNUQlbxjaJk09If65frl/ZCukdvrYyhO9MHxKDD9Pw5TUCpvyoahihLeUZazayHfWksg3z+HOK93BfFJ0nW3ecNKEZtpXcfCDKIV5W9MDhSkHWBicHM5SaJPj6+FjPTiIwylkrEmZBFK+ldnjo3nSVp2seBoCpZZcLgH/pGsuZPTmVkfwq34rdohycacengQEYyMstrsFJIYBa0CKjfG7UNOk8aRctM6M4kLR6ZFVgGVmJt1oVSY2PEYbVhulZcr2bAEHCXpNGiSiCV09GW3v3SgsqKsSu3NnMCuYytcVwIvXRNwmbFzmr2HmFqvd9kQycIs6PEXSvInMuhRTx4UqLPnfuD2lQxMvtbnp30afMNU7HKkD/a9J1tsRvpDPsLV6g9sEmxYZXSJTlQUlU2iNYAeE/2Bizu8cBPQN9nN03c+fyY33w5oKwNQrFoXmxUTBUoek8QeMXvbPnlSr1f3hOmITaroVHtXQoVWExouzIDtJIgiDD1IK9aHh3ZrKmt/72hw8n4sct1KkFm0Mu8S8tpZIkmMay0FaDUR4FxMcoSMG49Y4p6MZCymCCx5hGxsn/T2TBsL1gVqobtdmo7OIU86K7Zv/bD/SmjpdWtDQ2MxgFXmBGiM7VLx0fLAyLuaeluOnQMIVGULfVvd6K2jKQx5ilWzoTeN8X++yUmeepaGaR5aXrgLhpR43dqd4xW9Y0L6Xnzxqd+gx86taSLuarHtnMLaprBN60rAoB4tVemSjV4DP5rTND+bQEO2ZX7d2hXvhgafZLI/vuj00zAIWULd2khebX4aPOn2nAZQyvRg2fSBFuwv/dojwqwJCJpzLfT1AyO/lr9vmuUassKDMLPct/l90BWvpt/ZAM2pVHElD86PsshmV2FuTRg4FZMccVgTRWDMxspx85t+lW4TwuVMi38K8ChY+z65FvgDwiV4932jMeGPoYZz5vPCwzz/k/hE3xy4D/TY/T97zPcxouCxX2rdP1sL+8tuS+IFpCnmmq1WUCuK1nDEKXZXI0jaC+XeVFyUKVX6KewQpqKJpUwepYYIAttXRuJVCNsCuEK+Y2CrzkhNfs/MAVZ60ZB2xkrrla0PwQLUeoPTykxPMTAJndhmV/GTm1hYjF5CcdCC7QONIVqbFRFLwr8mv26YRR7eFTeyqiPSri/cCf+crdRAjyEpLW4fiaahmRZyS9nnUP3KkpmhQ2EPiQDpSwk+6bemCQfoUNlUblZ4BMe84bas5C2m+ve5tFTAWLNRBzHZWKAVIidbeH5lSSYP7WLOeBu/ut9VGYXFqPSXhiKqap6A60TfB228UXF4wDWbOViYVvmQ6Nnmhk1Iy9xy/Qebq6aJ/n04TfTqpenVOXMUYy9oMTS4evs220lmj37ERhbZ54AxFDC3aEGTyhplpjhGFtnnwKFg43NAwK8ekkN0p+gYpks315hBfAPQjUoDmTB4/nELxFHZk2nqoDWAruZiTHBWnE9SVzqw/tO72kbhMHSspKH3h993f9z3IdZkHd1IZbacg3Lh5XfuZjhsk9CiUfg8q9UNSRBDsGLWPkOhDfl1SYzWRMU4u2iz+Z1gIby1Tlt0Xu7HK81xYnhXceo4aE55avlJ/FWuuvNJkRRJpfWkhOLAJq3ogNTBu1kZjTRzrZKROAaE4rw/xrJ3yjJriIHWvBboXRwv9lD3rE3TRudkGMEwbqJrbHEbX2d8g4Yieh022hyLnl+DOp36vAfWGg3Vvvjopp37vuljMJFDjAkPopF/mrxTRVgZMDvFlrrc2WuT8z312FM20/OQJLn/Veik7EYFTu6KfujU4fW3VaN3xWc/QsV8fWOxYaiOI3thU3b9LmkfVcrbMCJJNTi5ffbNyO7W0JyeqzzsatVkbVM4tJROc9y9QY9t18EtNuu73NJMvFbkoFyLrS64H1y7C7ZoUBnLHiWg0wat1ih39CewMmsGVqtoVj2sPDD7IP4IYHtJm3opsxbi8KdGm5x1Z6R1prsNuSiemknoLLGNHZ0irsS51wKVUJkg8qhXyCccdyFWbx3yTQQVsV9YzMhs+FZ+0fWBBvoUjmKPUKFXyi4pNXs12uloIKlohuM199lljX9qD+fucKuHveETqH7kfU/rl5cVrMYF1rvLq/7GE6B1B/qbu4+vQbnFXvOiJ93kRttsvXmrq9Q6O5LN9TZbazVSa21q3efsdrHhIJdcufsdyqh4QFDie4NZgrOUrx+gno4bxa90av6iB16ul15homBl7ACoW9kaNWIlvaHXWPJXHHo7UOc4l+n2NfSFH9TnnLNSd1y91X5n/170kl06u63VEvpvTfpprrvxR22emAf5b/ZGFgWydhF56jTz2m/ZsvxNvZPil86tmas3oCpLDNJa3zc7Vo2Kjm8K7/6wrfyPIvSAp315QuLbL7+btZmZQ9Z63OVLVOV4LMV0fltIqxYjvNz+CPD/+PLnHz9hGJNQ9cceFvirxPkR5GwIVVN2GbJq2DZv8mnXI5EmvARTAEYBw3Ix2fNAHIYgGFUt6K2iyq1psvKUf9LZV0OPDnDqTVQaSmrGlCqP/6SgbhxyiatObnV+onljOyeopknN+ZlVI3KrywkiiFJiZiiMCw8SgpRpSMHuclQq21ws0oFSosxAyGLWTQp8HArl26MAWTcWekFCrmEtRfCYtjPBSZW+c7QekKTYQJAsL2/OaBmZZyni+gEKbpAzN2vXzwJKyma9AEG0NyGEx5/R0jJBKOmzjokJR7zG6XQcJP+AW1Noxu+3C5shgyFUEpq7ALoxCLpEwZQhljuoLCZ6Z3XoLFNhXTndUlQBUhU1RlKUbNsupykiBmIGyuunSfL0uWbVcLypdrc7MQNxqetuP7U9E4W3d3P3tfdfS823BeaqAEartnU61HzxyLyuyFDegMrbuAS6kyMYbxT2f83sIUkQpLShZ5ExtWVE2Gw5AYOQUZwvIuR8kB8U3cmhqpfPbYX05Jut7jH3om2MpiDSlVU0bAkUffV7Elow4tY1we7V2PSnip8PV7fbYwhBN04m9GkYUzlzAifAg6Gj6lN9sleIpazHULSHlvyBOOvWKjlDYQIu7onfEd/6ozCtPAuYUKXSlRNJEWuQ8ZAQsVg7C0lB5IgIbHlfpTofe7OHBbPWpjKPeAcJMdqbQ8rIWD7eE28trZ4aKeWL8CsuiF+d2cHGeOi4J/oyUBxQycfZSxtSjl3H7XlOhzfxVAbDCsPKfeJ6Fh+ThuV/sa7+RILmic/q8yDzhweWDw/s+JppgPAJa48OIkytgzC3vm5b8G8gGzsYcii6gzklgpTX67+ffnwURJp7TTPzWO/B/DFw89FvBEM1JnewZWw0548v1OgBkSFToqlBTrbd3HOLUhMn2F2Vs+wSFuCh5tPLxKVoIZafy5jWSAqEVAyGQQipNiGpanTcMVCEob2Zw2WYDAuqobYn3cV8P5FGcWr1bdY3n/H2j+yQD8IqoEPXLSJ3+Co/7VpXssw2G96BJZCKBujkoLKN6T4ZMvXL7mEaQXqNSVNswOi4wUx1wV4OqXRUW1TvKvJCwaK7hRdorLFMncegI9sarqDNfrq9yjTqKdJ/Nv0ciUyRqlNpgvJ8vDfSgkaYCuuyDav6VI1kSIo3RM80zxe4aNmVEVmUQN2TNgk8XmcuTjbvWkw5QBA/W8mrp5jLTrFVyW3wjfnlCAEuifA9sxa232vaKLny/VBvZgWo/XeetQL1gMPwX2qkXuhRwXQiPhPBCMSmc5wq1ktzLIjbkK3llHUCWam87TaEi+WojqP5WjnZHdFY2KVk3CqU1/NA1LzKq+gEJvDaWMYtzuiqeG2c7mVjg5AkV85m+3GFgabEAgSRtY257lVR1E89BI3Z7QsomBHS8ChmWNZQrLdQSUruDq9Dw1SVe9UmUdIlT/3KQ1XDtwckAM3YYhHFrKrAw8AYMENh2kZTcMZg3AW8QCMMySEFidYv5PENc5mwem9qNQ1TqyHfstOGr9hs4uujZ7CvbF/hizmcW/Q38BhflJQTpFQocuUGazuPbGzBcttZN9TzNeWLEkJFSioTFTh6GmERBDwPsDBh3+uImSWaLo7PZr/ZL4hSjUjYI4pkGJdrnmDtisOpkripptmSFROqEI47dd3uoTEoT0H+WR/fHc5P7848uMFalE1fMAiqMCUaiR0kOKIMXvDMzLgF28V1MV0Fd0FEKTfOYwnysCXKKSM3Dd7aU4GOREvSvg3vxwwydwGYRcyh1xVi7a/dSz1LlZHRKFeD7vAVP931dUto3CqZxjGMwOQ8OVc4PEqOc9KbaFJpRIAy+b1fUru2noPyhQdlabXATH+uDTmOym3vN9PRlGFWyFfHePssTAsLDxuH5uxLDYnWFk4sbD+ZreQIdCkT9GP2maLtGN+nuE6zmM/KkLseMjjgjgpv+IZVw6PaM9I6gVt0G/TIwPGLTvpnCxp0wxsmC/mop86v4E7iOHzgv60I4/9TKLR+6McTAWTQ7iskx7976guylmUfMy9X5+KY80vN7TYpdzoLZ7k/OnLX6bMx7IcryGwl30XacOUTTn0bHHQpzNIyTxCMosuQdKj6Fr7Jfx+vRdcungkF0j7J6CfXyJHews9aR/5BD1FK9KyyK3DZYeF3Ufuf/mdH3/X/Kc2P7a3fQSwykAMEdsMhZamSOJWR0r/V1FiM8ibkBCJjMHoyg9wJKKR3m3187ewZyyhL5gZsko4jCad2sineUL0irRYB3mykq6LAavhK3yWFzFmHF1xIwAJzS+P3L5iuOsm0Mhe08W1oMPxvax553bvGm7cK8C/wH6rblGLoxoyYbqA4ieJZpREs5kUhYldolE6ogUuHXFwJ95rCI7YIEydKXGUFN3cWEeU4gp8xsZ8ywPmD54GR+WJ65I4D47QarjcauuHmkU2B1/bUoCMhQI1cJTI94Ol13AUcvlyln7MIL6shCa88QeJgD+zRrVdGSsijLUvyZG5G6aSWuBqcfTzdrS4eCk7DiRJz9mBRIWV9uo2kUuFO2G0rBPHKMYtoaB982FeLjkWA1bCVzUlk7uyZEge2ipe+0EgER+Q3N5OVe2D8EKvczF6XrmVe1dLVM7JjVyzr0zCHIH2I9b0BQkOtfIxpuBpubMzNry0yeDDVwhmeQE+moSwxW6vFzclMeZQPy8aHBeRu7wioMW0VqhLCxInyvbKhqafGHFICjdWz/E2hGMYmJ3H+ONtQFK27mQr9guPXJb7nyxMPUxtF1b323nRb2qvNDlNSfR0NC6JL+qvBQeg3eO1vgNBpauVj9aaJ/0Pf0YtzKLEesyv8SLtq+eiwJutb+C07h9Na1PyvX3ZMssSjUzKtOBXoYK+tQlv7ZcBpGbeCPtfieecqL4hceI0lzZNoY2/SMDNWu73rB3qzB1aeJYFqkCh1OscRxfc7W63365fStMHfwb8GaeVVb0xvxKcuE6AoW2WKRKAfqmAlMDu702s3ynwmjRg7s37fYsZ5Q+uNq5dWBKRer8fYA0noyA51w+x12LmZVyvijF3cGIMbxIRbOxq1bjsREvHRkvPJA6+o4UWWguTDrRtHPWdZ3dVIuNRqg4mPPFJx+XoqP685FfA50DLr+d9vufXccXH51NoEWlF6rPX7Q0NadxQmo4TAe2j0nQSh4WY+Vota1p3ZWjV7s6jHnu33fQnH5NF+92l+6ejLts5yomg/U2xuPLVRiiWar4gn+1/bDx+Ct49CBzpKKgY7z0PRWZ1h3qVyiNS4Q2dyY9/z5ysKwCmoo5LQ/JFZ84hAvtKegwRZ8yXy7Ss/RgdcF2D/G6Si9d9UjGjKxcklVELGoabobDQMml7OtTV+nslLqb939n+VJsQFwKKRWbKIjHDK20aGwuBsUTC/G6U6s8PDBQeNWKDOULecVbf2IsBr0KJPA0TKIh6esajZ5WMgCaRqQ/ZQlRsKFxCRIQgQ5KCiSS+Og1GdmhcqEMMJOYnR1+nY1buTWiYo+8edyZOwi1WbdYJ7lSTf83hZUBaCjeZpnXbNurgJNIZQJcIOpRrV/DhGk8onpE3LN1BNKZXGZuFUhTlLMkQSKhTgBjkdocfK+AADM8hF8wdZKwQ/Y8Bqj8FqwZggjMj9U2HrZLBB14mbD1rl4jhKgVhiw4oFoORgZ8nj0xeXrNb0JZf3429x2AtVug+IvxuRgGNqreBaOzt53CBwlTpfhtY+u8ozjGIry7pnUiVbgWsIUq9peNpdpHFJHqU3xT97i2lBUU7OhTNV9u52jkLs/ciL1/p7fE96wIohMmh/PiDucottLgU8LxKIV6WkGSGQsuckEDT8O4jv4BpVXrN0GrDA95HvvBppi0eK88rRTBgQhjZCWBgYmzOlcUgsk553wpMv5kUbbnhhonndjdhBmcaHlOaN/xaXJoboukTsIU69qR1oqtfbWJ8fjfKEy2RbY0CSeP6Nnv+HHRUxLR30ULvW+MLLm1d1rTnhuVb9GpMV5GkXxg4L/9GNQ4uztK1A47qlw0G4Snfz48K21yLtY7IWL79FLALzKdhkPt0sE4F9LiPUkkkFIYob262GmVR+wIRY0CcteFEYlGGiQpb1VOs0ZvyuSvo7W7zWzj3hwDMEmth0Mzcbav44z+O1/l6THlwidW99ZNjXthg4rEV8/qOqyb6mhCQNpGS4dI2I4ABcoZyGTA+1EKPietuSNKE6zVQ6NEJD7UzEjdrlUQGlgwdgl3b5/JgkuVVT1jHM54cXy0ptOy1MVJYQaIWAKgKukubikFXC4bT/sFmzCbvsVsikIrxhntNo6Kb+G7geV/ofSxh88njey3CIisrZycljO09xS+u3MTCFkP2bqwTh4X904/7MrGde9o/rtCoHSS8YAmOzeDcR7QEnNX0Dl5RhL0v2RFxFjVQBZopNr5gBJX0sm6Jo3co7jsWiNGC1hlXQQPsTwQQRMYcPQ3xB3zuUZhqv2sLFG9Np+t/wssGsNqV/FBHZSfIWHG7YiK+xFUrzQJTY9OToCAVVp/hOUv3kL1Yt10konpgytC+HLnbnhco4aIh99Yl/SeE5Nc+8Kmgf/MppVZ7Fu8SF2glaDZ8nV/OnuS4JRAdO6zoTHjoDHhO44fRn/FvQ9cmHX77L/Wb0Nh5aBO2v9A28C9D2xoDwhwAoYHokT7qRBP5eo2yZMq8Lfid7FASGIgOduQh4VCW9vf9avnv1UR3Eh8Yb/j9QW4N45RWAve0P49sfBTBVnYYMLr7+xt9gDt7yRN1GM7jw5gtyI4q+fu5rrOPpS2afbpeLX4SQvdcYSQSRGFwh+wHlOLg0SqVzErervLhUEHFW5vX8kM8j8kH+jdsHJg6ZQYw4SouK06qTfz7Aw6o25eh5F1xzhVxUK8pFQG6DR6NUOxUzxDg9wdOoQfK03vrnLvwtuuBdP5QvTpwfAnHi6O4qnVDHfBsclU/IozUaDpTu6gOhR2IcyzAsh5GMEOiSFC2X/GzWSAdxxXCdX6ZyAqAcaIoJvsaGrRUKvixA9oIpt2xCTEcNMgV+yWSPz8B8atdWNAT7QkEECYZ8cDBSkjqd1tToQKnEe2175FB5A2MBRxEgR2oUmvD9xa4SqKAqJvuByd/qKTTCpjgymtbvWM2O7KTcZBgl2BoUwXEqa6ZSqpsiUG40KZR001E1XddUx9RFGDr7M4F0LgmmkwvoTtPMrsFRK4QsPu2zU16OnysarGwTJwIjJ+d0pmg+75p0c1MjD4iPk5cZfdYfZliOY5mwn6EV4LzQE4Rbf5WRnByzqorHvABHo1BUobiTvdmWFBECQGyTqA3zdlfHJ28MqN4EPcAXgP7idmGOa0eKtsH9Eg5hTm+975zKo4B3+cD3SvuB/p0vNQCN82dmsgPATMbqwWPMIZRlcyAR9lU/2PmzzfmgbpoVI5wI+kEKZ6v+dTzDl0rD6+ADGc5M1rpXwtjBUnShUAzumh/RX6zheQtCtn0k5lzXmaJ2Synvl5uIi8YZudC6abiOHhSgDDo0YSsuE60HFf58wBWp2qBoxKAVW4Xsr5NGn73PtFxSM0250cWdtrZ8WYdovrW0/TFVdpcvPF7kM+mwvflMcWya2rAq844oohglJDwv4JCy1CA8pxp+Hg645HiSwIsV8jnE8f1HU5Hs6kkGFqIS+f72WEAJZ5oMwnR0pmSOU9iDisnGN8kI9G9axTve/s6QgwCpGjBYmxxfO3r4S6um4Gz7K1yD7Seahyr3lTI4dmLtaV3F+c0np/cITFISWJlnH8AMd1Hrsb7SYl5+mbb5QDMv45r5z5RBr0a4peYcT2lPT1mnbOrqFWXoxxmKFRQVl/dzahlT/qlrh+Lqnj0G+9G3XCQHzdyq6dpCAd0Dr2WWWt/3JMa+v7z6Kz+9Xa8GA7H9bm8MrmNnfQX6F2b9j8ZH4FSEKqVS8RitpwKEkeXEDehLQPKHGDX55zLoGArGaj2BZIAHaVqB3mQfpsTrP0S2muD2ITahhr+5nbYWPRD1wUMcTbj9Lg4km7byv5ma/w8WUw4YYLnI7LUMNWNoaVHL7T5IpGbiHCDwJfiSNvI5DLmdqe+GwhgthiL4Zu/wGDJHYnSJorcozGvQsUwsEo0ESd5nPOBBwnV+rjMmFX1LJJkK/mgwrcbFBP7EaYLgR5lEEUNoYEgWAn+fy2qhJGwHBVOSSb5rKl/43SRJc6lQSMrR4vji2R61SS5A1L1fLHsXl6sXkz8kdA9fOy3Hn+qYoTuCfGaIRiNN/tb+kQvIHi+hdn0sK5mTdnM9IlPR7/b7RcFoAzwhT4+IYKFBjPqEUX1KftLmXLUeHZzjtAefCybiKTCsZeAQF8L+BTuWCbdmDoGmIvHCRCnvKM/v9UWjOB0XUyllb0Qc0Z116ozxB260zhRvqL/Qb73gJzkpy44IF26Eu1XxhT+MSTPJBGNV5uWQENcqYJ8rgYtZERHl6oTitAycyLCvJqkhOJtKaxePOw7aqhFR/X9Wi4GEqlidPDmttMtk3DoZrmT01k4ob/6MJDtjTl82uqDDScx4paE/W+JllTvBafOdXyJ2k7AEu2rXBfemerO/VdV23ZAY7IM5w2FNna1RvWGDZE75yc7/fkRmIB48BY2NOsUKUPnOWWDXb+PAOgf607nP0wM1QKZxvItkDnrwaUaYnCVkwEqwK5+Zx606RGh3NXsQx7eJcng03RLtQgFAowO1+Wrcb9Huj2efq/zb3s+b6a7NjSNH9Bf9awP5JWhJrx8UFpQtm+y7SEeWmMZsspNq8jZNB3yo8SPK7FVluroIvcXpC5DRRArc9Xo4lZWzCFPlaZKMZ4VwgC1hgzlmQzi8SBRH8TwofgnlE2cZijgLOgYRR5V21hUyFMR5P04HWvKSRzx2g3AlXMmoPMOiRK1qKuf60SAla/lEKiWKBM0az78ezjLacB1TU9LRzkhT9MQhxIlxvdNP0lWSu6fWaNDw925HbJioZKKkx0xkLl2ngqXOnxHHRucdfhQDJsHtW9C6huRyOjodhwQsdq94ZdgmhrZhGGUTyMdUEvbd7/9oEKdgOZVKwcuZ6bhSjLln9XY+qSTGrfFDP4lUURR/M0FXaO3Y7QFvrWyklPhge9U/ndscHxcsRzVpFMsyh0apj0sxjB9KRuffQ6MYwWWHbo9gMrkWPRLkVJIvRWLxlEcZGHBcHO4Nak6Z5RAgWlamaQI5gwC63WhHa7WaIqwsAzabyQbpGEMYInBErKIcLV3ZV5yGYQSO2f9w1Sub2RwSgj7Khq0zM7YoH+X4qz+C+YdsyDB4brNqMflfX4iJTq0MGzXoqHwIqFY3m5oRu2k8dn7zr6mHpvVVg404raW+X6UBxmHGuqdNYgJAiVIXqXgZoWQZvkkYc/sEFkEZTvK2pcMRsU9TS4adcvlePEbl8qNhGA5H/9eE2XBoJK6XkwIhUcQdq2JOwRRcGEbZntIJgYU4ENyAMBV0DpNElF51knxl8fyrDvMChIkDb/6njzKbAbfD4UY5SvGqy2JxKt4n+G18ondTQWmmiRK7zoYKdU1kMZ3URTocIXHteg1jdqEqH1LQB6FSYVIauC9L0uYkhC0YK4s4E10qFIBBpbbahE0LsglGtMYYViNTE6L386nf4DR90cgfprTazWSujVnN6wea2c2reu/asAFk4esUwSMu6hFgdHtIelH++O8KxVf+6zceeFVLbnY6gJLJNXWcoXa6xXVp2JdyI2VkuF7fVCgsN0Q0o9gj8B7it7Bq5HCNDSgnCKjmSN2lJDZz7SCRIsLhFIgYhUuePPOoe8d/gvNCah4MeXVTqfD0Z2OHY6DrTtrTHH99LQ5Nqm0PWYDJGFLbSCHYclfCObjyhdXwZcK1Bdup1hh2WLM6GCZd5kJLPVkU5AUeJSeaMwS3i0kYZHVAYlE6NwcEhuSYGsKpsAgi8R+7HkGLQu7s7ggyLQzcGUDFlyWoTxrLcZLTfnYtyf0bdjCdQUMiNI5J2qjHzBeNgDAHzfIWmo6psPSf7/hv19l44/A9ZrzL3lu5GOvqP2D3Q6X09dmHGzX7gVi+QOTjGUN/NEDCGF3N6lT/+kqeydpX+hzWzABt2DcaU7WuH37Vv1GGCBN2makAFCoMikZtuci9MYeYSAIGAkMZIbdmflDluIWSRS40Wlta6kpHVgLZze39k+vpyf7ly/o0zC+u0K0F2TJ79vZRDpZgJxmhPntMv3XDP/Symy8DpBv+0/8TSOZtHzbKeZFTMzWGwhEpCsebXdnQRUqvHzRi7sTXqvN8Xf5G7yNWcOWVpr+kbuv6S/vkL7a67A4iE0ORlviIgGYKzc4bLfaFESOLJMiNfzopQIbEXEXkud7rMNycBucG5cu3dwbdJgb5N3x2t2Ig1Q8D1ULEnbMrTTJw5kihY6dHJ3XzJFSsm1OJrxgZXb8VtLxWyCZiTs+nJ7WnBbjB+Z7BD6d4MYxNLfap3AhKUjEkBKsLUHiTUZJaY4rRbRkY60U7OOpikl24TQ54vmC/6zMVCuZNoTGT8XZGYNP9U8wa76R2zKJwyjqtwRISUsxJ3zoTzU7vWwGdRlaDI1s6m8O/nHIZx8UKusBjmvV/3jUiNpXujK36cId79Oel63uLEoIWjLvim9CYRFJ18V0qR9H5Et5ZvsUPioSAk5fEsQMVGP7rgsXkprIh3HskFIeHzmo5PvYUU4lCffQdvDbXH2WARBWRyM56UYM0BOiSKslso0Td/eP5vztHIqVF0Lj3IFQQt/d9LlKoQXNC/pFvF/vGeaveYwv91sLivyXvzaDzfrBIM04NY2wUngaGZjingF3LsSTnpqRFVvcgTFiv+/xE5PlP655b+Y/iCeU9NBTi+4OhJf392nXA3HNfDz+SfNmVWhyw+Jq4X9C7a4vvtIZXXtG8CYgPN5ff3B6++fH9f0Hj5O4cgwXKnS4ZXNIhsBb7xYWE+Fbx4o1oWwkwNAQavMWAdDYxJ6w/WnnLwusbboS2NAwz1/wwMnRVh4ShBz2fnEut9ZExFV6wxNwQ8dUAGEYiq5xXaLpgCXkd4ZssXUPoGlK58fTZr7WKRG7OisFLciBqf8UQ66sBVBk5dYB5nB9WCztXS0TM9Nn/1g07461cCmecw3VaICy5JkGaBKn0FN3xzNbviyDJgFxWRCKhLbRFecPSjfheKHRrfqyIRuFJZq61Hjk5ufu1gefOppOmSsUHmyWyrPxa0tKyt0JTJpMH28kjO2efDHV3BoFNJeUsh4+JXnt+Q2Dh+UrKWtbhyOiL72/DrvtlCDWofby8Os8qjk+I3EnJRGxTB/UzK89WE1CjnyR7NVQc05lvJ9Zq1EuvNRIRqTVvjiFWZmWZPYJWMLzAkBTJyHcne0H1H8rnQ6KEAkM27BqpGSjxp2qgdcgn8kr/9cqupWj2+CPuPbr97EKZyV6TjdIbWAsHVpgvE8UtLyUE2LXtR4K7Z8B/3FIS3DBsm4vaCApQybOf0M3DeCV956mBjcmwBjNFgQvEpRZ68UN2OasYuzD3UjQd1mmHtdle3eCp9Hp6/vbXvpFdTrBewFDDdGsnbaupSpNtAGJ+pWj1eqFzMPxz9f3n9uneC67ieY5WdQzLi4qQJSGyxcuEoZm5xldhfx0UCIZREY2EjIe4KSSWmy+AePhP30Nt5URjhpA0mEYwXNlBCvcXIFml1MALJYpmOR6SY2mKxO8I6tMbYQ5fqPjbZo1eEHCnkrdZenpCmL79fJXembx8KsrSNBfhq4M8FrnkfhpWdR6ryWRzRyg2Ml5zIb9qqLflTzBaVWIlXZdYcO3P09P1YV4TNMvShPDLP8zNNTMPXKMqNeflj3+AvNgG3s8BZhONR7/tch3cfhCYTRLGxw94qNEaeP0OkBb5/isqLk/9cew/WgE9IC1ejlzkZaJJtHKzp8/r9WPpMfhCLvIy0STaXFEbZkLldDLwIHQ4fAV3AAfaj6wtPbndRI4x4VjEqeHOSGHCXpjtZDdLTa7Uh7hM0uZXNds+CflVLjsLM7ywqWCRd50cnIuD14ermzj/j5+ap9RX55mMJVz2x4cwHbeBzTaJkAWubjmnkYebsnf8CujwW5vqD5cVdGebqSljiWCpXV1zUWv+L1NtNueud/16qUADPaVYIthyqWDqsjlD1QXFYiGp0bUcpUeO0N++cThpr+O0FyFoLUA3WoP5MsgRT2aWxiU5LQ53LEJ6FZ5Ii97IFQVbSihWkgQk4jXeY+Hw/tGofqkqD1Nms31oc4Y6zV+VI3eYBIRIedQh9YnxUgyYWERyzXCiKhRbfeU2CXoFYmKCCPGUPh5qChDpU3qdDdf10SX86kTckLonKkXtq5a8raKel8Ykm7qZ9TwH4CHLsm3Lcb19LDbnVRCNtRDisn40Gg6WzHFdGFmjhmhndzzsZ8EWbjXb7Uaj2+sD5eXs79clkx7q/NEVh+ps9BzWxxURf0DisW4G1ZAW9DCo/lwSwLA1TANXJ4aeHgjEzQXtjOx1qo1eLQhCas3y+SQ6oBpwJhpz/rIoKVIxTcu/JLqwYnxWJaP7du1UKUZOsz1Dw46lLgjDQafuymEsxK+aIiSXsCkCbsMQK5qslwil5Aftm4uptwg7WwuP+aTwuDgTwgrLZ2DarKD4GFbHGRQ2snwHxMt9b+LVMYJTKjxvSfmzstUQlGCfSBgP+uxCi4qigUmeKPgHOqMuEpgQ59dhHxzamazIT5RJUrJnIHgnaZsDDYap4VxyiVEmSYOLwnFouOOQk0JeL/YGd8EDu2zYd5JJUip6pqy5KwNqcKCJx9Vwrk0pSiZJA0TP4I97d4m7ie8bOgcIAEAg8LGS4i+eqLVOvlQR8lbggwD8+DlWBIBf9/DLfpeU3O6oHoAuDACC/3TUHfHHif7f9m5Arq7pv/I74rIL5W202b08s4vMNB9DTc0z4l4/J/2JYxOWN3Q6txPnFcymoiBW7AOPYc5ZSsjRmUp17nxdjTnqkEdM3bYtzzhCcRn7GVpp0g9KijKLcc56ImRzZXOVcbn+5JSg4I01HpcMQNnYXNQKTXzUECw5Lt2YmGJPuqIQ67lNzdE4ToW4K5xkzQP0Ip4T9dsl4jwax/yN9xPS/OSmoLTkrG9u5yAkE8i4qFVYbMAuHT99DdYJcACJRZf2DJsYxDpGUGR3MirL4gIOYZPrUM74rExIZCiZmIsoxvUR5Vo8woOxaYkieThl0ECK8qVp5MiZ5FOByF4IA0/wBgVMV9W2Lym3XAysULJvgGFjwxtF+OCUYQC/DTO6muQwgvnBhtghmTtWB4cwbs93U+InXxrgBvziJT65HFUkIh6qL6JJYbKZOKpUaCKoCjcc5ViCTuFLLDlZywoGpuEfqQQZtt/HjqhjPCmXIAEyoybSQ+6XRkBIZqPJVgKTBUFNJHMyhMhsQRhaJoQhLBmu6zfj4wL8DCUoXyDJeAKzkpC8Tk0OzITmaB4sb5JxYWYDWJLN31pqidNqwHarujg1Meaf4atOIPLBEsqhdEsCBL7wzY3n9SOCAH/pxRGAvv6pxi3jvH0kW3Ie9Vn4hhBBKEMYTtiGcHI/Con5EI27oyE6ge4Qh6usZxljSDkTQsASQyE2FcKBzy9EAJOKaOkjhOjA4vIMA+AKMYBBFCKBh3n3mcAE7JVmnjipvOXJkWUetUXSxN/PPluChRYgA1aIl4tv6a8PSpIsJ3ZomA6V4FmwZEy/djkyZHPnxEm2OFkWyLAGc5Qt08bUi2RJ4mQWH/5XLYvlSLSgfqxNd4gEWYvlomV+ijNHzhQUJkmSCC3K94fPFknB0USOlCaIXkSJP701SSYlgCAnyeIqjc2aL6Ok59OfYamsUrMUJcVrOy84VAIqTmqSqUVSQor7iTxmKLlomf0Ul9aJkqJkciY7n6O4OmkhJ0NRhWJOJZBPZXhlu8bA3N6bQSvl+1sOB+Y7H9jDO99WcbbRGs1OPHtvSCU454KLxpBxINfvksuuvEfcm+8skdJV1yS5ocZ2O4zzgcu7x71xN92SbMBE7iaZ7J0pvH48d4p0C7Xzztg93Vu+MmphZ7432yvzd1uOXEssFhD4O859MP+QJ8hSy62wzAYr7TTbkGBzhFgjVJhV8hVY/c50716U9w6KDgLR4LgTQUcGiIFIWKeNyTvhjbyP3P+4LImCiQwRC7ERBxkhrsbyNOGwr74ZiRZNFWgGHkKMGbEithlhI4kOp/yJjY5nGq5ddlMzxBJjrqlUTjuj1x577dNjk6OOoWEahVSmVIVylYrEGlTsCIMwp0R9WMDx0bD9KDasrTWPnkdYwgiRVoq1ltJGiaO0dbR2VPNU5Y6H7rrnUdgr9WcLBKmUM/WMtVbUh0dx67wFceGd6qa9JNbEqrgg6rVwj9fboTOiFiTLxmFZP4uiW1TrllIx8w2rNkqEfmZCtWpZP2EBQhr1+tzCit4Un5gBLuKzLMB/WFjUiyKftmHGflctp+CG2QvftfhQ0+fTiV9PHR3FyDnNLyKXy6VGbdFmaqbi5LuOobaGLyPB2MzXNECrjlqrPgxsy12lPoWvoaoXtNkSotNibZQ/OQJblEuLuUz/57P0iqkMOcszc4P1wTJZqA6PdH6mC7ynAAA=) format('woff2');}
.zsb-anchor{ --font-ui:"Outfit","Segoe UI",system-ui,-apple-system,sans-serif; --font-mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --surface-base:#EEF0F7; --surface-subtle:#F6F7FB; --surface-card:#FFFFFF; --surface-elevated:#FFFFFF; --surface-glass:rgba(255,255,255,.92);
  --text-primary:#15161E; --text-secondary:#54566B; --text-tertiary:#8A8C9E; --text-faint:#BDBFCD;
  --border-subtle:rgba(20,23,50,.07); --border-default:rgba(20,23,50,.11); --border-strong:rgba(20,23,50,.16);
  --hover-overlay:rgba(20,23,50,.03); --accent:#7C5CFF; --accent-b:#5B8DEF; --accent-strong:#6344E0;
  --accent-soft:rgba(124,92,255,.12); --accent-mid:rgba(124,92,255,.18);
  --accent-grad:linear-gradient(135deg,#7C5CFF 0%,#5B8DEF 100%); --grad-soft:linear-gradient(135deg,rgba(124,92,255,.14) 0%,rgba(91,141,239,.10) 100%);
  --accent-glow:0 2px 12px rgba(124,92,255,.38); --seg-glow:0 2px 8px rgba(124,92,255,.32);
  /* Toolbar chrome. The bar follows [data-theme] exactly like every other surface —
     these are the LIGHT values; the dark block below overrides the whole group.
     Every colour inside a .zsb-bar rule must resolve from a --tb-* token. */
  --tb-bg:#FFFFFF; --tb-border:rgba(20,23,50,.10); --tb-shadow:0 2px 8px rgba(16,24,64,.08),0 18px 44px -14px rgba(16,24,64,.22);
  --tb-pill:rgba(20,23,50,.04); --tb-pill-hover:rgba(20,23,50,.07); --tb-pill-active:rgba(124,92,255,.14); --tb-pill-active-fg:#5B3FD6;
  --tb-text:#54566B; --tb-text-strong:#15161E; --tb-text-active:#5B3FD6; --tb-icon:#8A8C9E;
  --tb-gear-hover-border:rgba(20,23,50,.14); --tb-divider:rgba(20,23,50,.10); --tb-ring:rgba(124,92,255,.35);
  --tb-brand-dot:rgba(124,92,255,.85); --tb-brand-glow:0 0 6px rgba(124,92,255,.45); --tb-brand-text:rgba(20,23,50,.42);
  --tb-danger-bg:rgba(229,72,77,.12); --tb-danger-fg:#C42B30;
  --shadow-card:0 1px 2px rgba(16,24,64,.05),0 10px 24px -12px rgba(16,24,64,.18);
  --shadow-popover:0 2px 4px rgba(16,24,64,.06),0 18px 44px -14px rgba(16,24,64,.24);
  --ease-standard:cubic-bezier(0.16,1,0.3,1);
  position:absolute; z-index:20; display:flex; gap:10px; }
.zsb-anchor[data-corner="bl"]{ bottom:16px; left:18px; top:auto; right:auto; align-items:flex-end; }
.zsb-anchor[data-corner="tl"]{ top:16px; left:18px; bottom:auto; right:auto; align-items:flex-start; }
.zsb-anchor[data-corner="tr"]{ top:16px; right:18px; bottom:auto; left:auto; align-items:flex-start; }
.zsb-anchor[data-corner="br"]{ bottom:16px; right:18px; top:auto; left:auto; align-items:flex-end; }
.zsb-anchor[data-corner="tr"] .zsb-gear, .zsb-anchor[data-corner="br"] .zsb-gear{ order:10; }
.zsb-anchor[data-corner="tr"] .zsb-div, .zsb-anchor[data-corner="br"] .zsb-div{ order:9; }
.zsb-anchor[data-theme="dark"]{ --surface-base:#0A0A0F; --surface-subtle:#111118; --surface-card:#16161F; --surface-elevated:#1E1E2A; --surface-glass:rgba(26,28,42,.92);
  --text-primary:#F4F4F6; --text-secondary:#A6A6B5; --text-tertiary:#70707F; --text-faint:#4A4A56;
  --border-subtle:rgba(255,255,255,.07); --border-default:rgba(255,255,255,.11); --border-strong:rgba(255,255,255,.18);
  --hover-overlay:rgba(255,255,255,.04); --accent-soft:rgba(124,92,255,.18);
  --tb-bg:#13141F; --tb-border:rgba(255,255,255,.08); --tb-shadow:0 2px 8px rgba(0,0,0,.35),0 18px 44px -10px rgba(0,0,0,.5);
  --tb-pill:rgba(255,255,255,.07); --tb-pill-hover:rgba(255,255,255,.12); --tb-pill-active:rgba(124,92,255,.22); --tb-pill-active-fg:#C5AEFF;
  --tb-text:rgba(255,255,255,.55); --tb-text-strong:#FFFFFF; --tb-text-active:#C5AEFF; --tb-icon:rgba(255,255,255,.4);
  --tb-gear-hover-border:rgba(255,255,255,.16); --tb-divider:rgba(255,255,255,.10);
  --tb-brand-glow:0 0 6px rgba(124,92,255,.8); --tb-brand-text:rgba(255,255,255,.35);
  --tb-danger-bg:rgba(229,72,77,.22); --tb-danger-fg:#FF8A8D;
  --shadow-card:0 1px 0 rgba(255,255,255,.04) inset,0 12px 28px -12px rgba(0,0,0,.7);
  --shadow-popover:0 1px 0 rgba(255,255,255,.06) inset,0 18px 48px -16px rgba(0,0,0,.8); }

/* ── High contrast ────────────────────────────────────────────────────────────
   Two reinforcing paths so the bar is legible in EVERY Power BI HC scenario:
   1. data-theme="hc" — set by the host when colorPalette.isHighContrast. Themes
      from the host's HC roles (--hc-fg/-bg/-accent, written by setHighContrast);
      falls back to CSS system colours when no roles are supplied. Needed for the
      Power BI service, where HC does NOT switch the browser into forced-colors.
   2. @media (forced-colors:active) — OS-level forced colours (Power BI Desktop on
      Windows HC, or any browser forced-colors). The UA recolours everything; we
      only add borders for separation, map active→Highlight, and opt the colour
      PICKER tools out (forced-color-adjust:none) so real swatches stay truthful.
   Brand gradients/glows/shadows collapse to flat fills so nothing relies on colour
   the UA will strip. Selected fills invert (accent fill + background-colour text)
   so they keep a guaranteed-contrast pair. */
.zsb-anchor[data-theme="hc"]{ color-scheme:only light;
  --hc-fg:CanvasText; --hc-bg:Canvas; --hc-accent:Highlight; --hc-on-accent:HighlightText;
  --surface-base:var(--hc-bg); --surface-subtle:var(--hc-bg); --surface-card:var(--hc-bg); --surface-elevated:var(--hc-bg); --surface-glass:var(--hc-bg);
  --text-primary:var(--hc-fg); --text-secondary:var(--hc-fg); --text-tertiary:var(--hc-fg); --text-faint:var(--hc-fg);
  --border-subtle:var(--hc-fg); --border-default:var(--hc-fg); --border-strong:var(--hc-fg);
  --hover-overlay:transparent; --accent:var(--hc-accent); --accent-b:var(--hc-accent); --accent-strong:var(--hc-accent);
  --accent-soft:transparent; --accent-mid:var(--hc-accent);
  --accent-grad:var(--hc-accent); --grad-soft:transparent; --accent-glow:none; --seg-glow:none;
  --tb-bg:var(--hc-bg); --tb-border:var(--hc-fg); --tb-shadow:none;
  --tb-pill:var(--hc-bg); --tb-pill-hover:var(--hc-bg); --tb-pill-active:var(--hc-accent); --tb-pill-active-fg:var(--hc-on-accent);
  --tb-text:var(--hc-fg); --tb-text-strong:var(--hc-fg); --tb-text-active:var(--hc-accent); --tb-icon:var(--hc-fg);
  --tb-gear-hover-border:var(--hc-fg); --tb-divider:var(--hc-fg); --tb-ring:var(--hc-accent);
  --tb-brand-dot:var(--hc-fg); --tb-brand-glow:none; --tb-brand-text:var(--hc-fg);
  --tb-danger-bg:var(--hc-bg); --tb-danger-fg:var(--hc-fg);
  --shadow-card:none; --shadow-popover:none; }
/* borders for elements that normally rely on a fill/shadow for their shape */
.zsb-anchor[data-theme="hc"] .zsb-group, .zsb-anchor[data-theme="hc"] .zsb-page{ border:1px solid var(--hc-fg); }
.zsb-anchor[data-theme="hc"] .zsb-group[data-open="true"]{ outline:2px solid var(--hc-accent); box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-rail-row[data-active="true"], .zsb-anchor[data-theme="hc"] .zsb-trigger[data-open="true"]{ outline:1.5px solid var(--hc-accent); }
/* Z-170 — the inversion is now carried by --tb-pill-active-fg (see the theme blocks),
   NOT by a hand-maintained per-selector list here.
   WHY: in HC, --tb-pill-active and --tb-text-active BOTH resolve to Highlight, so any
   surface that fills with the first and labels with the second is Highlight-on-Highlight
   — an invisible label. This block used to patch exactly three selectors, which meant
   every NEW control that filled with the accent had to remember to join the list, and
   nothing enforced it. The token cannot be forgotten: it is read at the point of use.
   Anything that fills with --tb-pill-active MUST label with --tb-pill-active-fg. */
/* The active segment is one of the four DELIBERATE literal exceptions (white text on a
   saturated accent fill — see the README). Its fill is --accent-grad, not --tb-pill-active,
   so it can't read the token implicitly; in HC the accent collapses to Highlight and the
   literal #fff would be white-on-Highlight. Flip it explicitly, via the same token. */
.zsb-anchor[data-theme="hc"] .zsb-seg-btn[data-active="true"]{ color:var(--tb-pill-active-fg); box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-switch{ background:var(--hc-bg); box-shadow:inset 0 0 0 1.5px var(--hc-fg); }
.zsb-anchor[data-theme="hc"] .zsb-switch i{ background:var(--hc-fg); box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-switch[data-on="true"]{ background:var(--hc-accent); box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-switch[data-on="true"] i{ background:var(--hc-bg); }
.zsb-anchor[data-theme="hc"] .zsb-pop-accent{ box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-brand-dot{ background:var(--hc-accent); box-shadow:none; }
.zsb-anchor[data-theme="hc"] .zsb-brand-name{ color:var(--hc-fg); }
.zsb-anchor[data-theme="hc"] button:focus-visible, .zsb-anchor[data-theme="hc"] input:focus-visible{ outline:2px solid var(--hc-accent); outline-offset:1px; }

@media (forced-colors: active){
  .zsb-bar, .zsb-pop, .zsb-gear, .zsb-group, .zsb-step, .zsb-seg, .zsb-input, .zsb-info-tip{ border:1px solid CanvasText; }
  .zsb-seg-btn[data-active="true"]{ background:Highlight; color:HighlightText; }
  .zsb-group[data-open="true"], .zsb-rail-row[data-active="true"], .zsb-trigger[data-open="true"]{ outline:2px solid Highlight; }
  .zsb-switch{ border:1px solid CanvasText; }
  .zsb-switch i{ background:CanvasText; }
  .zsb-switch[data-on="true"]{ background:Highlight; }
  .zsb-switch[data-on="true"] i{ background:Canvas; }
  button:focus-visible, input:focus-visible{ outline:2px solid Highlight; outline-offset:1px; }
  /* the colour-picker tools MUST keep their real colours, not be recoloured */
  .zsb-opt-sw, .zsb-swatch2, .zsb-color-chip, .zsb-cp-sv, .zsb-cp-sv-white, .zsb-cp-sv-black,
  .zsb-cp-hue, .zsb-cp-thumb, .zsb-cp-hue-thumb, .zsb-pop-accent, .zsb-brand-dot, .zsb-fontopt{ forced-color-adjust:none; }
}

.zsb-gear{ flex:none; width:36px; height:36px; display:grid; place-items:center; border-radius:10px; cursor:pointer;
  color:var(--text-secondary); border:1px solid var(--border-subtle); background:var(--surface-card); box-shadow:var(--shadow-card); transition:all .2s var(--ease-standard); }
.zsb-gear:hover{ color:var(--text-primary); border-color:var(--border-default); }
.zsb-gear.is-open{ background:var(--accent-soft); border-color:transparent; color:var(--accent); box-shadow:none; }
/* the gear lives in the bar while open — give it the toolbar's pill treatment.
   The collapsed launcher keeps the card style above (it sits on the chart). */
.zsb-bar .zsb-gear{ width:34px; height:34px; background:var(--tb-pill); border-color:var(--tb-border); color:var(--tb-text); box-shadow:none; }
.zsb-bar .zsb-gear:hover{ color:var(--tb-text-strong); border-color:var(--tb-gear-hover-border); }
.zsb-bar .zsb-gear.is-open{ background:var(--tb-pill-active); border-color:transparent; color:var(--tb-pill-active-fg); box-shadow:0 0 0 1px var(--tb-ring); }
/* Gear spin uses CSS animations, NOT a transition: buildBar()/collapse() re-parent
   the gear between the anchor and the bar, and a re-parent cancels transitions — but
   an animation replays on (re)insertion, so the spin survives the move. forwards holds
   the end angle until the next state swaps the class. */
.zsb-gear.is-open svg{ animation:zsbGearOpen .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
.zsb-gear.zsb-gear--closing svg{ animation:zsbGearClose .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
@keyframes zsbGearOpen{ from{ transform:rotate(0); } to{ transform:rotate(180deg); } }
@keyframes zsbGearClose{ from{ transform:rotate(180deg); } to{ transform:rotate(0); } }

.zsb-bar{ position:relative; display:flex; align-items:center; gap:6px; padding:8px 12px; border-radius:14px;
  background:var(--tb-bg); border:1px solid var(--tb-border); box-shadow:var(--tb-shadow); }
/* Entrance: the bar unfurls out of the gear via a clip-path reveal — the gear edge
   stays put (~50px is left unclipped) and the options sweep out from it, while the
   gear icon spins (see .zsb-gear.is-open below). Reveal direction follows the gear's
   side: left for tl/bl, right for tr/br.
   TRADEOFF: clip-path composites the bar onto a GPU layer, so the category names
   soften for the ~0.42s the animation runs (the crispness concern noted in
   applyOffset). No fill-mode and no standing clip-path on the base rule, so it
   snaps back to crisp direct-to-screen rendering the instant it lands. */
.zsb-anchor[data-corner="bl"] .zsb-bar, .zsb-anchor[data-corner="tl"] .zsb-bar{ animation:zsbBarRevealL .42s cubic-bezier(0.4,0.05,0.2,1); }
.zsb-anchor[data-corner="br"] .zsb-bar, .zsb-anchor[data-corner="tr"] .zsb-bar{ animation:zsbBarRevealR .42s cubic-bezier(0.4,0.05,0.2,1); }
/* Close: reverse the reveal — the options furl back into the gear before teardown.
   collapse() adds .zsb-bar--closing and holds the bar's removal until this finishes;
   forwards keeps it collapsed so it can't flash back to full in the last frame. */
.zsb-anchor[data-corner="bl"] .zsb-bar.zsb-bar--closing, .zsb-anchor[data-corner="tl"] .zsb-bar.zsb-bar--closing{ animation:zsbBarHideL .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
.zsb-anchor[data-corner="br"] .zsb-bar.zsb-bar--closing, .zsb-anchor[data-corner="tr"] .zsb-bar.zsb-bar--closing{ animation:zsbBarHideR .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
@keyframes zsbBarRevealL{ from{ clip-path:inset(0 calc(100% - 50px) 0 0 round 13px); } to{ clip-path:inset(0 0 0 0 round 13px); } }
@keyframes zsbBarRevealR{ from{ clip-path:inset(0 0 0 calc(100% - 50px) round 13px); } to{ clip-path:inset(0 0 0 0 round 13px); } }
@keyframes zsbBarHideL{ from{ clip-path:inset(0 0 0 0 round 13px); } to{ clip-path:inset(0 calc(100% - 50px) 0 0 round 13px); } }
@keyframes zsbBarHideR{ from{ clip-path:inset(0 0 0 0 round 13px); } to{ clip-path:inset(0 0 0 calc(100% - 50px) round 13px); } }
@media (prefers-reduced-motion:reduce){ .zsb-anchor .zsb-bar, .zsb-gear svg{ animation:none !important; } }
.zsb-div{ width:1px; height:20px; background:var(--tb-divider); flex:none; }
.zsb-row{ display:flex; align-items:center; gap:4px; width:max-content; transition:transform .34s var(--ease-standard); }
.zsb-viewport{ max-width:600px; overflow:hidden; }
.zsb-page{ flex:none; width:30px; height:30px; display:grid; place-items:center; border:0; border-radius:8px; cursor:pointer;
  padding:0; background:transparent; color:var(--tb-text); transition:background .14s,color .14s; }
.zsb-page:hover{ background:var(--tb-pill-hover); color:var(--tb-text-strong); }
.zsb-page-anim{ animation:zsbFade .18s var(--ease-standard); }
@keyframes zsbFade{ from{ opacity:0; } to{ opacity:1; } }
.zsb-reset{ flex:none; display:flex; align-items:center; gap:6px; height:30px; padding:0 11px 0 9px; border:0; border-radius:8px; cursor:pointer;
  background:transparent; color:var(--tb-text); font:600 12px var(--font-ui); white-space:nowrap; transition:background .14s, color .14s; }
.zsb-reset:hover{ background:var(--tb-pill-hover); color:var(--tb-text-strong); }
.zsb-reset svg{ color:var(--tb-icon); flex:none; }
.zsb-reset:hover svg{ color:var(--tb-text-strong); }
.zsb-reset.zsb-reset--armed{ background:var(--tb-danger-bg); color:var(--tb-danger-fg); }
.zsb-reset.zsb-reset--armed svg{ color:var(--tb-danger-fg); }
.zsb-brand{ display:flex; align-items:center; gap:6px; padding:0 6px 0 2px; flex:none; }
.zsb-brand-dot{ width:6px; height:6px; border-radius:50%; background:var(--tb-brand-dot); box-shadow:var(--tb-brand-glow); }
.zsb-brand-name{ font:500 11px var(--font-mono); letter-spacing:.5px; color:var(--tb-brand-text); }
.zsb-mwrap{ position:relative; display:flex; }
.zsb-group{ display:flex; align-items:center; gap:6px; white-space:nowrap; padding:6px 13px; border:0; background:var(--tb-pill);
  cursor:pointer; border-radius:8px; font:500 12.5px var(--font-ui); color:var(--tb-text); transition:all .18s var(--ease-standard); }
.zsb-group:hover{ background:var(--tb-pill-hover); color:var(--tb-text-strong); }
.zsb-group[data-open="true"]{ background:var(--tb-pill-active); color:var(--tb-pill-active-fg); font-weight:600; box-shadow:0 0 0 1px var(--tb-ring),var(--accent-glow); }
.zsb-group svg{ color:var(--tb-icon); transition:transform .2s, color .2s; }
.zsb-group[data-open="true"] svg{ color:var(--tb-pill-active-fg); }

/* master-detail popover */
.zsb-pop{ position:absolute; bottom:calc(100% + 12px); background:var(--surface-glass); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px);
  border:1px solid var(--border-subtle); border-radius:16px; box-shadow:var(--shadow-popover); padding:0; overflow:hidden; z-index:40; }
.zsb-pop--down{ bottom:auto; top:calc(100% + 12px); }
/* Entrance: the popover rises out of the toolbar — up when the bar sits at the
   bottom, down when it's pinned to the top. translate+opacity only (no scale) and
   no fill-mode, so the GPU layer drops the instant the animation ends and text
   returns to crisp direct-to-screen rendering (see the note on .zsb-bar). Kept
   short to minimise the brief text-softening that note warns about. */
.zsb-pop-anim{ animation:zsbPopUp .42s cubic-bezier(0.4,0.05,0.2,1); }
.zsb-pop--down.zsb-pop-anim{ animation-name:zsbPopDown; }
@keyframes zsbPopUp{ from{ opacity:0; transform:translateY(16px); } to{ opacity:1; transform:translateY(0); } }
@keyframes zsbPopDown{ from{ opacity:0; transform:translateY(-16px); } to{ opacity:1; transform:translateY(0); } }
@media (prefers-reduced-motion:reduce){ .zsb-pop-anim{ animation:none; } }
.zsb-pop-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 16px 10px;
  border-bottom:1px solid var(--border-subtle); background:linear-gradient(180deg,var(--surface-card) 0%,transparent 100%); }
.zsb-pop-head-l{ display:flex; flex-direction:column; gap:5px; min-width:0; }
.zsb-pop-accent{ height:3px; width:22px; border-radius:2px; background:var(--accent-grad); box-shadow:0 1px 4px rgba(124,92,255,.4); }
.zsb-pop-title{ font:600 10.5px var(--font-mono); letter-spacing:1.6px; text-transform:uppercase; color:var(--text-tertiary); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.zsb-info{ position:relative; flex:none; width:22px; height:22px; display:grid; place-items:center; padding:0; border:0; border-radius:6px;
  background:transparent; color:var(--text-tertiary); cursor:help; transition:color .14s, background .14s; }
.zsb-info:hover, .zsb-info:focus-visible{ color:var(--accent); background:var(--accent-soft); outline:none; }
.zsb-info-tip{ position:absolute; top:calc(100% + 8px); right:0; width:max-content; max-width:236px; box-sizing:border-box;
  padding:8px 11px; border-radius:9px; background:var(--surface-card); border:1px solid var(--border-default); box-shadow:var(--shadow-popover);
  font:500 11.5px var(--font-ui); letter-spacing:normal; text-transform:none; line-height:1.45; color:var(--text-secondary); text-align:left; white-space:normal;
  opacity:0; transform:translateY(-4px); pointer-events:none; transition:opacity .14s var(--ease-standard), transform .14s var(--ease-standard); z-index:60; }
.zsb-info:hover .zsb-info-tip, .zsb-info:focus-visible .zsb-info-tip{ opacity:1; transform:translateY(0); }
.zsb-pop-body{ display:flex; gap:0; align-items:stretch; }
.zsb-rail{ display:flex; flex-direction:column; gap:2px; width:198px; flex:none; border-right:1px solid var(--border-subtle); padding:8px 7px; }
.zsb-rail-row{ display:flex; align-items:flex-start; justify-content:space-between; gap:8px; width:100%; padding:9px 9px 9px 12px; border:0;
  background:transparent; cursor:pointer; border-radius:10px; border-left:2.5px solid transparent; transition:background .13s, border-color .13s; text-align:left; }
.zsb-rail-row:hover{ background:var(--hover-overlay); }
.zsb-rail-row[data-active="true"]{ background:var(--grad-soft); border-left-color:var(--accent); }
.zsb-rail-txt{ flex:1; min-width:0; }
.zsb-rail-name-row{ display:flex; align-items:center; gap:6px; }
.zsb-rail-name{ font:500 13px var(--font-ui); color:var(--text-primary); line-height:1.3; }
.zsb-rail-row[data-active="true"] .zsb-rail-name{ color:var(--accent); font-weight:600; }
.zsb-rail-desc{ font:400 11px var(--font-ui); color:var(--text-tertiary); margin-top:1.5px; line-height:1.3; white-space:normal; }
.zsb-rail-row[data-active="true"] .zsb-rail-desc{ color:rgba(124,92,255,.62); }
.zsb-rail-spark{ font-size:11px; line-height:1; }
.zsb-rail-badge{ font:700 9px var(--font-ui); letter-spacing:.5px; text-transform:uppercase; padding:1px 5px; border-radius:4px;
  background:var(--accent-soft); color:var(--accent); white-space:nowrap; }
.zsb-rail-row svg{ color:var(--text-faint); flex:none; margin-top:2px; }
.zsb-rail-row[data-active="true"] svg{ color:var(--accent); }
.zsb-detail{ overflow:hidden; transition:height .46s cubic-bezier(0.4,0.05,0.2,1); }
.zsb-detail-inner{ padding:6px 12px 8px; max-height:min(56vh,360px); overflow-y:auto; }

/* option rows (menu / swatch) */
.zsb-opt{ width:100%; display:flex; align-items:center; gap:11px; text-align:left; padding:9px 11px; border:0; background:transparent;
  cursor:pointer; border-radius:9px; color:var(--text-primary); transition:background .13s; }
.zsb-opt:hover{ background:var(--hover-overlay); }
.zsb-opt-label{ font:500 12.5px var(--font-ui); flex:1; white-space:nowrap; }
.zsb-opt[data-active="true"] .zsb-opt-label{ color:var(--accent); font-weight:600; }
.zsb-opt-sw{ width:18px; height:18px; border-radius:6px; flex:none; box-shadow:inset 0 0 0 1px var(--border-default); }
.zsb-accent{ color:var(--accent); display:grid; place-items:center; flex:none; }

/* fields */
.zsb-field{ padding:0; }
.zsb-field-top{ display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:42px; padding:0 8px; border-radius:8px; transition:background .12s; }
.zsb-field-top:hover{ background:var(--hover-overlay); }
.zsb-field-head{ font:600 10px var(--font-mono); letter-spacing:1px; text-transform:uppercase; color:var(--text-tertiary); padding:10px 4px 3px; }
.zsb-label{ font:500 12.5px var(--font-ui); color:var(--text-secondary); white-space:nowrap; }
.zsb-div-h{ height:1px; background:var(--border-subtle); margin:6px 4px; }
.zsb-trigger{ width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:42px; border:0;
  background:transparent; cursor:pointer; border-radius:8px; padding:0 8px; margin:0; transition:background .14s; }
.zsb-trigger-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex:1; min-width:0; }
.zsb-trigger:hover{ background:var(--hover-overlay); }
.zsb-trigger-val{ display:flex; align-items:center; gap:8px; color:var(--text-secondary); font:500 12.5px var(--font-ui); min-width:0; }
.zsb-trigger-val > span:first-child{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.zsb-chev{ color:var(--text-tertiary); flex:none; transition:transform .2s; }
.zsb-trigger[data-open="true"] .zsb-chev{ transform:rotate(180deg); color:var(--accent); }
.zsb-trigger[data-open="true"]{ background:var(--accent-soft); }
.zsb-trigger[data-open="true"] .zsb-trigger-val{ color:var(--accent); }
.zsb-field-exp{ padding:5px 4px 7px; animation:zsbExp .16s var(--ease-standard); }
@keyframes zsbExp{ from{ transform:translateY(-4px); } to{ transform:translateY(0); } }

.zsb-input{ height:32px; box-sizing:border-box; width:148px; max-width:148px; border:1px solid var(--border-default); border-radius:9px;
  background:var(--surface-subtle); padding:0 11px; font:500 12.5px var(--font-ui); color:var(--text-primary); transition:.15s; }
.zsb-input::placeholder{ color:var(--text-tertiary); }
.zsb-input:focus{ outline:none; border-color:var(--accent); background:var(--surface-card); box-shadow:0 0 0 3px var(--accent-soft); }

.zsb-step{ display:inline-flex; align-items:center; height:34px; border:1px solid var(--border-default); border-radius:9px; background:var(--surface-subtle); overflow:hidden; box-shadow:var(--shadow-card); }
.zsb-step-btn{ width:30px; height:100%; border:0; background:transparent; cursor:pointer; color:var(--accent); font-size:16px; line-height:1; display:grid; place-items:center; transition:.13s; flex:none; }
.zsb-step-btn:hover{ background:var(--accent-soft); color:var(--accent); }
.zsb-step-in{ width:34px; text-align:center; border:0; background:transparent; height:100%; font:600 13px var(--font-mono); color:var(--text-primary); outline:none; padding:0; font-variant-numeric:tabular-nums; -moz-appearance:textfield; appearance:textfield; }
.zsb-step-in::-webkit-outer-spin-button, .zsb-step-in::-webkit-inner-spin-button{ -webkit-appearance:none; margin:0; }
.zsb-step-suffix{ font:500 11px var(--font-mono); color:var(--text-tertiary); padding:0 9px 0 2px; }

.zsb-seg{ display:inline-flex; padding:3px; gap:2px; background:var(--surface-subtle); border:1px solid var(--border-default); border-radius:10px; }
.zsb-seg-btn{ min-width:32px; height:26px; padding:0 4px; border:0; background:transparent; border-radius:7px; cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:.15s; }
.zsb-seg-btn:hover{ color:var(--text-primary); }
.zsb-seg-btn[data-active="true"]{ background:var(--accent-grad); color:#fff; box-shadow:var(--seg-glow); }
.zsb-seg[data-multi="true"] .zsb-seg-btn[data-active="true"]{ background:var(--accent-grad); color:#fff; box-shadow:var(--seg-glow); }
.zsb-seg-text .zsb-seg-btn{ padding:0 11px; font:600 11.5px var(--font-ui); }
.zsb-seg-text .zsb-seg-btn[data-active="true"]{ font-weight:600; }
/* wide segmented sets: stack under the label and let the buttons wrap full-width */
.zsb-field-top.zsb-field-stack{ flex-direction:column; align-items:stretch; gap:7px; }
.zsb-field-stack .zsb-label{ white-space:normal; }
.zsb-seg.zsb-seg-wrap{ display:flex; flex-wrap:wrap; width:100%; box-sizing:border-box; }
.zsb-seg-wrap .zsb-seg-btn{ flex:1 1 auto; }
.zsb-glyph-b{ font:800 13px var(--font-ui); }
.zsb-glyph-i{ font:italic 600 13px Georgia, serif; }
.zsb-glyph-u{ font:600 13px var(--font-ui); text-decoration:underline; }

.zsb-switch{ width:40px; height:22px; border-radius:999px; background:var(--border-strong); position:relative; cursor:pointer; border:0; padding:0; flex:none; transition:background .22s; }
.zsb-switch[data-on="true"]{ background:var(--accent-grad); box-shadow:var(--accent-glow); }
.zsb-switch i{ position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:999px; background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.28); transition:left .22s var(--ease-standard); }
.zsb-switch[data-on="true"] i{ left:21px; }

.zsb-color-chip{ width:22px; height:22px; border-radius:50%; flex:none; box-shadow:inset 0 0 0 1px rgba(13,14,26,.18), 0 2px 6px rgba(13,14,26,.18); }
.zsb-mono{ font:500 11.5px var(--font-mono); color:var(--text-secondary); letter-spacing:.3px; }
.zsb-swatch2{ width:100%; aspect-ratio:1; border-radius:7px; border:0; cursor:pointer; box-shadow:inset 0 0 0 1px rgba(20,23,50,.16); transition:transform .12s; }
.zsb-swatch2:hover{ transform:scale(1.12); }
.zsb-swatch2[data-active="true"]{ box-shadow:0 0 0 2px var(--surface-elevated), 0 0 0 4px var(--accent); }

.zsb-cp{ width:254px; }
.zsb-cp-sv{ position:relative; width:100%; height:94px; border-radius:10px; cursor:crosshair; overflow:hidden; touch-action:none; box-shadow:inset 0 0 0 1px rgba(20,23,50,.12); }
.zsb-cp-sv-white{ position:absolute; inset:0; background:linear-gradient(to right,#fff,rgba(255,255,255,0)); }
.zsb-cp-sv-black{ position:absolute; inset:0; background:linear-gradient(to top,#000,rgba(0,0,0,0)); }
.zsb-cp-thumb{ position:absolute; width:15px; height:15px; border-radius:50%; border:2.5px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.45); transform:translate(-50%,-50%); pointer-events:none; }
.zsb-cp-hue{ position:relative; height:14px; border-radius:999px; margin-top:11px; cursor:pointer; touch-action:none; background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00); }
.zsb-cp-hue-thumb{ position:absolute; top:50%; width:16px; height:16px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(16,24,64,.4), inset 0 0 0 1px rgba(0,0,0,.12); transform:translate(-50%,-50%); pointer-events:none; }
.zsb-cp-row{ display:flex; align-items:center; gap:8px; margin-top:11px; }
.zsb-cp-row .zsb-hex{ width:auto; flex:1; max-width:none; font-family:var(--font-mono); font-size:12px; }
.zsb-cp-presets{ display:grid; grid-template-columns:repeat(8,1fr); gap:6px; margin-top:11px; }

.zsb-emoji-cur{ font-size:17px; line-height:1; }
.zsb-emojigrid{ display:grid; grid-template-columns:repeat(6,1fr); gap:4px; }
.zsb-emojibtn{ aspect-ratio:1; border:0; background:transparent; border-radius:9px; cursor:pointer; font-size:19px; line-height:1; display:grid; place-items:center; transition:.12s; }
.zsb-emojibtn:hover{ background:var(--hover-overlay); transform:scale(1.1); }
.zsb-emojibtn[data-active="true"]{ background:var(--accent-soft); box-shadow:inset 0 0 0 1.5px var(--accent); }
.zsb-fontlist{ display:flex; flex-direction:column; gap:1px; max-height:156px; overflow-y:auto; }
.zsb-fontopt{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 9px; border:0; background:transparent; cursor:pointer; border-radius:8px; font-size:14.5px; color:var(--text-primary); transition:background .12s; text-align:left; }
.zsb-fontopt:hover{ background:var(--hover-overlay); }
.zsb-fontopt[data-active="true"]{ background:var(--accent-soft); }
`;
