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
import { VERSION } from "../version";
import { rampForPreset } from "../render/colors";
import type { SBCategory, SBCfg, SBField, SBFont, SBPalette } from "./zentrixSettingsBar";

type Model = VisualFormattingSettingsModel;
type PersistFn = (object: string, prop: string, value: powerbi.DataViewPropertyValue) => void;
/** One property write inside a single logical edit. */
export type PersistWrite = { object: string; prop: string; value: powerbi.DataViewPropertyValue };
/** Flush all writes from one `cfg.set` as ONE persistProperties call. Multiple
 *  synchronous persistProperties calls are coalesced by the Power BI host (last
 *  write wins), which silently dropped the earlier property of any two-write
 *  edit — e.g. a custom color (colour + paletteMode) reverting on refresh. */
export type PersistBatch = (writes: PersistWrite[]) => void;

/* ───────────── shared design data ───────────── */

export const SB_FONTS: SBFont[] = FONT_ITEMS.map(i => ({ id: i.value, label: i.displayName, css: i.value }));

const PRESET_IDS = ["violet", "ocean", "forest", "magma", "viridis", "colorblind"] as const;
export const SB_PALETTES: Record<string, SBPalette> = Object.fromEntries(
    PRESET_IDS.map(p => [p, { name: p[0].toUpperCase() + p.slice(1), light: rampForPreset(p, false) }]),
);

export const SB_PRESETS = ["#15161E", "#54566B", "#8A8C9E", "#FFFFFF", "#7C5CFF", "#5A40C4", "#4DA3FF", "#118DFF",
    "#00C2A8", "#56C271", "#F2C94C", "#E59022", "#FF8A5C", "#E25C9E", "#E5484D", "#9270FF"];
export const SB_EMOJI = ["🔥", "⭐", "⚡", "🎯", "⚠️", "🚀", "💎", "✅", "📈", "🏆", "❗", "🔻"];

/* ───────────── shared option lists (mirror native settings.ts labels) ───────────── */

