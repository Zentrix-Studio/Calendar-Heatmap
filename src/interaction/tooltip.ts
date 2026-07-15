"use strict";

import { CalendarModel, DayCell, AggregationMode } from "../types";
import { ColorAccessor } from "../render/colors";
import { appendTooltipBrand } from "../branding/zentrixBrand"; // ZENTRIX-BRAND
import { fontFamily, posSafe, negSafe, accent, resolveSurface } from "../theme/zentrixTokens";
import { buildValueByDay, dayKey, dateLabel, dayOverDay, targetVariance, metricLabel, formatNum, clear, div, span } from "./dayData";

const FONT = fontFamily;
// Up/over/gain vs down/under/loss — CVD-safe Okabe-Ito pair (Z-148, replaces the
// legacy raw green/red #2EA043/#E5484D). Sourced from the token mirror, not inline.
const UP = posSafe, DOWN = negSafe;

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
    private aggMode: AggregationMode = "sum";
    private targetName = "Target";
    private colors: ColorAccessor | null = null;
    private dark = false;
    private anomalies?: Map<number, AnomalyHint>;
    private polarity: Polarity = "neutral";
    // Z-146 — matched rule name per `${facetKey}|${epoch}`, so a badge isn't a mystery emoji.
    private ruleNameByDay = new Map<string, string>();
    // Z-152 — author-written annotation text per `${facetKey}|${epoch}`. Sourced
    // from the persisted note store, not from a bound column.
    private noteByDay = new Map<string, string>();
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
    setContext(model: CalendarModel, colors: ColorAccessor, dark: boolean, anomalies?: Map<number, AnomalyHint>, polarity: Polarity = "neutral"): void {
        this.valueByDay = buildValueByDay(model);
        this.valueName = model.valueName;
        this.aggMode = model.aggMode;
        this.targetName = model.targetName || "Target";
        this.colors = colors;
        this.dark = dark;
        this.anomalies = anomalies;
        this.polarity = polarity;
    }

    /** Z-146 — matched rule names keyed by `${facetKey}|${epoch}`. */
    setRuleNames(map: Map<string, string>): void { this.ruleNameByDay = map; }

    /** Z-152 — author-written annotation text keyed by `${facetKey}|${epoch}`. */
    setNotes(map: Map<string, string>): void { this.noteByDay = map; }

    /** ZENTRIX-BRAND — host toggles the subtle tooltip attribution on/off. */
    setBranding(on: boolean): void { this.brandingOn = on; }

    show(d: DayCell, clientX: number, clientY: number): void {
        // Surface colors resolve from the token mirror (Z-148) — no raw hex.
        const theme = resolveSurface(this.dark);
        this.el.style.background = theme.bg;
        this.el.style.color = theme.fg;
        const muted = theme.muted;
        const strong = theme.strong;
        clear(this.el);

        this.el.appendChild(div(`font-size:10px;letter-spacing:.5px;color:${muted}`, dateLabel(d.date)));

        // Facet (Split-by) value — which small-multiple panel this cell belongs to.
        if (d.facetKey) {
            this.el.appendChild(div(`margin-top:2px;font-size:11px;font-weight:600;color:${strong}`, d.facetKey));
        }

        // Author-written annotation (Z-152) — this is how a Marker-only note reads
        // its text: the callout isn't drawn, so hover is the reveal.
        const noteText = this.noteByDay.get(dayKey(d));
        if (noteText) {
            const note = div(`margin-top:5px;font-size:12px;font-weight:600;color:${strong};display:flex;align-items:flex-start`);
            note.appendChild(span("margin-right:5px", "📌"));
            note.appendChild(span("", noteText));
            this.el.appendChild(note);
        }

        // Matched rule name (Z-146) — so the badge emoji isn't a mystery.
        const ruleName = this.ruleNameByDay.get(dayKey(d));
        if (ruleName) {
            this.el.appendChild(div(`margin-top:5px;font-size:11px;font-weight:600;color:${strong}`, ruleName));
        }

        if (d.noData || d.value == null) {
            this.el.appendChild(div(`margin-top:6px;font-size:13px;color:${muted}`, "No data"));
        } else {
            // Metric name with a color dot matching the hovered cell.
            const dot = this.colors ? this.colors.of(d) : accent;
            const metric = div("margin-top:6px;font-size:12px;display:flex;align-items:center");
            metric.appendChild(span(`width:9px;height:9px;border-radius:2px;background:${dot};` +
                "display:inline-block;margin-right:6px;border:1px solid rgba(0,0,0,.12)", ""));
            // Count is a row count, not the field's magnitude — relabel it so the big
            // number doesn't read as a sum of the metric (issue #4).
            metric.appendChild(span("", metricLabel(this.valueName, this.aggMode)));
            this.el.appendChild(metric);

            // Big value + delta badge vs the previous calendar day ("+26 vs Mon").
            const valueRow = div("margin-top:2px;font-size:24px;font-weight:700;line-height:1.1");
            valueRow.appendChild(span("", formatNum(d.value)));
            const dod = dayOverDay(d, this.valueByDay);
            if (dod) {
                valueRow.appendChild(span(
                    `margin-left:8px;font-size:12px;font-weight:600;color:${dod.up ? UP : DOWN}`,
                    `${dod.up ? "▲" : "▼"} ${dod.pct}%`));
                this.el.appendChild(valueRow);
                this.el.appendChild(div(`margin-top:4px;font-size:11px;color:${muted}`,
                    `${dod.up ? "+" : ""}${dod.diff} vs ${dod.prevWeekday}`));
            } else {
                this.el.appendChild(valueRow);
            }

            // Target variance — "vs <Target>: +12 (8.0% over)" when a goal is bound.
            // Suppressed under Count: comparing a per-day row count to a summed target
            // is meaningless and misled SLA-style reports (issue #4).
            const variance = this.aggMode === "count" ? null : targetVariance(d);
            if (variance) {
                const row = div(`margin-top:6px;font-size:11px;color:${muted}`, `vs ${this.targetName}: `);
                row.appendChild(span(`color:${variance.over ? UP : DOWN};font-weight:600`,
                    `${variance.over ? "+" : ""}${formatNum(variance.diff)} (${variance.label})`));
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

