"use strict";

/**
 * Calendar-heatmap schema + cfg adapter for the Zentrix Settings Bar.
 *
 * The bar engine (zentrixSettingsBar.ts) is generic; THIS file is the only
 * per-visual code: it declares the category/sub/field tree using engine keys
 * and maps each key to the real formatting model + persistProperties.
 */

import type powerbi from "powerbi-visuals-api";
import { VisualFormattingSettingsModel, FONT_ITEMS } from "../settings";
import { rampForPreset } from "../render/colors";
import type { SBCategory, SBCfg, SBFont, SBPalette } from "./zentrixSettingsBar";

type Model = VisualFormattingSettingsModel;
type PersistFn = (object: string, prop: string, value: powerbi.DataViewPropertyValue) => void;

/* ───────────── shared design data ───────────── */

export const SB_FONTS: SBFont[] = FONT_ITEMS.map(i => ({ id: i.value, label: i.displayName, css: i.value }));

const PRESET_IDS = ["violet", "ocean", "forest", "magma", "viridis", "colorblind"] as const;
export const SB_PALETTES: Record<string, SBPalette> = Object.fromEntries(
    PRESET_IDS.map(p => [p, { name: p[0].toUpperCase() + p.slice(1), light: rampForPreset(p, false) }]),
);

export const SB_PRESETS = ["#15161E", "#54566B", "#8A8C9E", "#FFFFFF", "#7C5CFF", "#5A40C4", "#4DA3FF", "#118DFF",
    "#00C2A8", "#56C271", "#F2C94C", "#E59022", "#FF8A5C", "#E25C9E", "#E5484D", "#9270FF"];
export const SB_EMOJI = ["🔥", "⭐", "⚡", "🎯", "⚠️", "🚀", "💎", "✅", "📈", "🏆", "❗", "🔻"];

/* ───────────── key registry: engine key → model get/set ───────────── */

/**
 * Each engine key maps to: read from the model (`get`), persist to the host
 * (`set`), and an optimistic in-memory model write (`setLocal`). `setLocal` is
 * what makes an edit show up immediately — the panel updates the live model and
 * the visual re-renders without waiting for the async persistProperties → host
 * → update() round-trip (which is unreliable for freshly-edited objects).
 */
type Entry = { get(m: Model): unknown; set(p: PersistFn, v: unknown): void; setLocal(m: Model, v: unknown): void };

/** Resolve a dropdown item by its value (string-compared), falling back to current. */
const pickItem = (slice: any, v: unknown) =>
    (slice.items as any[]).find(i => String(i.value) === String(v)) ?? slice.value;

const dropdown = (obj: string, prop: string, ref: (m: Model) => any): Entry => ({
    get: m => ref(m).value.value, set: (p, v) => p(obj, prop, String(v)),
    setLocal: (m, v) => { ref(m).value = pickItem(ref(m), v); },
});
const bool = (obj: string, prop: string, ref: (m: Model) => any): Entry => ({
    get: m => ref(m).value, set: (p, v) => p(obj, prop, Boolean(v)),
    setLocal: (m, v) => { ref(m).value = Boolean(v); },
});
const num = (obj: string, prop: string, ref: (m: Model) => any): Entry => ({
    get: m => ref(m).value, set: (p, v) => p(obj, prop, Number(v) || 0),
    setLocal: (m, v) => { ref(m).value = Number(v) || 0; },
});
const text = (obj: string, prop: string, ref: (m: Model) => any): Entry => ({
    get: m => ref(m).value, set: (p, v) => p(obj, prop, String(v ?? "")),
    setLocal: (m, v) => { ref(m).value = String(v ?? ""); },
});
const color = (obj: string, prop: string, ref: (m: Model) => any): Entry => ({
    get: m => ref(m).value.value, set: (p, v) => p(obj, prop, { solid: { color: String(v) } } as any),
    setLocal: (m, v) => { ref(m).value = { value: String(v) }; },
});
/** A custom-color row that also switches paletteMode so the edit takes visible effect
 *  (the design's "editing a custom color makes the palette custom"). */
