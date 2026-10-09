"use strict";

/**
 * The quick-action bar (HM-V2-30) — a vertical rounded card of icon buttons, top-right.
 *
 * Same chrome language as the Network Graph's, Sankey Pro's and Financial Chart's bars
 * (this file is ported from the Financial Chart's, the smallest of them), so a reader
 * moving between Zentrix visuals meets one control: 30px icon buttons on a 14px-radius
 * card, a menu that opens toward the canvas, an outcome line announced to a screen
 * reader. The calendar's bar carries one tool today:
 *
 *   · **Export** — CSV / Excel / PDF, through the host download service.
 *
 * The siblings' other tools are chart-specific and have no calendar meaning: marquee
 * select (a calendar is clicked day by day), zoom / fit (the calendar always fits its
 * tile), reset layout / undo (nothing on the calendar is dragged into place).
 *
 * There is no PNG option, on purpose: Power BI's download API accepts only
 * .txt/.csv/.json/.tmplt/.xml/.pdf/.xlsx
 * (https://learn.microsoft.com/en-us/power-bi/developer/visuals/file-download-api), so a
 * picture of the calendar travels inside the PDF instead.
 *
 * `createElement` / `createElementNS` only — never `innerHTML` (certification).
 */

import powerbi from "powerbi-visuals-api";
import { SurfaceTheme } from "../theme/zentrixTokens";

export type ExportFormat = "csv" | "xlsx" | "pdf";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 16px stroked icon inheriting `currentColor`, built through the DOM. */
function lineIcon(paths: string[]): SVGSVGElement {
    const s = document.createElementNS(SVG_NS, "svg");
    s.setAttribute("width", "16"); s.setAttribute("height", "16");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    s.setAttribute("aria-hidden", "true");
    for (const d of paths) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
    }
    return s;
}

/** The family's download glyph (Network Graph / Sankey Pro / Financial — same path). */
export const ICONS = {
    download: ["M12 4v11", "M7 11l5 5 5-5", "M5 20h14"],
};

/** Inset of the bar from the tile's top-right corner. */
export const AB_TOP = 10;
export const AB_RIGHT = 10;
/**
 * Width the calendar leaves free on its right while the bar is shown: the 44px card
 * (30px button + 6px padding each side + 1px border each side) plus its 10px inset.
 * Reserving it is what keeps the bar off the KPI chips, the legend and the grid
 * (the same idea as the view pill's bottom strip, HM-V2-02).
 */
export const AB_STRIP = 54;
/** Where the bar starts when the gear has been pinned to the top-right: below it
 *  (gear inset 10 + the 36px gear + an 8px gap). */
export const AB_BELOW_GEAR = 54;

export interface ActionBarHost {
    downloadService?: powerbi.extensibility.IDownloadService;
}

export interface ActionBarHooks {
    onExport(format: ExportFormat): Promise<void>;
    /** The answer to "may this host download?" changed — the caller re-lays out,
     *  because the bar's strip is reserved only while the bar can show. */
    onAvailabilityChange?(): void;
}

const EXPORT_OPTIONS: { format: ExportFormat; label: string; hint: string }[] = [
    { format: "csv", label: "CSV data", hint: "Every day and every month in view, as two plain-text tables" },
    { format: "xlsx", label: "Excel workbook", hint: "The same data, one sheet per table" },
    { format: "pdf", label: "PDF report", hint: "A picture of the calendar, followed by the data" },
];

const BUTTON_TITLE = "Export — the calendar's data as CSV, Excel or PDF";

export class ActionBar {
    private root: HTMLDivElement;
    private exportBtn: HTMLButtonElement;
    private menu: HTMLDivElement;
    private menuItems: HTMLButtonElement[] = [];
    private flashEl: HTMLDivElement;
    private flashTimer: number | null = null;

    private surface: SurfaceTheme = { bg: "", fg: "", muted: "", strong: "" };
    private edge = "";
    private accent = "";
    private onAccent = "";
    private dark = false;
    private hc = false;

    /** The author's Quick-action bar switch, plus "the calendar view is showing". */
    private wanted = false;
    /** Host privilege. `null` = asked, not answered yet (treated as yes, so the layout
     *  doesn't jump on every load of a report that can download — the common case). */
    private exportAllowed: boolean | null = null;
    private asked = false;
    private menuOpen = false;
    private busy = false;
    private topPx = AB_TOP;

    private outsideHandler = (ev: MouseEvent): void => {
        if (!this.root.contains(ev.target as Node)) this.closeMenu();
    };
    private keyHandler = (ev: KeyboardEvent): void => {
        if (ev.key !== "Escape" || !this.menuOpen) return;
        this.closeMenu();
        this.exportBtn.focus();
    };

