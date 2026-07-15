"use strict";

import { CalendarModel, DayCell } from "../types";
import { ColorAccessor } from "../render/colors";
import { appendTooltipBrand } from "../branding/zentrixBrand"; // ZENTRIX-BRAND
import {
    fontFamily, posSafe, negSafe, accent, resolveSurface, HcColors,
} from "../theme/zentrixTokens";
import { MAX_NOTES } from "../notes/store";
import {
    buildValueByDay, dayKey, dateLabel, dayOverDay, targetVariance, topContributor,
    metricLabel, formatNum, clear, div, span,
} from "./dayData";

/**
 * DayDetailPanel (Z-145) — a PERSISTENT, docked, keyboard-reachable in-visual
 * panel that turns the heatmap into an investigation tool. Unlike the hover
 * tooltip (transient, cursor-following, pointer-events:none), this panel stays
 * open until dismissed and is focusable for screen-reader users.
 *
 * It REUSES the same day derivations as the tooltip via dayData.ts — no
 * duplicated variance/delta/format logic (spec §2). All colors resolve from the
 * token mirror (Z-148); High-Contrast mode honors the host system colors.
 */

export type PanelPosition = "auto" | "right" | "bottom";
type Polarity = "good" | "bad" | "neutral";
const UP = posSafe, DOWN = negSafe;

/** Below this viewport width the panel becomes a bottom sheet (spec §4.2). */
const NARROW_W = 360;

export interface PanelContext {
    model: CalendarModel;
    colors: ColorAccessor | null;
    dark: boolean;
    /** High-Contrast system colors, or null when not in HC mode. */
    hc: HcColors | null;
    polarity: Polarity;
    position: PanelPosition;
    showTopContributor: boolean;
    brandingOn: boolean;
    /** Z-146 — matched rule name per `${facetKey}|${epoch}`. */
    ruleNameByDay: Map<string, string>;
    /** Z-152 — author-written annotation text per `${facetKey}|${epoch}`. */
    noteByDay: Map<string, string>;
    /**
     * Z-152 — whether the "Add note" affordance shows. False in Reading view:
     * `persistProperties` writes visual METADATA, which only survives a report
     * save, which needs edit rights. A consumer's note would vanish on refresh,
     * so we don't offer it rather than losing their typing. Also false once the
     * store is full.
     */
    canAnnotate: boolean;
    /** True when the store is at MAX_NOTES — offer editing, but not adding. */
    notesFull: boolean;
}

export interface PanelCallbacks {
    /** Close requested from inside the panel (✕ / Esc) — visual clears selection + restores focus. */
    onClose: () => void;
    /** Z-152 — "Add note" / "Edit note" pressed for the open day. */
    onAnnotate: (d: DayCell) => void;
}

export class DayDetailPanel {
    private el: HTMLDivElement;
    private root: HTMLElement;
    private ctx: PanelContext | null = null;
    private valueByDay = new Map<string, number>();
    private cb: PanelCallbacks;
    /** Currently shown day key, so re-renders can re-resolve the same day. */
    private openKey: string | null = null;