const colorMode = (prop: string, ref: (m: Model) => any, mode: string): Entry => ({
    get: m => ref(m).value.value,
    set: (p, v) => { p("colors", prop, { solid: { color: String(v) } } as any); p("colors", "paletteMode", mode); },
    setLocal: (m, v) => { ref(m).value = { value: String(v) }; m.colors.paletteMode.value = pickItem(m.colors.paletteMode, mode); },
});

/** All text groups share Font/Size/Bold/Italic/Underline/Color — generate their keys. */
function typeEntries(prefix: string, ref: (m: Model) => any): Record<string, Entry> {
    return {
        [`${prefix}.fontFamily`]: dropdown(prefix, "fontFamily", m => ref(m).fontFamily),
        [`${prefix}.fontSize`]: num(prefix, "fontSize", m => ref(m).fontSize),
        [`${prefix}.bold`]: bool(prefix, "bold", m => ref(m).bold),
        [`${prefix}.italic`]: bool(prefix, "italic", m => ref(m).italic),
        [`${prefix}.underline`]: bool(prefix, "underline", m => ref(m).underline),
        [`${prefix}.color`]: color(prefix, "color", m => ref(m).color),
    };
}

const KEYS: Record<string, Entry> = {
    // Data
    layout: dropdown("dataDisplay", "layout", m => m.dataDisplay.layout),
    aggregate: dropdown("dataDisplay", "aggregation", m => m.dataDisplay.aggregation),
    weekStart: dropdown("dataDisplay", "firstDayOfWeek", m => m.dataDisplay.firstDayOfWeek),
    // Color
    paletteMode: dropdown("colors", "paletteMode", m => m.colors.paletteMode),
    ramp: { // selecting a palette also activates ramp mode so it's actually used
        get: m => m.colors.ramp.value.value,
        set: (p, v) => { p("colors", "ramp", String(v)); p("colors", "paletteMode", "ramp"); },
        setLocal: (m, v) => { m.colors.ramp.value = pickItem(m.colors.ramp, v); m.colors.paletteMode.value = pickItem(m.colors.paletteMode, "ramp"); },
    },
    scale: dropdown("colors", "scaleMode", m => m.colors.scaleMode),
    buckets: dropdown("colors", "bucketCount", m => m.colors.bucketCount),
    "col.start": colorMode("startColor", m => m.colors.startColor, "duotone"),
    "col.end": colorMode("endColor", m => m.colors.endColor, "duotone"),
    "col.splitLow": colorMode("splitLow", m => m.colors.splitLow, "split"),
    "col.splitMid": colorMode("splitMid", m => m.colors.splitMid, "split"),
    "col.splitHigh": colorMode("splitHigh", m => m.colors.splitHigh, "split"),
    "col.noData": color("colors", "noDataColor", m => m.colors.noDataColor),
    // Cells
    density: num("cells", "cellSize", m => m.cells.cellSize),
    gap: num("cells", "cellGap", m => m.cells.cellGap),
    cornerRadius: num("cells", "cornerRadius", m => m.cells.cornerRadius),
    // Elements — labels
    showMonths: bool("labels", "showMonthLabels", m => m.labels.showMonthLabels),
    showWeekdays: bool("labels", "showWeekdayLabels", m => m.labels.showWeekdayLabels),
    showKpi: bool("labels", "showHeader", m => m.labels.showHeader),
    // Elements — legend (placement folds show + position)
    legendPlacement: {
        get: m => (!m.legend.show.value ? "off" : (m.legend.position.value.value === "top" ? "top" : "bottom")),
        set: (p, v) => {
            if (v === "off") { p("legend", "show", false); return; }
            p("legend", "show", true); p("legend", "position", String(v));
        },
        setLocal: (m, v) => {
            if (v === "off") { m.legend.show.value = false; return; }
            m.legend.show.value = true; m.legend.position.value = pickItem(m.legend.position, v);
        },
    },
    legendAlign: dropdown("legend", "align", m => m.legend.align),
    legendTitle: text("legend", "title", m => m.legend.title),
    legendSwatch: num("legend", "swatchSize", m => m.legend.swatchSize),
    legendGradient: num("legend", "gradientLength", m => m.legend.gradientLength),
    legendLabels: bool("legend", "showLabels", m => m.legend.showLabels),
    legendLow: text("legend", "lessLabel", m => m.legend.lessLabel),
    legendHigh: text("legend", "moreLabel", m => m.legend.moreLabel),
    legendNoData: bool("legend", "showNoData", m => m.legend.showNoData),
    legendNoDataSide: dropdown("legend", "noDataSide", m => m.legend.noDataSide),
    // Elements — header
    "header.title": text("header", "titleText", m => m.header.titleText),
    "header.align": dropdown("header", "align", m => m.header.align),
    "header.ruleShow": bool("header", "ruleShow", m => m.header.ruleShow),
    "header.ruleColor": color("header", "ruleColor", m => m.header.ruleColor),
    "header.ruleWidth": num("header", "ruleWidth", m => m.header.ruleWidth),
    // Elements — badges
    "badge.peakOn": bool("badges", "peakOn", m => m.badges.peakOn),
    "badge.peakEmoji": text("badges", "peakEmoji", m => m.badges.peakEmoji),
    "badge.thresholdOn": bool("badges", "thresholdOn", m => m.badges.thresholdOn),
    "badge.thresholdValue": num("badges", "thresholdValue", m => m.badges.thresholdValue),
    "badge.thresholdEmoji": text("badges", "thresholdEmoji", m => m.badges.thresholdEmoji),
    // Text groups
    ...typeEntries("facetTitle", m => m.facetTitle),
    ...typeEntries("headline", m => m.headline),
    ...typeEntries("statChips", m => m.statChips),
    ...typeEntries("monthRail", m => m.monthRail),
    ...typeEntries("weekdayRail", m => m.weekdayRail),
    ...typeEntries("yearTags", m => m.yearTags),
    ...typeEntries("legendText", m => m.legendText),
    // Accessibility
    "a11y.focusRing": bool("accessibility", "focusRing", m => m.accessibility.focusRing),
    "a11y.pattern": bool("accessibility", "patternOnThreshold", m => m.accessibility.patternOnThreshold),
    "a11y.patternThreshold": num("accessibility", "patternThresholdValue", m => m.accessibility.patternThresholdValue),
};

