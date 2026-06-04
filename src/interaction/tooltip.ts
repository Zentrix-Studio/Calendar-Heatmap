"use strict";

import { CalendarModel, DayCell } from "../types";
import { ColorAccessor } from "../render/colors";
import { appendTooltipBrand } from "../branding/zentrixBrand"; // ZENTRIX-BRAND

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FONT = "Segoe UI, -apple-system, sans-serif";
const UP = "#2EA043", DOWN = "#E5484D";

/**
 * Custom Zentrix tooltip — a styled DOM overlay matching the design ref
 * (date · metric · big value · delta badge · "+N vs <prev weekday>").
 * Native Power BI tooltips can't render the big-number layout, so this is an
 * in-visual overlay. No drill actions (AppSource-compliant).
 */
interface AnomalyHint { score: number; direction: "high" | "low"; severity: "moderate" | "strong"; }
type Polarity = "good" | "bad" | "neutral";

export class HeatmapTooltip {
    private el: HTMLDivElement;
    // Keyed by `${facetKey}|${dayEpoch}` so panels sharing a date don't collide.
    private valueByDay = new Map<string, number>();
    private valueName = "";
    private targetName = "Target";
    private colors: ColorAccessor | null = null;
    private dark = false;
    private anomalies?: Map<number, AnomalyHint>;
    private polarity: Polarity = "neutral";
    // BCP-47 locale from the Power BI host. Drives date + number formatting so the
    // tooltip follows the report's culture (not the machine's). Default deterministic.
    private locale = "en-US";
    private brandingOn = true; // ZENTRIX-BRAND — default ON (free tier); premium can disable

    constructor(root: HTMLElement) {
        this.el = document.createElement("div");
        this.el.style.cssText =
            "position:fixed;pointer-events:none;z-index:1000;display:none;" +
            "min-width:150px;padding:10px 12px;border-radius:10px;" +
            `font-family:${FONT};box-shadow:0 4px 16px rgba(0,0,0,.18);`;
        root.appendChild(this.el);
    }

    /** Refresh per-render context (value lookup for deltas, theme, color accessor, anomalies). */
    setContext(model: CalendarModel, colors: ColorAccessor, dark: boolean, anomalies?: Map<number, AnomalyHint>, polarity: Polarity = "neutral", locale = "en-US"): void {
        this.valueByDay.clear();
        for (const d of model.days) {
            if (!d.noData && d.value != null) this.valueByDay.set(`${d.facetKey ?? ""}|${d.date.getTime()}`, d.value);
        }
        this.valueName = model.valueName;
        this.targetName = model.targetName || "Target";
        this.colors = colors;
        this.dark = dark;
        this.anomalies = anomalies;
        this.polarity = polarity;
        this.locale = locale || "en-US";
    }

    /** ZENTRIX-BRAND — host toggles the subtle tooltip attribution on/off. */
    setBranding(on: boolean): void { this.brandingOn = on; }