/** Rule operators (Z-146) — labels mirror `RULE_OPERATOR_ITEMS` in settings.ts. */
const RULE_OPERATOR_OPTS: [string, string][] = [
    [">=", "≥"], [">", ">"], ["<=", "≤"], ["<", "<"], ["==", "="], ["between", "between"],
];
/** Rule compare-to (Z-146) — mirror `RULE_COMPARE_ITEMS`. */
const RULE_COMPARE_OPTS: [string, string][] = [["value", "Value"], ["target", "Value − Target"]];
/** Core-5 pattern styles (Z-149) — mirror `PATTERN_STYLE_ITEMS`. */
const PATTERN_STYLE_OPTS: [string, string][] = [
    ["diagonal", "Diagonal lines"], ["dots", "Dots"], ["crosshatch", "Crosshatch"], ["grid", "Grid"], ["stars", "Stars"],
];
/** Annotation marker style (Z-152) — mirror `AnnotationsCard.markerStyle`. */
const MARKER_STYLE_OPTS: [string, string][] = [["number", "1,2,3"], ["dot", "Dot"], ["icon", "Icon"]];
/** Annotation display mode (Z-152) — mirror `AnnotationsCard.defaultMode` / `NoteMode`. */
const NOTE_MODE_OPTS: [string, string][] = [
    ["marker", "Marker"], ["text", "Text"], ["arrow", "Text + arrow"], ["all", "All"],
];
/** Day-detail panel position (Z-145) — mirror `DayDetailCard.position`. */
const DAY_DETAIL_POSITION_OPTS: [string, string][] = [["auto", "Auto"], ["right", "Right"], ["bottom", "Bottom"]];

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
 *  (the design's "editing a custom color makes the palette custom").
 *
 *  Persistence rule (CB-persist2): the Power BI host DROPS a `fill` property that
 *  shares a persistProperties call with any other property — it only stores a fill
 *  persisted ALONE (the native Format pane works precisely because it persists one
 *  slice at a time). So we persist paletteMode ONLY when it actually changes; when
 *  the palette is already in `mode` (the common "tweak the colour" case) the colour
 *  goes out by itself and survives a reload. `setLocal` runs before `set` (makeCfg),
 *  so the flag it sets is current when `set` reads it. */
const colorMode = (prop: string, ref: (m: Model) => any, mode: string): Entry => {
    let modeChanged = false;
    return {
        get: m => ref(m).value.value,
        set: (p, v) => {
            p("colors", prop, { solid: { color: String(v) } } as any);
            if (modeChanged) p("colors", "paletteMode", mode);   // bundle only when unavoidable
        },
        setLocal: (m, v) => {
            modeChanged = String(m.colors.paletteMode.value.value) !== mode;
            ref(m).value = { value: String(v) };
            m.colors.paletteMode.value = pickItem(m.colors.paletteMode, mode);
        },
    };
};
/** The Start/hue row is mode-aware (QA-D4): in mono/theme it is the single hue and the
 *  edit must NOT kick the palette into duotone (that made mono unreachable); anywhere
 *  else it keeps the original "editing start begins a duotone" behavior. `setLocal`
 *  always runs before `set` (makeCfg), so the persisted mode matches the local one.
 *  Persists paletteMode only on an actual mode change (CB-persist2 — see colorMode). */
const startColorEntry = (): Entry => {
    let lastMode = "duotone";
    let modeChanged = false;
    return {
        get: m => m.colors.startColor.value.value,
        set: (p, v) => {
            p("colors", "startColor", { solid: { color: String(v) } } as any);
            if (modeChanged) p("colors", "paletteMode", lastMode);
        },
        setLocal: (m, v) => {
            const cur = String(m.colors.paletteMode.value.value);
            lastMode = cur === "mono" || cur === "theme" ? "mono" : "duotone";
            modeChanged = cur !== lastMode;
            m.colors.startColor.value = { value: String(v) };
            m.colors.paletteMode.value = pickItem(m.colors.paletteMode, lastMode);
        },
    };
};

/** One rules-engine slot (Z-146) — mirrors the native `RuleSlot` props 1:1:
 *  enable · name · operator · value · value2 · compareTo · badge · color · pattern · patternStyle.
 *  The `badges` object holds all three slots' properties (rule{n}*). */
function ruleEntries(n: 1 | 2 | 3): Record<string, Entry> {
    const r = (m: Model) => (m.badges as any)[`rule${n}`];
    return {
        [`rule${n}.on`]: bool("badges", `rule${n}On`, m => r(m).on),
        [`rule${n}.name`]: text("badges", `rule${n}Name`, m => r(m).ruleName),
        [`rule${n}.operator`]: dropdown("badges", `rule${n}Operator`, m => r(m).operator),
        [`rule${n}.value`]: num("badges", `rule${n}Value`, m => r(m).value),
        [`rule${n}.value2`]: num("badges", `rule${n}Value2`, m => r(m).value2),
        [`rule${n}.compareTo`]: dropdown("badges", `rule${n}CompareTo`, m => r(m).compareTo),
        [`rule${n}.badge`]: text("badges", `rule${n}Badge`, m => r(m).badge),
        [`rule${n}.color`]: color("badges", `rule${n}Color`, m => r(m).color),
        [`rule${n}.pattern`]: bool("badges", `rule${n}Pattern`, m => r(m).pattern),
        [`rule${n}.patternStyle`]: dropdown("badges", `rule${n}PatternStyle`, m => r(m).patternStyle),
    };
}

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
    // Time intelligence — surfaced in the gear (the Format-pane card is hidden), so
    // fiscal year stays reachable from the visual's own settings.
    fiscalStart: dropdown("timeIntel", "fiscalStart", m => m.timeIntel.fiscalStart),
    fiscalDisplay: bool("timeIntel", "fiscalDisplay", m => m.timeIntel.fiscalDisplay),
    // Color
    paletteMode: dropdown("colors", "paletteMode", m => m.colors.paletteMode),
    ramp: { // selecting a palette also activates ramp mode so it's actually used.
        // Z-137 §1: the swatch only reads as active while ramp mode is live — after a
        // custom edit flips paletteMode to split/duotone, no built-in ramp is active
        // (else the Palette row would contradict the recolored grid).
        get: m => (m.colors.paletteMode.value.value === "ramp" ? m.colors.ramp.value.value : ""),
        set: (p, v) => { p("colors", "ramp", String(v)); p("colors", "paletteMode", "ramp"); },
        setLocal: (m, v) => { m.colors.ramp.value = pickItem(m.colors.ramp, v); m.colors.paletteMode.value = pickItem(m.colors.paletteMode, "ramp"); },
    },
    scale: dropdown("colors", "scaleMode", m => m.colors.scaleMode),
    buckets: dropdown("colors", "bucketCount", m => m.colors.bucketCount),
    "col.start": startColorEntry(),
    "col.end": colorMode("endColor", m => m.colors.endColor, "duotone"),
    "col.splitLow": colorMode("splitLow", m => m.colors.splitLow, "split"),
    "col.splitMid": colorMode("splitMid", m => m.colors.splitMid, "split"),
    "col.splitHigh": colorMode("splitHigh", m => m.colors.splitHigh, "split"),
    "col.noData": color("colors", "noDataColor", m => m.colors.noDataColor),
    // Cells
    density: num("cells", "cellSize", m => m.cells.cellSize),
    cellGapX: num("cells", "cellGapX", m => m.cells.cellGapX),
    cellGapY: num("cells", "cellGapY", m => m.cells.cellGapY),
    cornerRadius: num("cells", "cornerRadius", m => m.cells.cornerRadius),
    // Elements — labels
    showMonths: bool("labels", "showMonthLabels", m => m.labels.showMonthLabels),
    showWeekdays: bool("labels", "showWeekdayLabels", m => m.labels.showWeekdayLabels),
    showKpi: bool("labels", "showHeader", m => m.labels.showHeader),
    showWeekNums: bool("labels", "showWeekNumbers", m => m.labels.showWeekNumbers),
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
    // Elements — badges (peak + legacy single threshold, preserved for back-compat)
    "badge.peakOn": bool("badges", "peakOn", m => m.badges.peakOn),
    "badge.peakEmoji": text("badges", "peakEmoji", m => m.badges.peakEmoji),
    "badge.thresholdOn": bool("badges", "thresholdOn", m => m.badges.thresholdOn),
    "badge.thresholdValue": num("badges", "thresholdValue", m => m.badges.thresholdValue),
    "badge.thresholdEmoji": text("badges", "thresholdEmoji", m => m.badges.thresholdEmoji),
    // Elements — rules engine (Z-146): 3 slots, each mirroring the native RuleSlot 1:1.
    ...ruleEntries(1),
    ...ruleEntries(2),
    ...ruleEntries(3),
    // Summary table — the full-screen alternate view (calendar XOR table; the
    // bottom-right ViewToggle flips between them while this is on).
    "summaryTable.show": bool("summaryTable", "show", m => m.summaryTable.show),
    // Day detail panel (Z-145)
    "dayDetail.enabled": bool("dayDetail", "enabled", m => m.dayDetail.enabled),
    "dayDetail.position": dropdown("dayDetail", "position", m => m.dayDetail.position),
    "dayDetail.topContributor": bool("dayDetail", "showTopContributor", m => m.dayDetail.showTopContributor),
    // Annotations (Z-152) — display prefs only. The notes themselves are NOT a
    // formatting-model setting; they live in the hidden `notesStore.data` blob
    // (notes/store.ts) and are edited through the note editor, not the gear.
    "annotation.show": bool("annotations", "show", m => m.annotations.show),
    "annotation.markerStyle": dropdown("annotations", "markerStyle", m => m.annotations.markerStyle),
    "annotation.markerIcon": text("annotations", "markerIcon", m => m.annotations.markerIcon),
    "annotation.markerColor": color("annotations", "markerColor", m => m.annotations.markerColor),
    "annotation.defaultMode": dropdown("annotations", "defaultMode", m => m.annotations.defaultMode),
    // Insights (QA-D1) — the automatic insight lines above the grid.
    "insights.show": bool("insights", "show", m => m.insights.show),
    "insights.polarity": dropdown("insights", "polarity", m => m.insights.polarity),
    "insights.count": num("insights", "count", m => m.insights.count),
    // Small multiples (QA-D2) — active when a Split-by category is bound.
    "facets.columns": num("smallMultiples", "columns", m => m.smallMultiples.columns),
    "facets.sharedScale": bool("smallMultiples", "sharedScale", m => m.smallMultiples.sharedScale),
    // Text groups
    ...typeEntries("headline", m => m.headline),
    ...typeEntries("statChips", m => m.statChips),
    ...typeEntries("monthRail", m => m.monthRail),
    ...typeEntries("weekdayRail", m => m.weekdayRail),
    ...typeEntries("yearTags", m => m.yearTags),
    ...typeEntries("legendText", m => m.legendText),
    ...typeEntries("facetTitle", m => m.facetTitle), // QA-D3
    // Accessibility
    "a11y.focusRing": bool("accessibility", "focusRing", m => m.accessibility.focusRing),
    "a11y.pattern": bool("accessibility", "patternOnThreshold", m => m.accessibility.patternOnThreshold),
    "a11y.patternThreshold": num("accessibility", "patternThresholdValue", m => m.accessibility.patternThresholdValue),
    "a11y.patternStyle": dropdown("accessibility", "patternStyle", m => m.accessibility.patternStyle),
};