/** Apply an engine-key value onto a model in place (used to replay pending edits). */
export function applyLocal(m: Model, key: string, value: unknown): void { KEYS[key]?.setLocal(m, value); }
/** Read the current engine-key value from a model (used to detect host confirmation). */
export function readLocal(m: Model, key: string): unknown { return KEYS[key]?.get(m); }

/**
 * Build the SBCfg adapter bound to a live model getter + a persist callback.
 * `onChange(key, value)` (optional) fires after each edit so the caller can both
 * record the optimistic edit and trigger an immediate re-render.
 */
export function makeCfg(getModel: () => Model, persist: PersistFn, onChange?: (key: string, value: unknown) => void): SBCfg {
    return {
        get(key: string): unknown { const e = KEYS[key]; return e ? e.get(getModel()) : undefined; },
        set(key: string, value: unknown): void {
            const e = KEYS[key]; if (!e) return;
            e.setLocal(getModel(), value);   // optimistic: edit shows up now, not after the host round-trip
            e.set(persist, value);           // durable: survives reloads / report save
            onChange?.(key, value);
        },
    };
}

/* ───────────── the category / sub / field schema ───────────── */

/** A type-style detail pane (Font · Size · B/I/U · Color) for a text group. */
const typeFields = (prefix: string) => ([
    { control: "font" as const, label: "Font", key: `${prefix}.fontFamily` },
    { control: "stepper" as const, label: "Size", key: `${prefix}.fontSize`, min: 8, max: 72, suffix: "px" },
    { control: "multiSeg" as const, label: "Style", keys: [`${prefix}.bold`, `${prefix}.italic`, `${prefix}.underline`], glyphs: ["B", "I", "U"] },
    { control: "color" as const, label: "Color", key: `${prefix}.color` },
]);