    show(d: DayCell, clientX: number, clientY: number): void {
        this.el.style.background = this.dark ? "#15151E" : "#FFFFFF";
        this.el.style.color = this.dark ? "#F4F4F6" : "#1A1A22";
        const muted = this.dark ? "#8A8A99" : "#70707F";
        const strong = this.dark ? "#F4F4F6" : "#1A1A22";
        clear(this.el);

        const dateLabel = `${WEEKDAY[d.date.getDay()]} · ${d.date.toLocaleDateString(this.locale,
            { month: "short", day: "numeric", year: "numeric" })}`.toUpperCase();
        this.el.appendChild(div(`font-size:10px;letter-spacing:.5px;color:${muted}`, dateLabel));

        // Facet (Split-by) value — which small-multiple panel this cell belongs to.
        if (d.facetKey) {
            this.el.appendChild(div(`margin-top:2px;font-size:11px;font-weight:600;color:${strong}`, d.facetKey));
        }

        // Annotation note (holiday / release / incident…) — shown for any flagged day.
        if (d.annotation) {
            const note = div(`margin-top:5px;font-size:12px;font-weight:600;color:${strong};display:flex;align-items:flex-start`);
            note.appendChild(span("margin-right:5px", "📌"));
            note.appendChild(span("", d.annotation));
            this.el.appendChild(note);
        }

        if (d.noData || d.value == null) {
            this.el.appendChild(div(`margin-top:6px;font-size:13px;color:${muted}`, "No data"));
        } else {
            // Metric name with a color dot matching the hovered cell.
            const dot = this.colors ? this.colors.of(d) : "#7C5CFF";
            const metric = div("margin-top:6px;font-size:12px;display:flex;align-items:center");
            metric.appendChild(span(`width:9px;height:9px;border-radius:2px;background:${dot};` +
                "display:inline-block;margin-right:6px;border:1px solid rgba(0,0,0,.12)", ""));
            metric.appendChild(span("", this.valueName));
            this.el.appendChild(metric);

            // Big value + delta badge vs the previous calendar day ("+26 vs Mon").
            const valueRow = div("margin-top:2px;font-size:24px;font-weight:700;line-height:1.1");
            valueRow.appendChild(span("", formatNum(d.value, this.locale)));
            const prev = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate() - 1);
            const prevVal = this.valueByDay.get(`${d.facetKey ?? ""}|${prev.getTime()}`);
            if (prevVal != null && prevVal !== 0) {
                const diff = d.value - prevVal;
                const up = diff >= 0;
                valueRow.appendChild(span(
                    `margin-left:8px;font-size:12px;font-weight:600;color:${up ? UP : DOWN}`,
                    `${up ? "▲" : "▼"} ${Math.abs((diff / prevVal) * 100).toFixed(1)}%`));
                this.el.appendChild(valueRow);
                this.el.appendChild(div(`margin-top:4px;font-size:11px;color:${muted}`,
                    `${up ? "+" : ""}${formatNum(diff, this.locale)} vs ${WEEKDAY[prev.getDay()]}`));
            } else {
                this.el.appendChild(valueRow);
            }

            // Target variance — "vs <Target>: +12 (8.0% over)" when a goal is bound.
            if (d.target != null && isFinite(d.target)) {
                const diff = d.value - d.target;
                const over = diff >= 0;
                const pct = d.target !== 0 ? `${Math.abs((diff / d.target) * 100).toFixed(1)}% ${over ? "over" : "under"}` : (over ? "over" : "under");
                const row = div(`margin-top:6px;font-size:11px;color:${muted}`, `vs ${this.targetName}: `);
                row.appendChild(span(`color:${over ? UP : DOWN};font-weight:600`,
                    `${over ? "+" : ""}${formatNum(diff, this.locale)} (${pct})`));
                this.el.appendChild(row);
            }

            // Premium: flag the day if the insight engine marked it an outlier.
            // Arrow = direction (high/low); color = good/bad per the metric's polarity.
            const an = this.anomalies && this.anomalies.get(d.date.getTime());
            if (an) {
                const up = an.direction === "high";
                const isStrong = an.severity === "strong";
                const label = isStrong ? "Unusual day" : "Notable day";
                // Qualitative, not the raw z — most users can't read "17.5σ".
                const word = `${isStrong ? "far " : ""}${up ? "above" : "below"} normal`;
                let color = muted; // neutral polarity → no good/bad signal
                if (this.polarity !== "neutral") {
                    const good = this.polarity === "good" ? up : !up;
                    color = good ? UP : DOWN;
                }
                this.el.appendChild(div(
                    `margin-top:6px;font-size:11px;font-weight:600;color:${color}`,
                    `${up ? "▲" : "▼"} ${label} · ${word}`));
            }

            for (const t of d.tooltips ?? []) {
                const row = div(`margin-top:3px;font-size:11px;color:${muted}`, `${t.name}: `);
                row.appendChild(span(`color:${strong}`, t.value));
                this.el.appendChild(row);
            }
        }

        // ZENTRIX-BRAND — subtle attribution, appended after the data content so
        // it always sits at the tooltip's bottom-right. Removing this line (and
        // the import/field/setter) restores the original tooltip exactly.
        if (this.brandingOn) appendTooltipBrand(this.el, this.dark);

        this.el.style.display = "block";
        this.move(clientX, clientY);
    }

    move(clientX: number, clientY: number): void {
        const pad = 14;
        const r = this.el.getBoundingClientRect();
        let left = clientX + pad, top = clientY + pad;
        if (left + r.width > window.innerWidth) left = clientX - r.width - pad;
        if (top + r.height > window.innerHeight) top = clientY - r.height - pad;
        this.el.style.left = Math.max(2, left) + "px";
        this.el.style.top = Math.max(2, top) + "px";
    }

    hide(): void { this.el.style.display = "none"; }
}

function formatNum(n: number, locale = "en-US"): string {
    return n.toLocaleString(locale, { maximumFractionDigits: 2 });
}
function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}
function div(style: string, text?: string): HTMLDivElement {
    const d = document.createElement("div");
    d.style.cssText = style;
    if (text != null) d.textContent = text;
    return d;
}
function span(style: string, text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.style.cssText = style;
    s.textContent = text;
    return s;
}
