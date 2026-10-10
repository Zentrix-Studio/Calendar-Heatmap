"use strict";

/**
 * View switch — the family's segmented pill [Calendar | Table | Insight] that flips
 * the canvas between the heatmap and the two HTML-overlay views. Same UI, gestures
 * and module shape as the published Network Graph / Sankey Pro `ViewToggle`; only the
 * diagram segment's name and glyph are this visual's own.
 *
 * SESSION-LOCAL on purpose (ledger ST-B): the flip is never persisted, so it works for
 * report READERS in Reading view, where a persistProperties write would not survive.
 * What a fresh load opens on is the author's `viewSwitch.defaultView` setting.
 *
 * Placement: bottom-right, immediately LEFT of the settings gear when the gear sits
 * bottom-right too (they read as one control cluster), else flush in the corner.
 * Built once with createElement/createElementNS + textContent — never innerHTML.
 */

import { accent, fontFamily, resolveSurface, surfaceElevatedLight, HcColors } from "../theme/zentrixTokens";

export type ViewMode = "visual" | "table" | "insight";

/** Fixed segment order — the pill always reads Calendar → Table → Insight. */
const ORDER: ViewMode[] = ["visual", "table", "insight"];

// Each visual names its own diagram segment (the Network Graph's says "Graph", the
// Sankey's "Flow"); the two alternate views share their names family-wide.
const LABELS: Record<ViewMode, string> = { visual: "Calendar", table: "Table", insight: "Insight" };
/** Hover tooltips — one short "Name — what it does" line each, family wording. */
const HINTS: Record<ViewMode, string> = {
    visual: "Calendar — the heatmap itself",
    table: "Table — the same days as sortable, screen-readable rows",
    insight: "Insight — what the data says: peaks, streaks, weekly rhythm, unusual days",
};

/** Geometry shared with the visual's layout (it reserves a strip for the pill). */
export const PILL_BOTTOM = 16;   // matches the gear's bottom inset (.zsb-anchor)
export const PILL_HEIGHT = 36;
/** Canvas strip the calendar leaves free at the bottom while the pill is shown. */
export const PILL_STRIP = PILL_BOTTOM + PILL_HEIGHT;
const GEAR_RIGHT = 18, GEAR_W = 36, GAP = 8;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Did this element just receive focus from the keyboard (not a mouse click)? A host
 *  without :focus-visible treats every focus as keyboard focus — a ring too many beats
 *  none (zentrix-qa#27). */
export function keyboardFocus(el: HTMLElement): boolean {
    try { return el.matches(":focus-visible"); } catch { return true; }
}

/** 14px stroked segment icon (inherits `currentColor`). Table + Insight glyphs are the
 *  family's; the calendar glyph is a small grid of day cells. */
function segIcon(mode: ViewMode): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", "14"); s.setAttribute("height", "14");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    const path = (d: string): void => {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d); s.appendChild(p);
    };
    if (mode === "visual") {
        // Three columns of day cells — the heatmap in miniature.
        path("M4 4h4v4H4z"); path("M10 4h4v4h-4z"); path("M16 4h4v4h-4z");
        path("M4 10h4v4H4z"); path("M10 10h4v4h-4z"); path("M16 10h4v4h-4z");
        path("M4 16h4v4H4z"); path("M10 16h4v4h-4z");
    } else if (mode === "table") {
        path("M4 5h16v14H4z"); path("M4 10h16"); path("M11 10v9");
    } else {
        // Lightbulb — the plain-English read-out.
        path("M9 18h6"); path("M10 21h4");
        path("M12 3a6 6 0 0 0-3.7 10.7c.5.4.7.9.7 1.5v.3h6v-.3c0-.6.2-1.1.7-1.5A6 6 0 0 0 12 3z");
    }
    return s;
}