export const SB_CATS: SBCategory[] = [
    { id: "data", name: "Data", subs: [
        { id: "layout", name: "Layout", info: "Arrange the calendar as one continuous year grid or as separate month blocks.", kind: "menu", key: "layout", options: [["continuous", "Year"], ["month", "Months"]] },
        { id: "aggregate", name: "Aggregate", info: "Choose how multiple values that fall on the same day are combined into a single number.", kind: "menu", key: "aggregate", options: [["sum", "Sum"], ["avg", "Average"], ["min", "Min"], ["max", "Max"], ["count", "Count"]] },
        { id: "week", name: "Week start", info: "Set which weekday each column starts on — Sunday or Monday.", kind: "menu", key: "weekStart", options: [["0", "Sun"], ["1", "Mon"]] },
    ] },
    { id: "color", name: "Color", subs: [
        { id: "palette", name: "Palette", info: "Pick a built-in color scheme for the heatmap cells.", kind: "swatch", key: "ramp", swatches: [...PRESET_IDS] },
        { id: "scale", name: "Scale", info: "Control how values map to colors: quantile spreads colors by rank, linear by value, log compresses large ranges.", kind: "menu", key: "scale", options: [["quantile", "Quantile"], ["linear", "Linear"], ["log", "Log"]] },
        { id: "buckets", name: "Buckets", info: "Group values into a fixed number of discrete color steps, or keep a continuous gradient.", kind: "menu", key: "buckets", options: [["0", "Continuous"], ["3", "3"], ["5", "5"], ["7", "7"]] },
        { id: "custom", name: "Custom colors", info: "Override individual colors to build your own duotone or split palette, plus the no-data color.", kind: "fields", width: 282, fields: [
            { control: "color", label: "Start / hue", key: "col.start" },
            { control: "color", label: "End", key: "col.end" },
            { control: "color", label: "Split low", key: "col.splitLow" },
            { control: "color", label: "Split mid", key: "col.splitMid" },
            { control: "color", label: "Split high", key: "col.splitHigh" },
            { control: "color", label: "No-data", key: "col.noData" },
        ] },
    ] },
    { id: "cells", name: "Cells", subs: [
        { id: "density", name: "Density", info: "Set how large each day cell is drawn.", kind: "menu", key: "density", options: [[10, "Compact"], [16, "Cozy"], [22, "Roomy"]] },
        { id: "gaps", name: "Gaps", info: "Set the spacing between adjacent day cells.", kind: "menu", key: "gap", options: [[1, "Tight"], [3, "Normal"], [6, "Wide"]] },
        { id: "radius", name: "Corner radius", info: "Round the corners of each day cell, from sharp squares to soft rounded tiles.", kind: "fields", width: 240, fields: [
            { control: "stepper", label: "Corner radius", key: "cornerRadius", min: 0, max: 12, suffix: "px" },
        ] },
    ] },
    { id: "elements", name: "Elements", subs: [
        { id: "labels", name: "Labels", info: "Show or hide the month names, weekday names, and the KPI header above the grid.", kind: "fields", width: 220, fields: [
            { control: "switch", label: "Months", key: "showMonths" },
            { control: "switch", label: "Weekdays", key: "showWeekdays" },
            { control: "switch", label: "KPI header", key: "showKpi" },
        ] },
        { id: "legend", name: "Legend", info: "Configure the color legend — placement, alignment, title, swatch sizing, labels, and the no-data swatch.", kind: "fields", width: 282, fields: [
            { control: "segText", label: "Placement", key: "legendPlacement", options: [["off", "Off"], ["bottom", "Bottom"], ["top", "Top"]] },
            { control: "segIcon", label: "Align", key: "legendAlign", iconOptions: [["start", "left"], ["center", "center"], ["end", "right"]] },
            { control: "text", label: "Title", key: "legendTitle", placeholder: "(none)" },
            { control: "stepper", label: "Swatch size", key: "legendSwatch", min: 6, max: 30, suffix: "px" },
            { control: "stepper", label: "Gradient length", key: "legendGradient", min: 40, max: 320, step: 10, suffix: "px" },
            { control: "divider" },
            { control: "switch", label: "Low / high labels", key: "legendLabels" },
            { control: "text", label: "Low label", key: "legendLow", placeholder: "Less" },
            { control: "text", label: "High label", key: "legendHigh", placeholder: "More" },
            { control: "switch", label: "No-data swatch", key: "legendNoData" },
            { control: "segText", label: "No-data side", key: "legendNoDataSide", options: [["left", "Left"], ["right", "Right"]] },
        ] },
        { id: "header", name: "Header", info: "Configure the header title text, its alignment, and the accent rule drawn beneath it.", kind: "fields", width: 282, fields: [
            { control: "text", label: "Title", key: "header.title", placeholder: "(field name)" },
            { control: "segIcon", label: "Align", key: "header.align", iconOptions: [["left", "left"], ["center", "center"], ["right", "right"]] },
            { control: "switch", label: "Accent rule", key: "header.ruleShow" },
            { control: "color", label: "Rule color", key: "header.ruleColor" },
            { control: "stepper", label: "Rule width", key: "header.ruleWidth", min: 1, max: 12, suffix: "px" },
        ] },
        { id: "badges", name: "Badges", info: "Mark notable days with an emoji — the peak day and any day at or above a threshold value.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Mark peak", key: "badge.peakOn" },
            { control: "emoji", label: "Peak emoji", key: "badge.peakEmoji" },
            { control: "divider" },
            { control: "switch", label: "Mark threshold", key: "badge.thresholdOn" },
            { control: "stepper", label: "Threshold ≥", key: "badge.thresholdValue", min: 0, max: 200, step: 5 },
            { control: "emoji", label: "Threshold emoji", key: "badge.thresholdEmoji" },
        ] },
    ] },
    { id: "text", name: "Text", subs: [
        { id: "facettitle", name: "Facet titles", info: "Font, size, style, and color of the small-multiples facet titles.", kind: "fields", width: 282, fields: typeFields("facetTitle") },
        { id: "headline", name: "Headline", info: "Font, size, style, and color of the headline text.", kind: "fields", width: 282, fields: typeFields("headline") },
        { id: "stats", name: "Stats", info: "Font, size, style, and color of the stat chips.", kind: "fields", width: 282, fields: typeFields("statChips") },
        { id: "months", name: "Months", info: "Font, size, style, and color of the month labels.", kind: "fields", width: 282, fields: typeFields("monthRail") },
        { id: "weekdays", name: "Weekdays", info: "Font, size, style, and color of the weekday labels.", kind: "fields", width: 282, fields: typeFields("weekdayRail") },
        { id: "years", name: "Years", info: "Font, size, style, and color of the year tags.", kind: "fields", width: 282, fields: typeFields("yearTags") },
        { id: "legendtext", name: "Legend text", info: "Font, size, style, and color of the legend labels.", kind: "fields", width: 282, fields: typeFields("legendText") },
    ] },
    { id: "access", name: "Accessibility", flat: true, subs: [
        { id: "a11y", name: "Accessibility", info: "Improve accessibility — show a keyboard focus ring and add CVD-safe hatch patterns to cells at or above a threshold value.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Focus ring", key: "a11y.focusRing" },
            { control: "switch", label: "Pattern on threshold", key: "a11y.pattern" },
            { control: "stepper", label: "Pattern threshold ≥", key: "a11y.patternThreshold", min: 0, max: 10000, step: 1 },
        ] },
    ] },
];