/** Apply an engine-key value onto a model in place (used to replay pending edits). */
export function applyLocal(m: Model, key: string, value: unknown): void { KEYS[key]?.setLocal(m, value); }
/**
 * Every capabilities object name reachable through the gear, derived by replaying
 * each KEYS entry's persist call against a recorder. Drives the reverse-reachability
 * guard in settingsSchemaParity.test.ts: a card in the model that is neither in
 * PANE_CARDS nor returned here is an ORPHAN — it persists and renders but no user
 * can ever change it (the D1–D4 class of defect, found live in the 2026-07-14 QA run).
 */
export function gearObjectNames(): Set<string> {
    const m = new VisualFormattingSettingsModel();
    const out = new Set<string>();
    const rec: PersistFn = object => { out.add(object); };
    for (const k of Object.keys(KEYS)) {
        const e = KEYS[k];
        try { e.set(rec, e.get(m)); } catch { /* recording only — a throw just skips the key */ }
    }
    return out;
}
/** Read the current engine-key value from a model (used to detect host confirmation). */
export function readLocal(m: Model, key: string): unknown { return KEYS[key]?.get(m); }

/**
 * Build the SBCfg adapter bound to a live model getter + a persist callback.
 * `onChange(key, value)` (optional) fires after each edit so the caller can both
 * record the optimistic edit and trigger an immediate re-render.
 */