export class ViewToggle {
    private root: HTMLDivElement;
    private segs: Partial<Record<ViewMode, HTMLButtonElement>> = {};
    /** Segments the licence withholds — shown, but greyed and inert (NG-274 parity). */
    private locked: Partial<Record<ViewMode, boolean>> = {};
    private lockReason = "";
    /** Raised when a locked segment is clicked (the host's upgrade banner). */
    onLockedClick: (() => void) | null = null;
    private mode: ViewMode = "visual";
    private available: ViewMode[] = ["visual"];
    private dark = false;
    private hc: HcColors | null = null;
    /** True while >1 segment is offered. */
    private hasAlt = false;
    /** True while the settings bar is expanded — the open bar grows across the same
     *  bottom strip, so the pill steps out of its way. */
    private barOpen = false;
    private gearAtBr = true;

    constructor(parent: HTMLElement, private onSwitch: (mode: ViewMode) => void) {
        this.root = document.createElement("div");
        this.root.className = "zx-view-toggle";
        this.root.setAttribute("role", "tablist");
        this.root.setAttribute("aria-label", "View");
        const rs = this.root.style;
        rs.position = "absolute";
        rs.bottom = `${PILL_BOTTOM}px`;
        rs.display = "none";
        rs.gap = "2px";
        rs.alignItems = "center";
        rs.height = `${PILL_HEIGHT}px`;
        rs.padding = "3px";
        rs.borderRadius = "999px";
        rs.zIndex = "12"; // under the gear anchor (20) and every popover
        rs.boxSizing = "border-box";
        rs.font = `600 12px ${fontFamily}`;
        rs.userSelect = "none";
        this.build();
        this.place();
        parent.appendChild(this.root);
    }

    /** Build all three segments ONCE and show/hide them from then on — a rebuild per
     *  host update would drop keyboard focus mid-interaction (Sankey SP parity). */
    /** Icons only (small tiles): the labels go, the tooltips and ARIA names stay. */
    private compact = false;

    setCompact(on: boolean): void {
        if (on === this.compact) return;
        this.compact = on;
        for (const mode of ORDER) {
            const b = this.segs[mode];
            if (!b) continue;
            const label = b.querySelector("span");
            if (label) (label as HTMLElement).style.display = on ? "none" : "";
            b.style.padding = on ? "0 9px" : "0 12px";
        }
    }

    /** The segment holding KEYBOARD focus, if any — it gets the focus ring. */
    private focused: ViewMode | null = null;

    private build(): void {
        for (const mode of ORDER) {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", "tab");
            b.setAttribute("aria-label", `Switch to ${LABELS[mode]} view`);
            b.dataset.view = mode;
            b.title = HINTS[mode];
            const bs = b.style;
            bs.display = "flex"; bs.alignItems = "center"; bs.gap = "6px";
            bs.height = "30px"; bs.padding = "0 12px"; bs.borderRadius = "999px";
            bs.border = "none"; bs.cursor = "pointer"; bs.font = "inherit"; bs.background = "transparent";
            b.appendChild(segIcon(mode));
            const t = document.createElement("span");
            t.textContent = LABELS[mode];
            b.appendChild(t);
            // Keyboard focus must be visible (WCAG 2.4.7, zentrix-qa#27): the segments
            // painted `outline: none`, so a Tab onto the pill showed nothing.
            b.addEventListener("focus", () => { this.focused = keyboardFocus(b) ? mode : null; this.paint(); });
            b.addEventListener("blur", () => { if (this.focused === mode) { this.focused = null; this.paint(); } });
            b.addEventListener("click", (e) => {
                e.stopPropagation(); // never reach the canvas-click that clears selection
                if (this.locked[mode]) { this.onLockedClick?.(); return; } // teaser, not a switch
                if (this.mode === mode) return;
                this.mode = mode;
                this.paint();
                this.onSwitch(mode);
            });
            this.segs[mode] = b;
            this.root.appendChild(b);
        }
    }

    private place(): void {
        this.root.style.right = `${this.gearAtBr ? GEAR_RIGHT + GEAR_W + GAP : GEAR_RIGHT}px`;
    }

