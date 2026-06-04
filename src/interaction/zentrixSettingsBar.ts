"use strict";

/**
 * Zentrix Settings Bar — the canonical in-visual settings component.
 *
 * A self-contained, dependency-free, schema-driven port of the Zentrix
 * "category master–detail + modern control kit" design (see the build prompt).
 * Framework-agnostic vanilla DOM/TS so it drops into any Power BI custom visual.
 *
 * GLOBAL / REUSABLE: this file is the golden source. Per-visual code only
 * provides a `cfg` adapter (get/set by string key) + a `cats` schema; the bar,
 * controls, styling, animations and interaction model are identical everywhere.
 * Keep in sync with @zentrix/visual-settings in the Zentrix monorepo.
 */

/* ───────────────────────── public schema types ───────────────────────── */

/** Live settings access — the host maps string keys to its real model + persist. */
export interface SBCfg {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
}

/** A menu/seg option: a bare string (value === label) or an explicit [value, label]. */
export type SBOption = string | [value: string | number, label: string];

export interface SBPalette { name: string; light: string[]; }
export interface SBFont { id: string; label: string; css: string; }

/** One control inside a `fields` detail pane. */
export interface SBField {
    control: "switch" | "stepper" | "segText" | "segIcon" | "multiSeg" | "text" | "font" | "color" | "emoji" | "divider" | "heading";
    label?: string;
    key?: string;                         // single-key controls
    keys?: string[];                      // multiSeg → [boldKey, italicKey, underlineKey]
    glyphs?: string[];                    // multiSeg glyph labels (B/I/U)
    options?: SBOption[];                 // segText
    iconOptions?: [string | number, "left" | "center" | "right"][]; // segIcon → [value, icon]
    min?: number; max?: number; step?: number; suffix?: string;     // stepper
    placeholder?: string;                 // text
}

/** A sub-group: one row in the left rail, one detail pane. */
export interface SBSub {
    id: string;
    name?: string;
    info?: string;                        // hover-tooltip text describing what this group does
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
    closeOnAway?: boolean;
}

/* ───────────────────────── layout constants ───────────────────────── */