    constructor(parent: HTMLElement, private host: ActionBarHost, private hooks: ActionBarHooks) {
        this.root = document.createElement("div");
        this.root.className = "zx-actions";
        this.root.setAttribute("role", "toolbar");
        this.root.setAttribute("aria-label", "Calendar actions");
        Object.assign(this.root.style, {
            position: "absolute", display: "none", flexDirection: "column",
            alignItems: "center", gap: "2px", padding: "6px", borderRadius: "14px",
            boxSizing: "border-box", zIndex: "18", right: `${AB_RIGHT}px`, top: `${AB_TOP}px`,
        } as CSSStyleDeclaration);

        this.exportBtn = document.createElement("button");
        this.exportBtn.type = "button";
        this.exportBtn.className = "zx-action zx-action-export";
        this.exportBtn.appendChild(lineIcon(ICONS.download));
        this.exportBtn.title = BUTTON_TITLE;
        this.exportBtn.setAttribute("aria-label", "Export");
        this.exportBtn.setAttribute("aria-haspopup", "menu");
        this.exportBtn.setAttribute("aria-expanded", "false");
        Object.assign(this.exportBtn.style, {
            width: "30px", height: "30px", display: "flex", alignItems: "center",
            justifyContent: "center", border: "none", background: "transparent",
            borderRadius: "9px", cursor: "pointer", lineHeight: "1", padding: "0",
        } as CSSStyleDeclaration);
        this.exportBtn.onclick = (ev): void => { ev.stopPropagation(); if (!this.busy) this.toggleMenu(); };
        this.root.appendChild(this.exportBtn);

        this.menu = document.createElement("div");
        this.menu.className = "zx-export-menu";
        this.menu.setAttribute("role", "menu");
        this.menu.setAttribute("aria-label", "Export options");
        // Opens toward the canvas (left of the bar), top-aligned with it.
        this.menu.style.cssText = "position:absolute;top:0;right:44px;width:210px;display:none;"
            + "flex-direction:column;gap:2px;padding:6px;border-radius:12px;box-sizing:border-box;z-index:2";
        for (const o of EXPORT_OPTIONS) {
            const item = document.createElement("button");
            item.type = "button";
            item.className = `zx-export-item zx-export-${o.format}`;
            item.setAttribute("role", "menuitem");
            item.setAttribute("data-format", o.format);
            item.title = o.hint;
            item.style.cssText = "width:100%;display:block;text-align:left;border:0;border-radius:8px;"
                + "background:transparent;padding:8px 10px;cursor:pointer;font:inherit";
            const label = document.createElement("div");
            label.textContent = o.label;
            label.style.cssText = "font:600 12px/1.2 'Segoe UI',system-ui,-apple-system,sans-serif";
            const hint = document.createElement("div");
            hint.textContent = o.hint;
            hint.style.cssText = "font:400 11px/1.35 'Segoe UI',system-ui,-apple-system,sans-serif;"
                + "margin-top:2px;opacity:0.75";
            item.appendChild(label); item.appendChild(hint);
            item.onclick = (ev): void => { ev.stopPropagation(); void this.run(o.format); };
            this.menuItems.push(item);
            this.menu.appendChild(item);
        }
        this.root.appendChild(this.menu);

        this.flashEl = document.createElement("div");
        this.flashEl.className = "zx-actionbar-flash";
        this.flashEl.setAttribute("role", "status");
        this.flashEl.setAttribute("aria-live", "polite");
        this.flashEl.style.cssText = "display:none;position:absolute;top:100%;right:0;margin-top:6px;"
            + "max-width:260px;white-space:normal;border-radius:8px;padding:6px 10px;pointer-events:none;"
            + "font:600 11px/1.3 'Segoe UI',system-ui,-apple-system,sans-serif";
        this.root.appendChild(this.flashEl);
        // Clicks on the bar never reach the calendar's "click empty canvas = clear".
        this.root.addEventListener("click", (ev) => ev.stopPropagation());
        parent.appendChild(this.root);
    }

    /**
     * Ask the host once whether downloads are allowed. Cached: the answer depends on
     * the tenant switch and the host, neither of which changes inside a session, and a
     * promise per paint would put a host round-trip in the render path.
     */
    refreshAvailability(): void {
        if (this.asked) return;
        this.asked = true;
        const svc = this.host.downloadService;
        if (!svc || typeof svc.exportVisualsContent !== "function") { this.setAllowed(false); return; }
        if (typeof svc.exportStatus !== "function") return; // pre-4.6 host: let the call decide
        try {
            const p = svc.exportStatus() as unknown as PromiseLike<powerbi.PrivilegeStatus>;
            // 0 = PrivilegeStatus.Allowed; compared by value so a plain mock host works.
            void Promise.resolve(p).then((status) => this.setAllowed(Number(status) === 0), () => this.setAllowed(false));
        } catch {
            this.setAllowed(false);
        }
    }

    private setAllowed(on: boolean): void {
        const before = this.available();
        this.exportAllowed = on;
        if (this.available() !== before) {
            this.applyVisibility();
            this.hooks.onAvailabilityChange?.();
        }
    }