export function makeCfg(
    getModel: () => Model, persist: PersistBatch,
    onChange?: (key: string, value: unknown) => void, reset?: () => void,
): SBCfg {
    return {
        get(key: string): unknown { const e = KEYS[key]; return e ? e.get(getModel()) : undefined; },
        set(key: string, value: unknown): void {
            const e = KEYS[key]; if (!e) return;
            e.setLocal(getModel(), value);   // optimistic: edit shows up now, not after the host round-trip
            // Buffer every property this edit persists and flush as ONE call. An
            // entry may write >1 property (a custom colour also sets paletteMode);
            // firing them as separate persistProperties calls lets the host's
            // last-write-wins coalescing drop all but the last, so the colour
            // reverted to default on refresh. One merge keeps them atomic.
            const writes: PersistWrite[] = [];
            e.set((object, prop, v) => writes.push({ object, prop, value: v }), value);
            if (writes.length) persist(writes);   // durable: survives reloads / report save
            onChange?.(key, value);
        },
        reset,
    };
}

/* ───────────── the category / sub / field schema ───────────── */

/** One rules-engine slot (Z-146) as detail-pane fields — mirrors the native
 *  `RuleSlot` slices 1:1, with the same visibleIf gating as `DayBadgesCard.onPreProcess`:
 *  every sub-field hidden unless the rule is on; `value2` only when operator = between;
 *  `pattern style` only when this rule's pattern toggle is on. */
/** Operator → symbol, mirroring RULE_OPERATOR_OPTS, for the live rule summary. */
const RULE_OP_SYMBOL: Record<string, string> = {
    ">=": "≥", ">": ">", "<=": "≤", "<": "<", "==": "=", "between": "between",
};

/**
 * Live one-line summary for a rule's toggle (issue #6) — replaces the vague
 * "Rule 1/2/3" with the rule's friendly name and, when enabled, its current
 * condition, e.g. "Good day · ≥ 100" or "Target breach · between 5–10 vs target".
 * Off → just the name so authors still know what the slot is for.
 */
function ruleSummaryLabel(n: 1 | 2 | 3, g: (k: string) => unknown, defaultName: string): string {
    const name = String(g(`rule${n}.name`) ?? "").trim() || defaultName;
    if (!g(`rule${n}.on`)) return name;
    const op = String(g(`rule${n}.operator`) ?? ">=");
    const v = g(`rule${n}.value`);
    const cond = op === "between" ? `${v}–${g(`rule${n}.value2`)}` : `${RULE_OP_SYMBOL[op] ?? op} ${v}`;
    const cmp = String(g(`rule${n}.compareTo`)) === "target" ? " vs target" : "";
    return `${name} · ${cond}${cmp}`;
}