    constructor(root: HTMLElement, cb: PanelCallbacks) {
        this.root = root;
        this.cb = cb;
        this.el = document.createElement("div");
        this.el.setAttribute("role", "region");
        this.el.setAttribute("aria-label", "Day detail");
        this.el.tabIndex = -1; // focusable programmatically, not in the tab order until open
        this.el.style.cssText = this.baseStyle();
        this.el.style.display = "none";
        // Clicks inside the panel must not bubble to the SVG's empty-area clear.
        this.el.addEventListener("mousedown", (e) => e.stopPropagation());
        this.el.addEventListener("click", (e) => e.stopPropagation());
        this.el.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { e.stopPropagation(); this.cb.onClose(); }
        });
        root.appendChild(this.el);
    }

    private baseStyle(): string {
        return "position:absolute;z-index:1001;box-sizing:border-box;overflow:auto;" +
            `font-family:${fontFamily};box-shadow:0 6px 24px rgba(0,0,0,.22);` +
            "border-radius:12px;padding:14px 16px;";
    }

    /** Per-render context (theme, colors, value map for deltas, options). */
    setContext(ctx: PanelContext): void {
        this.ctx = ctx;
        this.valueByDay = buildValueByDay(ctx.model);
    }

    isOpen(): boolean { return this.openKey != null; }
    openDayKey(): string | null { return this.openKey; }

    /**
     * Open (or refresh) the panel for a day. Persistent: stays until close().
     * Called both on click and after re-render to re-resolve the same day so the
     * panel survives format-pane edits / resize (spec §4.1).
     */
    open(d: DayCell, opts?: { focus?: boolean }): void {
        if (!this.ctx) return;
        this.openKey = dayKey(d);
        this.renderBody(d);
        this.layout();
        this.el.style.display = "block";
        if (opts?.focus) {
            // Move SR / keyboard focus into the panel (spec §4.3).
            this.el.tabIndex = 0;
            this.el.focus();
        }
    }

    /** Re-resolve and re-render the currently-open day from a fresh model, or hide if gone. */
    refresh(): void {
        if (this.openKey == null || !this.ctx) return;
        const d = this.ctx.model.days.find(x => dayKey(x) === this.openKey);
        if (!d) { this.close(); return; }
        this.renderBody(d);
        this.layout();
    }

    close(): void {
        this.openKey = null;
        this.el.style.display = "none";
        this.el.tabIndex = -1;
    }

    // -- rendering -----------------------------------------------------------

    private theme() {
        const c = this.ctx!;
        return resolveSurface(c.dark, c.hc);
    }

    private renderBody(d: DayCell): void {
        const c = this.ctx!;
        const t = this.theme();
        this.el.style.background = t.bg;
        this.el.style.color = t.fg;
        this.el.style.border = `1px solid ${c.hc ? t.fg : (c.dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)")}`;
        clear(this.el);

        // 1. Header row: date + close button.
        const header = div("display:flex;align-items:center;justify-content:space-between;gap:8px");
        header.appendChild(div(`font-size:10px;letter-spacing:.5px;color:${t.muted}`, dateLabel(d.date)));
        header.appendChild(this.closeButton(t.muted, t.fg));
        this.el.appendChild(header);

        // 2. Facet line.
        if (d.facetKey) {
            this.el.appendChild(div(`margin-top:4px;font-size:11px;font-weight:600;color:${t.strong}`, d.facetKey));
        }

        // 3. Annotation block (Z-152) — the author's note for this day, plus the
        // entry point that creates one. This panel is the primary way in: it already
        // opens on a cell click, so "click a day → add a note" needs no new gesture.
        // (The native right-click menu is NOT available — selection.ts hands
        // contextmenu wholesale to the host and we cannot add items to it.)
        const noteText = c.noteByDay.get(dayKey(d));
        if (noteText) {
            const note = div(`margin-top:7px;font-size:12px;font-weight:600;color:${t.strong};display:flex;align-items:flex-start`);
            note.appendChild(span("margin-right:5px", "📌"));
            note.appendChild(span("", noteText));
            this.el.appendChild(note);
        }
        if (c.canAnnotate && (noteText || !c.notesFull)) {
            this.el.appendChild(this.annotateButton(d, noteText ? "Edit note" : "＋ Add note", t));
        } else if (c.canAnnotate && c.notesFull) {
            this.el.appendChild(div(`margin-top:7px;font-size:10px;color:${t.muted}`,
                `Annotation limit reached (${MAX_NOTES}). Delete one to add another.`));
        }

        // Matched rule name (Z-146) — self-explains the badge.
        const ruleName = c.ruleNameByDay.get(dayKey(d));
        if (ruleName) {
            this.el.appendChild(div(`margin-top:6px;font-size:11px;font-weight:600;color:${t.strong}`, ruleName));
        }

        if (d.noData || d.value == null) {
            this.el.appendChild(div(`margin-top:8px;font-size:13px;color:${t.muted}`, "No data"));
        } else {
            this.renderMetric(d, t);
        }

        // 9. Tooltips-role fields, verbatim.
        for (const tip of d.tooltips ?? []) {
            const row = div(`margin-top:4px;font-size:11px;color:${t.muted}`, `${tip.name}: `);
            row.appendChild(span(`color:${t.strong}`, tip.value));
            this.el.appendChild(row);
        }

        // 10. Brand attribution (host-toggleable; reuses the tooltip helper).
        if (c.brandingOn) appendTooltipBrand(this.el, c.dark);
    }

    private renderMetric(d: DayCell, t: { muted: string; strong: string }): void {
        const c = this.ctx!;
        // 4. Metric block: color dot + value name + big value.
        const dot = c.colors ? c.colors.of(d) : accent;
        const metric = div("margin-top:8px;font-size:12px;display:flex;align-items:center");
        metric.appendChild(span(`width:9px;height:9px;border-radius:2px;background:${dot};` +
            "display:inline-block;margin-right:6px;border:1px solid rgba(0,0,0,.12)", ""));
        // Count is a row count — relabel so it doesn't read as a sum (issue #4).
        metric.appendChild(span("", metricLabel(c.model.valueName, c.model.aggMode)));
        this.el.appendChild(metric);

        const valueRow = div("margin-top:2px;font-size:24px;font-weight:700;line-height:1.1");
        valueRow.appendChild(span("", formatNum(d.value!)));

        // 5. Day-over-day delta.
        const dod = dayOverDay(d, this.valueByDay);
        if (dod) {
            valueRow.appendChild(span(
                `margin-left:8px;font-size:12px;font-weight:600;color:${dod.up ? UP : DOWN}`,
                `${dod.up ? "▲" : "▼"} ${dod.pct}%`));
            this.el.appendChild(valueRow);
            this.el.appendChild(div(`margin-top:4px;font-size:11px;color:${t.muted}`,
                `${dod.up ? "+" : ""}${dod.diff} vs ${dod.prevWeekday}`));
        } else {
            this.el.appendChild(valueRow);
        }

        // 6. Target variance — token posSafe/negSafe. Suppressed under Count (a row
        // count vs a summed target is meaningless — issue #4).
        const variance = c.model.aggMode === "count" ? null : targetVariance(d);
        if (variance) {
            const tname = c.model.targetName || "Target";
            const row = div(`margin-top:6px;font-size:11px;color:${t.muted}`, `vs ${tname}: `);
            row.appendChild(span(`color:${variance.over ? UP : DOWN};font-weight:600`,
                `${variance.over ? "+" : ""}${formatNum(variance.diff)} (${variance.label})`));
            this.el.appendChild(row);
        }

        // 7. Top contributor (faceted-only; honestly omitted otherwise).
        if (c.showTopContributor) {
            const top = topContributor(d, c.model.days);
            if (top) {
                this.el.appendChild(div(`margin-top:6px;font-size:11px;color:${t.muted}`,
                    `Top: ${top.category} (${top.share}%)`));
            }
        }
    }

    /** Z-152 — the "Add note" / "Edit note" entry point for the open day. */
    private annotateButton(d: DayCell, label: string, t: { muted: string; fg: string }): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.setAttribute("aria-label", `${label} for ${dateLabel(d.date)}`);
        const idle = this.ctx?.hc ? t.fg : accent;
        btn.style.cssText =
            `all:unset;cursor:pointer;margin-top:8px;display:inline-block;font-size:11px;` +
            `font-weight:600;color:${idle};padding:5px 10px;border-radius:7px;` +
            `border:1px solid ${idle};`;
        btn.addEventListener("mouseenter", () => { btn.style.opacity = "0.75"; });
        btn.addEventListener("mouseleave", () => { btn.style.opacity = "1"; });
        btn.addEventListener("click", (e) => { e.stopPropagation(); this.cb.onAnnotate(d); });
        return btn;
    }

    private closeButton(muted: string, fg: string): HTMLButtonElement {
        const btn = document.createElement("button");
        btn.setAttribute("aria-label", "Close day detail");
        btn.textContent = "✕";
        btn.style.cssText = `all:unset;cursor:pointer;color:${muted};font-size:13px;` +
            "line-height:1;padding:2px 4px;border-radius:4px;";
        btn.addEventListener("mouseenter", () => { btn.style.color = fg; });
        btn.addEventListener("mouseleave", () => { btn.style.color = muted; });
        btn.addEventListener("click", (e) => { e.stopPropagation(); this.cb.onClose(); });
        return btn;
    }

    // -- placement -----------------------------------------------------------

    /** Resolve right-dock vs bottom-sheet from the position setting + viewport width. */
    private layout(): void {
        const c = this.ctx!;
        const w = this.root.clientWidth || this.root.getBoundingClientRect().width;
        const h = this.root.clientHeight || this.root.getBoundingClientRect().height;
        const bottom = c.position === "bottom" || (c.position === "auto" && w < NARROW_W);
        // reset
        this.el.style.left = this.el.style.right = this.el.style.top = this.el.style.bottom = "";
        this.el.style.width = this.el.style.height = this.el.style.maxHeight = "";
        if (bottom) {
            // Full-width bottom sheet (~40% height) — keeps the clicked cell visible above.
            this.el.style.left = "0";
            this.el.style.right = "0";
            this.el.style.bottom = "0";
            this.el.style.width = "100%";
            this.el.style.maxHeight = Math.max(120, Math.round(h * 0.42)) + "px";
            this.el.style.borderRadius = "12px 12px 0 0";
        } else {
            // Right-edge dock, full available height, ~200–260px wide.
            const pw = Math.min(260, Math.max(200, Math.round(w * 0.34)));
            this.el.style.right = "0";
            this.el.style.top = "0";
            this.el.style.width = pw + "px";
            this.el.style.maxHeight = h + "px";
            this.el.style.height = "auto";
            this.el.style.borderRadius = "12px";
        }
    }
}