    /** Can the bar show at all on this host (download service present and not refused)? */
    available(): boolean {
        const svc = this.host.downloadService;
        return !!svc && typeof svc.exportVisualsContent === "function" && this.exportAllowed !== false;
    }

    /** Will the bar be on screen once `setWanted(on)` is applied? The layout reserves
     *  the strip from this, before drawing. */
    shownIf(on: boolean): boolean { return on && this.available(); }

    setWanted(on: boolean): void {
        if (on === this.wanted) return;
        this.wanted = on;
        this.applyVisibility();
    }

    isShown(): boolean { return this.root.style.display !== "none"; }

    /** Start the column lower when the gear has been pinned to the same corner. */
    setTop(px: number): void {
        if (px === this.topPx) return;
        this.topPx = px;
        this.root.style.top = `${px}px`;
    }

    private applyVisibility(): void {
        const show = this.shownIf(this.wanted);
        this.root.style.display = show ? "flex" : "none";
        if (!show) this.closeMenu();
    }

    private async run(format: ExportFormat): Promise<void> {
        this.closeMenu();
        this.busy = true;
        this.paint();
        try {
            await this.hooks.onExport(format);
        } catch {
            // A failed export must never take the visual down; the hook reports it.
        } finally {
            this.busy = false;
            this.paint();
        }
    }

    /** One outcome line under the bar, announced to a screen reader too — a download
     *  that silently did nothing is the worst of the possible endings. */
    flash(message: string): void {
        if (this.flashTimer !== null) { clearTimeout(this.flashTimer); this.flashTimer = null; }
        this.flashEl.textContent = message;
        this.flashEl.style.display = "block";
        this.flashTimer = setTimeout(() => {
            this.flashEl.textContent = "";
            this.flashEl.style.display = "none";
            this.flashTimer = null;
        }, 6000) as unknown as number;
    }

    private toggleMenu(): void { if (this.menuOpen) this.closeMenu(); else this.openMenu(); }

    private openMenu(): void {
        if (this.menuOpen || !this.isShown()) return;
        this.menuOpen = true;
        this.menu.style.display = "flex";
        this.exportBtn.setAttribute("aria-expanded", "true");
        document.addEventListener("mousedown", this.outsideHandler);
        document.addEventListener("keydown", this.keyHandler);
        this.menuItems[0]?.focus();
        this.paint();
    }

    closeMenu(): void {
        if (!this.menuOpen) return;
        this.menuOpen = false;
        this.menu.style.display = "none";
        this.exportBtn.setAttribute("aria-expanded", "false");
        document.removeEventListener("mousedown", this.outsideHandler);
        document.removeEventListener("keydown", this.keyHandler);
        this.paint();
    }

    isMenuOpen(): boolean { return this.menuOpen; }

    private paint(): void {
        const lit = this.menuOpen;
        // HC has no hue to spare: a lit button inverts the host's two colours.
        this.exportBtn.style.background = lit ? (this.hc ? this.surface.fg : this.accent) : "transparent";
        this.exportBtn.style.color = lit ? (this.hc ? this.surface.bg : this.onAccent) : this.surface.fg;
        this.exportBtn.style.opacity = this.busy ? "0.5" : "1";
        this.exportBtn.style.cursor = this.busy ? "default" : "pointer";
        this.exportBtn.title = this.busy ? "Preparing the file…" : BUTTON_TITLE;
    }

    /**
     * Theme the bar from the visual's own surface. `edge` is the hairline colour,
     * `accent`/`onAccent` the lit-button pair; in high contrast all of them are the
     * host's two colours.
     */
    setTheme(dark: boolean, surface: SurfaceTheme, edge: string, accent: string, onAccent: string, hc: boolean): void {
        this.dark = dark; this.surface = surface; this.edge = edge;
        this.accent = accent; this.onAccent = onAccent; this.hc = hc;
        const card = hc ? surface.bg : dark ? "rgba(28,30,42,0.92)" : "rgba(255,255,255,0.92)";
        const menu = hc ? surface.bg : dark ? "rgba(28,30,42,0.97)" : "rgba(255,255,255,0.97)";
        this.root.style.background = card;
        this.root.style.border = `1px solid ${edge}`;
        this.root.style.boxShadow = hc ? "none" : "0 6px 20px rgba(10,12,30,0.18)";
        this.menu.style.background = menu;
        this.menu.style.color = surface.fg;
        this.menu.style.border = `1px solid ${edge}`;
        this.menu.style.boxShadow = hc ? "none" : "0 10px 28px rgba(10,12,30,0.22)";
        for (const item of this.menuItems) item.style.color = surface.fg;
        this.flashEl.style.background = menu;
        this.flashEl.style.color = surface.fg;
        this.flashEl.style.border = `1px solid ${edge}`;
        this.paint();
    }

    destroy(): void {
        document.removeEventListener("mousedown", this.outsideHandler);
        document.removeEventListener("keydown", this.keyHandler);
        this.root.remove();
    }
}