    private applyVisibility(): void {
        this.root.style.display = this.hasAlt && !this.barOpen ? "inline-flex" : "none";
    }

    private paint(): void {
        const s = resolveSurface(this.dark, this.hc);
        const hc = !!this.hc;
        // HC: the host's own background at full opacity — translucent chrome would let
        // the canvas bleed through and drop label contrast below the theme's guarantee.
        this.root.style.background = hc ? s.bg : (this.dark ? "rgba(28,30,42,0.92)" : "rgba(255,255,255,0.92)");
        this.root.style.border = `1px solid ${hc ? s.fg : (this.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}`;
        this.root.style.boxShadow = hc ? "none" : "0 6px 20px rgba(10,12,30,0.18)";
        for (const mode of ORDER) {
            const b = this.segs[mode];
            if (!b) continue;
            b.style.display = this.available.includes(mode) ? "flex" : "none";
            const active = mode === this.mode;
            const isLocked = !!this.locked[mode];
            b.style.background = active && !isLocked ? (hc ? s.fg : accent) : "transparent";
            b.style.color = active && !isLocked ? (hc ? s.bg : surfaceElevatedLight) : s.fg;
            b.style.opacity = isLocked ? "0.45" : "1";
            b.style.cursor = isLocked ? "default" : "pointer";
            // Keyboard focus ring wins; otherwise colour alone must not carry the
            // selected state in HC.
            const ring = this.focused === mode;
            b.style.outline = ring ? `2px solid ${hc ? s.fg : accent}` : hc && active ? `1px solid ${s.fg}` : "none";
            b.style.outlineOffset = ring ? "2px" : "0";
            if (isLocked) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled");
            b.title = isLocked ? this.lockReason : HINTS[mode];
            b.setAttribute("aria-selected", String(active));
        }
    }

    // ---- public API (family shape) ----

    /** Which alternate views to offer (Calendar is always present). The pill hides
     *  itself entirely when nothing but the calendar is available. */
    setSegments(opts: { table: boolean; insight: boolean }): void {
        const next: ViewMode[] = ["visual"];
        if (opts.table) next.push("table");
        if (opts.insight) next.push("insight");
        this.available = next;
        if (!next.includes(this.mode)) this.mode = "visual";
        this.hasAlt = next.length > 1;
        this.paint();
        this.applyVisibility();
    }

    /** Licence-LOCKED segments stay visible as disabled teasers (NG-274). */
    setLocked(locked: Partial<Record<ViewMode, boolean>>, reason: string): void {
        this.locked = { ...locked };
        this.lockReason = reason;
        if (this.locked[this.mode]) this.mode = "visual";
        this.paint();
    }

    setTheme(dark: boolean, hc?: HcColors | null): void {
        this.dark = dark;
        this.hc = hc ?? null;
        this.paint();
    }

    /** Whether the gear sits bottom-right (the pill steps left of it). */
    setGearAtBr(atBr: boolean): void {
        if (atBr === this.gearAtBr) return;
        this.gearAtBr = atBr;
        this.place();
    }

    /** Hide while the settings bar is expanded (it owns the bottom strip then). */
    setBarOpen(open: boolean): void {
        if (open === this.barOpen) return;
        this.barOpen = open;
        this.applyVisibility();
    }

    /** Force the mode without firing onSwitch (clamping after a settings change). */
    set(mode: ViewMode): void {
        const m = this.available.includes(mode) && !this.locked[mode] ? mode : "visual";
        if (m !== this.mode) { this.mode = m; this.paint(); }
    }

    current(): ViewMode { return this.mode; }
    hasAlternate(): boolean { return this.hasAlt; }
    /** True when the pill is actually on screen (has an alternate AND isn't hidden). */
    isShown(): boolean { return this.root.style.display !== "none"; }

    hide(): void {
        this.hasAlt = false;
        this.root.style.display = "none";
    }
}