const RAIL_W = 149;
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
    private closeTimer: number | null = null;   // pending bar-teardown after the close animation

    private open = false;
    private activeCat: string | null = null;
    private activeSub: string | null = null;
    private exp: string | null = null;        // id of the one expanded picker
    private popLeft = 0;
    private offset = 0;
    private maxOffset = 0;
    private corner = "bl";

    constructor(private host: HTMLElement, private opts: SBOptions) {
        ensureStyle();
        if (getComputedStyle(host).position === "static") host.style.position = "relative";
        this.corner = opts.corner || "bl";
        this.anchor = div("zsb-anchor");
        this.anchor.setAttribute("data-corner", this.corner);
        this.anchor.setAttribute("data-theme", opts.dark ? "dark" : "light");
        this.gear = btn("zsb-gear zsb-collapsed");
        this.gear.title = "Visual settings";
        this.gear.appendChild(gearIcon());
        this.gear.onclick = (e) => { e.stopPropagation(); this.open ? this.collapse() : this.expand(); };
        this.anchor.appendChild(this.gear);
        host.appendChild(this.anchor);
    }

    /* ---- public host API ---- */
    setTheme(dark: boolean): void { this.opts.dark = dark; this.anchor.setAttribute("data-theme", dark ? "dark" : "light"); }
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
        if (this.ro) { this.ro.disconnect(); this.ro = null; }
        if (this.onDoc) { document.removeEventListener("mousedown", this.onDoc); this.onDoc = null; }
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
        this.open = false; this.activeCat = this.activeSub = this.exp = null;
        if (this.ro) { this.ro.disconnect(); this.ro = null; }
        if (this.onDoc) { document.removeEventListener("mousedown", this.onDoc); this.onDoc = null; }
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

        this.pageL = btn("zsb-page zsb-page-anim"); this.pageL.title = "Previous"; this.pageL.appendChild(dblChev(true));
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

        this.pageR = btn("zsb-page zsb-page-anim"); this.pageR.title = "More"; this.pageR.appendChild(dblChev(false));
        this.pageR.onclick = (e) => { e.stopPropagation(); this.page(1); };

        this.bar.appendChild(this.pageL); this.bar.appendChild(this.vp); this.bar.appendChild(this.pageR);
        this.anchor.appendChild(this.bar);

        this.offset = 0; this.measure();
        this.ro = new ResizeObserver(() => this.measure());
        this.ro.observe(this.vp); this.ro.observe(this.row);
        this.onDoc = (e) => {
            if (!this.bar || this.bar.contains(e.target as Node)) return;
            if (this.opts.closeOnAway) this.collapse(); else this.closePop();
        };
        document.addEventListener("mousedown", this.onDoc);
        this.applyOffset();
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
        head.appendChild(Object.assign(document.createElement("span"), { className: "zsb-pop-title", textContent: c.name }));
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
                rb.appendChild(Object.assign(document.createElement("span"), { textContent: s.name || s.id }));
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
        for (const f of (sub.fields || [])) host.appendChild(this.renderField(f));
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
    private renderField(f: SBField): HTMLElement {
        switch (f.control) {
            case "divider": return div("zsb-div-h");
            case "heading": { const d = div("zsb-field-head"); d.textContent = f.label || ""; return d; }
            case "switch": return this.fieldRow(f.label!, this.makeSwitch(f.key!));
            case "stepper": return this.fieldRow(f.label!, this.makeStepper(f));
            case "segText": return this.fieldRow(f.label!, this.makeSegText(f));
            case "segIcon": return this.fieldRow(f.label!, this.makeSegIcon(f));
            case "multiSeg": return this.fieldRow(f.label!, this.makeMultiSeg(f));
            case "text": return this.fieldRow(f.label!, this.makeText(f));
            case "font": return this.makeExpandable(f, "font");
            case "color": return this.makeExpandable(f, "color");
            case "emoji": return this.makeExpandable(f, "emoji");
        }
    }

    /** label-left / control-right inline row. */
    private fieldRow(label: string, control: HTMLElement): HTMLElement {
        const wrap = div("zsb-field"); const top = div("zsb-field-top");
        top.appendChild(Object.assign(div("zsb-label"), { textContent: label }));
        top.appendChild(control); wrap.appendChild(top); return wrap;
    }

    private makeSwitch(key: string): HTMLElement {
        let on = Boolean(this.cfg.get(key));
        const b = btn("zsb-switch"); b.setAttribute("data-on", String(on)); b.appendChild(document.createElement("i"));
        b.onclick = () => { on = !on; b.setAttribute("data-on", String(on)); this.cfg.set(key, on); };
        return b;
    }

    private makeStepper(f: SBField): HTMLElement {
        const min = f.min ?? 0, max = f.max ?? 999, step = f.step ?? 1;
        let val = Number(this.cfg.get(f.key!)) || 0;
        const shell = div("zsb-step");
        const dec = btn("zsb-step-btn"); dec.textContent = "−";
        const inp = el("input", "zsb-step-in"); inp.type = "number"; inp.value = String(val);
        const suf = div("zsb-step-suffix"); if (f.suffix) suf.textContent = f.suffix; else suf.style.display = "none";
        const inc = btn("zsb-step-btn"); inc.textContent = "+";
        const commit = (n: number) => { val = Math.max(min, Math.min(max, n)); inp.value = String(val); this.cfg.set(f.key!, val); };
        dec.onclick = () => commit(val - step); inc.onclick = () => commit(val + step);
        inp.onchange = () => commit(parseFloat(inp.value) || 0);
        shell.append(dec, inp, suf, inc); return shell;
    }

    private makeSegText(f: SBField): HTMLElement {
        const key = f.key!; const cur = () => String(this.cfg.get(key));
        const seg = div("zsb-seg zsb-seg-text");
        for (const o of (f.options || [])) {
            const v = optValue(o); const b = btn("zsb-seg-btn"); b.textContent = optLabel(o);
            b.setAttribute("data-active", String(cur() === v));
            b.onclick = () => { seg.querySelectorAll(".zsb-seg-btn").forEach(x => x.setAttribute("data-active", "false")); b.setAttribute("data-active", "true"); this.cfg.set(key, Array.isArray(o) ? o[0] : o); };
            seg.appendChild(b);
        }
        return seg;
    }

    private makeSegIcon(f: SBField): HTMLElement {
        const key = f.key!; const cur = () => String(this.cfg.get(key));
        const seg = div("zsb-seg");
        for (const [v, icon] of (f.iconOptions || [])) {
            const b = btn("zsb-seg-btn"); b.appendChild(alignIcon(icon));
            b.setAttribute("data-active", String(cur() === String(v)));
            b.onclick = () => { seg.querySelectorAll(".zsb-seg-btn").forEach(x => x.setAttribute("data-active", "false")); b.setAttribute("data-active", "true"); this.cfg.set(key, v); };
            seg.appendChild(b);
        }
        return seg;
    }

    private makeMultiSeg(f: SBField): HTMLElement {
        const keys = f.keys || []; const glyphs = f.glyphs || ["B", "I", "U"];
        const seg = div("zsb-seg"); seg.setAttribute("data-multi", "true");
        keys.forEach((k, i) => {
            let on = Boolean(this.cfg.get(k));
            const b = btn("zsb-seg-btn zsb-glyph-" + (glyphs[i] || "").toLowerCase());
            b.textContent = glyphs[i] || ""; b.setAttribute("data-active", String(on));
            b.onclick = () => { on = !on; b.setAttribute("data-active", String(on)); this.cfg.set(k, on); };
            seg.appendChild(b);
        });
        return seg;
    }

    private makeText(f: SBField): HTMLElement {
        const inp = el("input", "zsb-input"); inp.type = "text";
        inp.value = String(this.cfg.get(f.key!) ?? ""); if (f.placeholder) inp.placeholder = f.placeholder;
        inp.onchange = () => this.cfg.set(f.key!, inp.value);
        return inp;
    }

    /* ---- expandable controls (one open at a time) ---- */
    private makeExpandable(f: SBField, kind: "font" | "color" | "emoji"): HTMLElement {
        const id = f.key!; const wrap = div("zsb-field");
        const trigger = btn("zsb-trigger"); trigger.setAttribute("data-open", String(this.exp === id));
        const labelSpan = Object.assign(document.createElement("span"), { textContent: f.label || "", className: "zsb-label" });
        const valWrap = div("zsb-trigger-val");
        this.fillTriggerValue(valWrap, f, kind);
        const chev = caretIcon(); chev.classList.add("zsb-chev");
        const head = div("zsb-trigger-head"); head.appendChild(labelSpan); head.appendChild(valWrap);
        trigger.appendChild(head); trigger.appendChild(chev);
        trigger.onclick = (e) => { e.stopPropagation(); this.exp = this.exp === id ? null : id; this.rerenderExpandable(); };
        wrap.appendChild(trigger);
        if (this.exp === id) wrap.appendChild(this.buildExpansion(f, kind, valWrap));
        return wrap;
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
.zsb-anchor{ --font-ui:"Segoe UI","Inter",system-ui,-apple-system,sans-serif; --font-mono:"JetBrains Mono",ui-monospace,Menlo,monospace;
  --surface-base:#EEF0F7; --surface-subtle:#F6F7FB; --surface-card:#FFFFFF; --surface-elevated:#FFFFFF;
  --text-primary:#15161E; --text-secondary:#54566B; --text-tertiary:#8A8C9E;
  --border-subtle:rgba(20,23,50,.07); --border-default:rgba(20,23,50,.11); --border-strong:rgba(20,23,50,.16);
  --hover-overlay:rgba(20,23,50,.03); --accent:#7C5CFF; --accent-strong:#6344E0; --accent-soft:rgba(124,92,255,.14);
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
.zsb-anchor[data-theme="dark"]{ --surface-base:#0A0A0F; --surface-subtle:#111118; --surface-card:#16161F; --surface-elevated:#1E1E2A;
  --text-primary:#F4F4F6; --text-secondary:#A6A6B5; --text-tertiary:#70707F;
  --border-subtle:rgba(255,255,255,.07); --border-default:rgba(255,255,255,.11); --border-strong:rgba(255,255,255,.18);
  --hover-overlay:rgba(255,255,255,.04); --accent-soft:rgba(124,92,255,.18); }

.zsb-gear{ flex:none; width:36px; height:36px; display:grid; place-items:center; border-radius:10px; cursor:pointer;
  color:var(--text-secondary); border:1px solid var(--border-subtle); background:var(--surface-card); box-shadow:var(--shadow-card); transition:all .2s var(--ease-standard); }
.zsb-gear:hover{ color:var(--text-primary); border-color:var(--border-default); }
.zsb-gear.is-open{ background:var(--accent-soft); border-color:transparent; color:var(--accent); box-shadow:none; }
/* Gear spin uses CSS animations, NOT a transition: buildBar()/collapse() re-parent
   the gear between the anchor and the bar, and a re-parent cancels transitions — but
   an animation replays on (re)insertion, so the spin survives the move. forwards holds
   the end angle until the next state swaps the class. */
.zsb-gear.is-open svg{ animation:zsbGearOpen .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
.zsb-gear.zsb-gear--closing svg{ animation:zsbGearClose .42s cubic-bezier(0.4,0.05,0.2,1) forwards; }
@keyframes zsbGearOpen{ from{ transform:rotate(0); } to{ transform:rotate(180deg); } }
@keyframes zsbGearClose{ from{ transform:rotate(180deg); } to{ transform:rotate(0); } }

.zsb-bar{ position:relative; display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:13px;
  background:var(--surface-elevated); border:1px solid var(--border-subtle); box-shadow:var(--shadow-popover); }
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
.zsb-div{ width:1px; height:22px; background:var(--border-default); flex:none; }
.zsb-row{ display:flex; align-items:center; gap:2px; width:max-content; transition:transform .34s var(--ease-standard); }
.zsb-viewport{ max-width:600px; overflow:hidden; }
.zsb-page{ flex:none; width:30px; height:30px; display:grid; place-items:center; border:0; border-radius:8px; cursor:pointer;
  padding:0; background:transparent; color:var(--accent); transition:background .14s; }
.zsb-page:hover{ background:var(--accent-soft); }
.zsb-page-anim{ animation:zsbFade .18s var(--ease-standard); }
@keyframes zsbFade{ from{ opacity:0; } to{ opacity:1; } }
.zsb-mwrap{ position:relative; display:flex; }
.zsb-group{ display:flex; align-items:center; gap:7px; white-space:nowrap; padding:6px 10px; border:0; background:transparent;
  cursor:pointer; border-radius:8px; font:600 12.5px var(--font-ui); color:var(--text-primary); transition:background .15s; }
.zsb-group:hover{ background:var(--hover-overlay); }
.zsb-group[data-open="true"]{ background:var(--accent-soft); color:var(--accent); }
.zsb-group svg{ color:var(--text-tertiary); transition:transform .2s; }
.zsb-group[data-open="true"] svg{ color:var(--accent); }

/* master-detail popover */
.zsb-pop{ position:absolute; bottom:calc(100% + 12px); background:var(--surface-elevated); border:1px solid var(--border-subtle);
  border-radius:14px; box-shadow:var(--shadow-popover); padding:4px 7px 8px; z-index:40; }
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
.zsb-pop-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; font:600 10px var(--font-mono); letter-spacing:1px; text-transform:uppercase; color:var(--text-tertiary); padding:8px 11px 7px; }
.zsb-pop-title{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.zsb-info{ position:relative; flex:none; width:22px; height:22px; display:grid; place-items:center; padding:0; border:0; border-radius:6px;
  background:transparent; color:var(--text-tertiary); cursor:help; transition:color .14s, background .14s; }
.zsb-info:hover, .zsb-info:focus-visible{ color:var(--accent); background:var(--accent-soft); outline:none; }
.zsb-info-tip{ position:absolute; top:calc(100% + 8px); right:0; width:max-content; max-width:236px; box-sizing:border-box;
  padding:8px 11px; border-radius:9px; background:var(--surface-card); border:1px solid var(--border-default); box-shadow:var(--shadow-popover);
  font:500 11.5px var(--font-ui); letter-spacing:normal; text-transform:none; line-height:1.45; color:var(--text-secondary); text-align:left; white-space:normal;
  opacity:0; transform:translateY(-4px); pointer-events:none; transition:opacity .14s var(--ease-standard), transform .14s var(--ease-standard); z-index:60; }
.zsb-info:hover .zsb-info-tip, .zsb-info:focus-visible .zsb-info-tip{ opacity:1; transform:translateY(0); }
.zsb-pop-body{ display:flex; gap:7px; align-items:stretch; }
.zsb-rail{ display:flex; flex-direction:column; gap:2px; width:149px; flex:none; border-right:1px solid var(--border-subtle); padding-right:7px; }
.zsb-rail-row{ display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; padding:9px 10px; border:0;
  background:transparent; cursor:pointer; border-radius:9px; font:600 12.5px var(--font-ui); color:var(--text-primary); transition:background .13s; text-align:left; }
.zsb-rail-row:hover{ background:var(--hover-overlay); }
.zsb-rail-row[data-active="true"]{ background:var(--accent-soft); color:var(--accent); }
.zsb-rail-row svg{ color:var(--text-tertiary); flex:none; }
.zsb-rail-row[data-active="true"] svg{ color:var(--accent); }
.zsb-detail{ overflow:hidden; transition:height .46s cubic-bezier(0.4,0.05,0.2,1); }
.zsb-detail-inner{ padding:2px 3px; max-height:min(56vh,326px); overflow-y:auto; }

/* option rows (menu / swatch) */
.zsb-opt{ width:100%; display:flex; align-items:center; gap:11px; text-align:left; padding:9px 11px; border:0; background:transparent;
  cursor:pointer; border-radius:9px; color:var(--text-primary); transition:background .13s; }
.zsb-opt:hover{ background:var(--hover-overlay); }
.zsb-opt-label{ font:500 12.5px var(--font-ui); flex:1; white-space:nowrap; }
.zsb-opt[data-active="true"] .zsb-opt-label{ color:var(--accent); font-weight:600; }
.zsb-opt-sw{ width:18px; height:18px; border-radius:6px; flex:none; box-shadow:inset 0 0 0 1px var(--border-default); }
.zsb-accent{ color:var(--accent); display:grid; place-items:center; flex:none; }

/* fields */
.zsb-field{ padding:1px 3px; }
.zsb-field-top{ display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:38px; }
.zsb-field-head{ font:600 10px var(--font-mono); letter-spacing:1px; text-transform:uppercase; color:var(--text-tertiary); padding:9px 4px 3px; }
.zsb-label{ font:600 12.5px var(--font-ui); color:var(--text-primary); white-space:nowrap; }
.zsb-div-h{ height:1px; background:var(--border-subtle); margin:6px 4px; }
.zsb-trigger{ width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:38px; border:0;
  background:transparent; cursor:pointer; border-radius:9px; padding:0 8px; margin:0 -5px; transition:background .14s; }
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

.zsb-step{ display:inline-flex; align-items:center; height:32px; border:1px solid var(--border-default); border-radius:9px; background:var(--surface-subtle); overflow:hidden; }
.zsb-step-btn{ width:28px; height:100%; border:0; background:transparent; cursor:pointer; color:var(--text-secondary); font-size:16px; line-height:1; display:grid; place-items:center; transition:.13s; flex:none; }
.zsb-step-btn:hover{ background:var(--hover-overlay); color:var(--accent); }
.zsb-step-in{ width:30px; text-align:right; border:0; background:transparent; height:100%; font:600 12.5px var(--font-ui); color:var(--text-primary); outline:none; padding:0; -moz-appearance:textfield; appearance:textfield; }
.zsb-step-in::-webkit-outer-spin-button, .zsb-step-in::-webkit-inner-spin-button{ -webkit-appearance:none; margin:0; }
.zsb-step-suffix{ font:500 11px var(--font-ui); color:var(--text-tertiary); padding:0 9px 0 2px; }

.zsb-seg{ display:inline-flex; padding:3px; gap:2px; background:var(--surface-subtle); border:1px solid var(--border-default); border-radius:10px; }
.zsb-seg-btn{ min-width:32px; height:26px; padding:0 4px; border:0; background:transparent; border-radius:7px; cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:.14s; }
.zsb-seg-btn:hover{ color:var(--text-primary); }
.zsb-seg-btn[data-active="true"]{ background:var(--surface-card); color:var(--accent); box-shadow:0 1px 2px rgba(16,24,64,.14), 0 0 0 1px rgba(16,24,64,.04); }
.zsb-seg[data-multi="true"] .zsb-seg-btn[data-active="true"]{ background:var(--accent); color:#fff; box-shadow:none; }
.zsb-seg-text .zsb-seg-btn{ padding:0 11px; font:600 11.5px var(--font-ui); }
.zsb-glyph-b{ font:800 13px var(--font-ui); }
.zsb-glyph-i{ font:italic 600 13px Georgia, serif; }
.zsb-glyph-u{ font:600 13px var(--font-ui); text-decoration:underline; }

.zsb-switch{ width:38px; height:22px; border-radius:999px; background:var(--border-strong); position:relative; cursor:pointer; border:0; padding:0; flex:none; transition:background .18s; }
.zsb-switch[data-on="true"]{ background:var(--accent); }
.zsb-switch i{ position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:999px; background:#fff; box-shadow:0 1px 3px rgba(16,24,64,.35); transition:left .18s var(--ease-standard); }
.zsb-switch[data-on="true"] i{ left:18px; }

.zsb-color-chip{ width:20px; height:20px; border-radius:6px; flex:none; box-shadow:inset 0 0 0 1px rgba(20,23,50,.18), inset 0 0 0 3px rgba(255,255,255,.5); }
.zsb-mono{ font:500 11px var(--font-mono); color:var(--text-tertiary); letter-spacing:.3px; }
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