const ruleFields = (n: 1 | 2 | 3, defaultName: string): SBField[] => {
    const on = (g: (k: string) => unknown) => Boolean(g(`rule${n}.on`));
    return [
        { control: "switch", label: `Rule ${n}`, key: `rule${n}.on`, labelFn: g => ruleSummaryLabel(n, g, defaultName) },
        { control: "text", label: "Name", key: `rule${n}.name`, placeholder: defaultName, visibleIf: on },
        { control: "segText", label: "Operator", key: `rule${n}.operator`, options: RULE_OPERATOR_OPTS, visibleIf: on },
        { control: "stepper", label: "Value", key: `rule${n}.value`, min: -1e9, max: 1e9, visibleIf: on },
        { control: "stepper", label: "and", key: `rule${n}.value2`, min: -1e9, max: 1e9, visibleIf: g => on(g) && String(g(`rule${n}.operator`)) === "between" },
        { control: "segText", label: "Compare", key: `rule${n}.compareTo`, options: RULE_COMPARE_OPTS, visibleIf: on },
        { control: "emoji", label: "Badge", key: `rule${n}.badge`, visibleIf: on },
        { control: "color", label: "Color", key: `rule${n}.color`, visibleIf: on },
        { control: "switch", label: "CVD hatch", key: `rule${n}.pattern`, visibleIf: on },
        { control: "segText", label: "Pattern style", key: `rule${n}.patternStyle`, options: PATTERN_STYLE_OPTS, visibleIf: g => on(g) && Boolean(g(`rule${n}.pattern`)) },
    ];
};

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
        { id: "fiscal", name: "Fiscal year", info: "Month the fiscal year starts on. Shifts the year-over-year insight, and — with Fiscal layout on — also starts the calendar's year bands on this month.", kind: "menu", key: "fiscalStart", options: [["1", "Jan"], ["2", "Feb"], ["3", "Mar"], ["4", "Apr"], ["5", "May"], ["6", "Jun"], ["7", "Jul"], ["8", "Aug"], ["9", "Sep"], ["10", "Oct"], ["11", "Nov"], ["12", "Dec"]] },
        { id: "fiscallayout", name: "Fiscal layout", info: "Lay the calendar out by fiscal year: year bands start on the fiscal start month and are labeled FY (numbered by the year the fiscal year ends in). Applies to the continuous layout.", kind: "fields", width: 250, fields: [
            { control: "switch", label: "Fiscal year layout", key: "fiscalDisplay" },
        ] },
        { id: "facets", name: "Small multiples", info: "Applies when a Split-by category is bound: how many panel columns to lay out (0 = automatic), and whether every panel shares one color scale so colors compare across panels.", kind: "fields", width: 260, fields: [
            { control: "stepper", label: "Columns (0 = auto)", key: "facets.columns", min: 0, max: 8 },
            { control: "switch", label: "Shared color scale", key: "facets.sharedScale" },
        ] },
    ] },
    { id: "color", name: "Color", subs: [
        { id: "palette", name: "Palette", info: "Pick a built-in color scheme for the heatmap cells.", kind: "swatch", key: "ramp", swatches: [...PRESET_IDS] },
        { id: "scale", name: "Scale", info: "Control how values map to colors: quantile spreads colors by rank, linear by value, log compresses large ranges.", kind: "menu", key: "scale", options: [["quantile", "Quantile"], ["linear", "Linear"], ["log", "Log"]] },
        { id: "buckets", name: "Buckets", info: "Group values into a fixed number of discrete color steps, or keep a continuous gradient.", kind: "menu", key: "buckets", options: [["0", "Continuous"], ["3", "3"], ["5", "5"], ["7", "7"]] },
        { id: "custom", name: "Custom colors", info: "Override individual colors to build your own duotone (Start/End) or diverging split (low/mid/high) palette. Editing any of these switches the palette to your custom colors. Mode picks how cell colors are produced — Mono tints a single hue, Theme tints the report theme's accent. Plus the no-data color.", kind: "fields", width: 282, fields: [
            { control: "heading", label: "Edits here build your own palette" },
            // QA-D4 — the explicit mode row is what makes mono/theme reachable at all;
            // the implicit switches (edit Start/End → duotone, edit Split → split,
            // pick a Palette swatch → ramp) still work exactly as before.
            { control: "segText", label: "Mode", key: "paletteMode", options: [["ramp", "Ramp"], ["mono", "Mono"], ["duotone", "Duo"], ["split", "Split"], ["theme", "Theme"]] },
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
        { id: "gaps", name: "Gaps", info: "Set the spacing between day cells — independently for rows (vertical) and columns (horizontal).", kind: "fields", width: 240, fields: [
            { control: "stepper", label: "Row gap", key: "cellGapY", min: 0, max: 12, suffix: "px" },
            { control: "stepper", label: "Column gap", key: "cellGapX", min: 0, max: 12, suffix: "px" },
        ] },
        { id: "radius", name: "Corner radius", info: "Round the corners of each day cell, from sharp squares to soft rounded tiles.", kind: "fields", width: 240, fields: [
            { control: "stepper", label: "Corner radius", key: "cornerRadius", min: 0, max: 12, suffix: "px" },
        ] },
    ] },
    { id: "elements", name: "Elements", subs: [
        { id: "labels", name: "Labels", info: "Show or hide the month names, weekday names, the KPI header above the grid, and ISO week numbers below each year band.", kind: "fields", width: 220, fields: [
            { control: "switch", label: "Months", key: "showMonths" },
            { control: "switch", label: "Weekdays", key: "showWeekdays" },
            { control: "switch", label: "KPI header", key: "showKpi" },
            { control: "switch", label: "Week numbers", key: "showWeekNums" },
        ] },
        { id: "legend", name: "Legend", info: "Configure the color legend — placement, alignment, title, swatch sizing, labels, and the no-data swatch.", kind: "fields", width: 282, fields: [
            { control: "segText", label: "Placement", key: "legendPlacement", options: [["off", "Off"], ["bottom", "Bottom"], ["top", "Top"]] },
            { control: "segIcon", label: "Align", key: "legendAlign", iconOptions: [["start", "left"], ["center", "center"], ["end", "right"]] },
            { control: "text", label: "Title", key: "legendTitle", placeholder: "(none)" },
            { control: "stepper", label: "Swatch size", key: "legendSwatch", min: 6, max: 30, suffix: "px", visibleIf: g => String(g("buckets")) !== "0" },
            { control: "stepper", label: "Gradient length", key: "legendGradient", min: 40, max: 320, step: 10, suffix: "px", visibleIf: g => String(g("buckets")) === "0" },
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
        { id: "badges", name: "Day badges", info: "Mark notable days. Peak day + a legacy single threshold (kept for back-compat), plus three rules — each compares the day's value (or value vs target) and applies a badge, color cue, and CVD hatch.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Mark peak", key: "badge.peakOn" },
            { control: "emoji", label: "Peak emoji", key: "badge.peakEmoji", visibleIf: g => Boolean(g("badge.peakOn")) },
            { control: "divider" },
            { control: "switch", label: "Mark threshold", key: "badge.thresholdOn" },
            // Bounds must span the measure's range, not a guess about it: a threshold
            // capped at 200 is unreachable for any measure larger than that, and the
            // badges card is gear-only (not in PANE_CARDS) so there is no native-pane
            // escape hatch. Matches the rule steppers' range.
            { control: "stepper", label: "Threshold ≥", key: "badge.thresholdValue", min: -1e9, max: 1e9, step: 1, visibleIf: g => Boolean(g("badge.thresholdOn")) },
            { control: "emoji", label: "Threshold emoji", key: "badge.thresholdEmoji", visibleIf: g => Boolean(g("badge.thresholdOn")) },
            { control: "divider" },
            ...ruleFields(1, "Good day"),
            { control: "divider" },
            ...ruleFields(2, "Bad day"),
            { control: "divider" },
            ...ruleFields(3, "Target breach"),
        ] },
        { id: "insights", name: "Insights", info: "The automatic insight lines above the grid — peaks, streaks, unusual days. Polarity declares whether higher values are good or bad (colors the insight text); Max caps how many lines show.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Show insights", key: "insights.show" },
            { control: "segText", label: "Higher is", key: "insights.polarity", options: [["good", "Good"], ["bad", "Bad"], ["neutral", "Neutral"]], visibleIf: g => Boolean(g("insights.show")) },
            { control: "stepper", label: "Max insights", key: "insights.count", min: 1, max: 6, visibleIf: g => Boolean(g("insights.show")) },
        ] },
        { id: "summaryTable", name: "Summary table", info: "Replace the calendar with a full-screen summary table — one row per month, or one per group when a Split-by field is bound. While it's on, a Visual/Table switch floats at the bottom right so anyone viewing the report can flip between the two views.", kind: "fields", width: 260, fields: [
            { control: "switch", label: "Summary table", key: "summaryTable.show" },
        ] },
        { id: "dayDetail", name: "Day detail", info: "Click a day to open a persistent detail panel showing its date, value, target variance, notes, and (on faceted reports) the top contributor.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Show panel", key: "dayDetail.enabled" },
            { control: "segText", label: "Position", key: "dayDetail.position", options: DAY_DETAIL_POSITION_OPTS, visibleIf: g => Boolean(g("dayDetail.enabled")) },
            { control: "switch", label: "Top contributor (faceted)", key: "dayDetail.topContributor", visibleIf: g => Boolean(g("dayDetail.enabled")) },
        ] },
        { id: "annotations", name: "Annotations", info: "Click any day to add a note to it — the text and its styling are set in the note editor. These controls govern how notes appear on the grid: the marker (a number, a dot, or an emoji) and what a newly-added note shows by default.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Show annotations", key: "annotation.show" },
            { control: "segText", label: "Marker", key: "annotation.markerStyle", options: MARKER_STYLE_OPTS, visibleIf: g => Boolean(g("annotation.show")) },
            { control: "emoji", label: "Marker icon", key: "annotation.markerIcon", visibleIf: g => Boolean(g("annotation.show")) && String(g("annotation.markerStyle")) === "icon" },
            { control: "color", label: "Marker color", key: "annotation.markerColor", visibleIf: g => Boolean(g("annotation.show")) && String(g("annotation.markerStyle")) !== "icon" },
            { control: "segText", label: "New note shows", key: "annotation.defaultMode", options: NOTE_MODE_OPTS, visibleIf: g => Boolean(g("annotation.show")) },
        ] },
    ] },
    { id: "text", name: "Text", subs: [
        { id: "headline", name: "Headline", info: "Font, size, style, and color of the headline text.", kind: "fields", width: 282, fields: typeFields("headline") },
        { id: "stats", name: "Stats", info: "Font, size, style, and color of the stat chips.", kind: "fields", width: 282, fields: typeFields("statChips") },
        { id: "months", name: "Months", info: "Font, size, style, and color of the month labels.", kind: "fields", width: 282, fields: typeFields("monthRail") },
        { id: "weekdays", name: "Weekdays", info: "Font, size, style, and color of the weekday labels.", kind: "fields", width: 282, fields: typeFields("weekdayRail") },
        { id: "years", name: "Years", info: "Font, size, style, and color of the year tags.", kind: "fields", width: 282, fields: typeFields("yearTags") },
        { id: "legendtext", name: "Legend text", info: "Font, size, style, and color of the legend labels.", kind: "fields", width: 282, fields: typeFields("legendText") },
        { id: "facettitle", name: "Facet titles", info: "Font, size, style, and color of the small-multiple panel titles (shown when a Split-by category is bound).", kind: "fields", width: 282, fields: typeFields("facetTitle") },
    ] },
    { id: "access", name: "Accessibility", flat: true, subs: [
        { id: "a11y", name: "Accessibility", info: "Improve accessibility — show a keyboard focus ring, and optionally add a CVD-safe hatch to cells at or above a threshold. Turn on “Pattern on threshold” to reveal the threshold value and pattern-style controls.", kind: "fields", width: 282, fields: [
            { control: "switch", label: "Focus ring", key: "a11y.focusRing" },
            { control: "switch", label: "Pattern on threshold", key: "a11y.pattern" },
            { control: "stepper", label: "Pattern threshold ≥", key: "a11y.patternThreshold", min: 0, max: 10000, step: 1, visibleIf: g => Boolean(g("a11y.pattern")) },
            { control: "segText", label: "Pattern style", key: "a11y.patternStyle", options: PATTERN_STYLE_OPTS, visibleIf: g => Boolean(g("a11y.pattern")) },
            { control: "divider" },
            // QA-10: the ONLY user-reachable build stamp besides the landing page. QA and
            // support need to confirm which build is actually running inside the host
            // sandbox (the 2026-07-14 Service run tested a stale build without knowing).
            { control: "heading", label: `Zentrix Calendar Heatmap v${VERSION}` },
        ] },
    ] },
];
