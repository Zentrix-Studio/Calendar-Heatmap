"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { TextStyle } from "./render/text";
import { Rule, RULE_GOOD_COLOR, RULE_BAD_COLOR } from "./render/rules";
import { PatternStyle } from "./render/patterns";
import { accent as ACCENT_TOKEN } from "./theme/zentrixTokens";

import Card = formattingSettings.SimpleCard;
import Model = formattingSettings.Model;
import ToggleSwitch = formattingSettings.ToggleSwitch;
import NumUpDown = formattingSettings.NumUpDown;
import ColorPicker = formattingSettings.ColorPicker;
import ItemDropdown = formattingSettings.ItemDropdown;
import TextInput = formattingSettings.TextInput;

const item = (value: string, displayName: string) => ({ value, displayName });

/** Curated modern font stacks (sandbox can't load external web fonts, so each
 *  stack ends in a system fallback that renders even if the named face is absent;
 *  faces that ship with Windows 11 / macOS render distinctly). Grouped sans →
 *  display → serif → mono; Segoe UI stays first as the default. */
export const FONT_ITEMS = [
    // Neutral / humanist sans
    item("Segoe UI, system-ui, -apple-system, sans-serif", "Segoe UI"),
    item("'Segoe UI Variable', 'Segoe UI', sans-serif", "Segoe UI Variable"),
    item("system-ui, -apple-system, sans-serif", "System UI"),
    item("Calibri, Candara, 'Segoe UI', sans-serif", "Calibri"),
    item("Candara, Calibri, 'Segoe UI', sans-serif", "Candara"),
    item("Tahoma, Geneva, 'Segoe UI', sans-serif", "Tahoma"),
    item("Verdana, Geneva, 'Segoe UI', sans-serif", "Verdana"),
    item("'Trebuchet MS', 'Segoe UI', sans-serif", "Trebuchet"),
    item("'Helvetica Neue', Helvetica, Arial, sans-serif", "Helvetica Neue"),
    item("Arial, Helvetica, sans-serif", "Arial"),
    item("Inter, system-ui, sans-serif", "Inter"),
    item("Roboto, 'Segoe UI', system-ui, sans-serif", "Roboto"),
    // Display / geometric-condensed
    item("Bahnschrift, 'DIN Next', 'Segoe UI', sans-serif", "Bahnschrift"),
    item("DIN, Bahnschrift, 'Segoe UI', sans-serif", "DIN"),
    // Serif
    item("Georgia, 'Times New Roman', serif", "Georgia"),
    item("Cambria, Georgia, 'Times New Roman', serif", "Cambria"),
    // Monospace
    item("Consolas, ui-monospace, monospace", "Consolas"),
    item("'Cascadia Code', 'Cascadia Mono', Consolas, ui-monospace, monospace", "Cascadia Code"),
];
const DEFAULT_FONT = FONT_ITEMS[0];

/**
 * Reusable text-style card: Font · Size · Bold · Italic · Underline · Color.
 * One instance per text group (Headline, Month rail, …). Color "" = auto/theme.
 */
class TextStyleCard extends Card {
    fontFamily: ItemDropdown;
    fontSize: NumUpDown;
    bold: ToggleSwitch;
    italic: ToggleSwitch;
    underline: ToggleSwitch;
    color: ColorPicker;

    constructor(name: string, displayName: string, size: number, opts?: { bold?: boolean; color?: string }) {
        super();
        this.fontFamily = new ItemDropdown({ name: "fontFamily", displayName: "Font", items: FONT_ITEMS, value: DEFAULT_FONT });
        this.fontSize = new NumUpDown({ name: "fontSize", displayName: "Size", value: size });
        this.bold = new ToggleSwitch({ name: "bold", displayName: "Bold", value: opts?.bold ?? false });
        this.italic = new ToggleSwitch({ name: "italic", displayName: "Italic", value: false });
        this.underline = new ToggleSwitch({ name: "underline", displayName: "Underline", value: false });
        this.color = new ColorPicker({ name: "color", displayName: "Color (blank = auto)", value: { value: opts?.color ?? "" } });
        this.name = name;
        this.displayName = displayName;
        this.slices = [this.fontFamily, this.fontSize, this.bold, this.italic, this.underline, this.color];
    }

    toStyle(): TextStyle {
        return {
            family: this.fontFamily.value.value as string,
            size: this.fontSize.value,
            bold: this.bold.value,
            italic: this.italic.value,
            underline: this.underline.value,
            color: this.color.value.value,
        };
    }
}

// --- Data display -----------------------------------------------------------
class DataDisplayCard extends Card {
    layout = new ItemDropdown({
        name: "layout", displayName: "Calendar layout",
        items: [item("continuous", "Continuous"), item("month", "Month blocks")],
        value: item("continuous", "Continuous"),
    });
    firstDayOfWeek = new ItemDropdown({
        name: "firstDayOfWeek", displayName: "Week starts on",
        items: [item("0", "Sunday"), item("1", "Monday")],
        value: item("0", "Sunday"),
    });
    aggregation = new ItemDropdown({
        name: "aggregation", displayName: "Aggregate duplicates by",
        items: [item("sum", "Sum"), item("avg", "Average"), item("min", "Min"), item("max", "Max"), item("count", "Count")],
        value: item("sum", "Sum"),
    });
    name = "dataDisplay";
    displayName = "Data display";
    slices = [this.layout, this.firstDayOfWeek, this.aggregation];
}

// --- Time intelligence (fiscal year) ----------------------------------------
const MONTH_ITEMS = [
    item("1", "January"), item("2", "February"), item("3", "March"), item("4", "April"),
    item("5", "May"), item("6", "June"), item("7", "July"), item("8", "August"),
    item("9", "September"), item("10", "October"), item("11", "November"), item("12", "December"),
];
class TimeIntelligenceCard extends Card {
    fiscalStart = new ItemDropdown({
        name: "fiscalStart", displayName: "Fiscal year starts",
        // Scope note (Z review): this only shifts the year/quarter boundaries used by
        // the year-over-year insight. With a single year of data there is no prior year
        // to compare, so changing it has no visible effect until ≥2 fiscal years are bound.
        description: "Shifts the year and quarter boundaries used by the year-over-year insight. Has no visible effect unless the data spans two or more (fiscal) years.",
        items: MONTH_ITEMS, value: item("1", "January"),
    });
    name = "timeIntel";
    displayName = "Time intelligence";
    slices = [this.fiscalStart];
}

// --- Small multiples (Split by) ---------------------------------------------
class SmallMultiplesCard extends Card {
    columns = new NumUpDown({ name: "columns", displayName: "Columns (0 = auto)", value: 0 });
    sharedScale = new ToggleSwitch({ name: "sharedScale", displayName: "Shared color scale", value: true });
    name = "smallMultiples";
    displayName = "Small multiples";
    slices = [this.columns, this.sharedScale];
}

// --- Cells ------------------------------------------------------------------
class CellsCard extends Card {
    cellSize = new NumUpDown({ name: "cellSize", displayName: "Max cell size", value: 22 });
    cellGapX = new NumUpDown({ name: "cellGapX", displayName: "Column gap", value: 3 });
    cellGapY = new NumUpDown({ name: "cellGapY", displayName: "Row gap", value: 3 });
    cornerRadius = new NumUpDown({ name: "cornerRadius", displayName: "Corner radius", value: 2 });
    name = "cells";
    displayName = "Cells";
    slices = [this.cellSize, this.cellGapX, this.cellGapY, this.cornerRadius];
}

// --- Labels -----------------------------------------------------------------
class LabelsCard extends Card {
    showMonthLabels = new ToggleSwitch({ name: "showMonthLabels", displayName: "Month labels", value: true });
    showWeekdayLabels = new ToggleSwitch({ name: "showWeekdayLabels", displayName: "Weekday labels", value: true });
    showHeader = new ToggleSwitch({ name: "showHeader", displayName: "KPI header", value: false });
    name = "labels";
    displayName = "Labels";
    slices = [this.showMonthLabels, this.showWeekdayLabels, this.showHeader];
}

// --- Colors -----------------------------------------------------------------
class ColorsCard extends Card {
    paletteMode = new ItemDropdown({
        name: "paletteMode", displayName: "Palette type",
        items: [item("mono", "Mono"), item("ramp", "Ramp"), item("duotone", "Duotone"),
            item("split", "Split"), item("theme", "Report theme")],
        value: item("ramp", "Ramp"),
    });
    ramp = new ItemDropdown({
        name: "ramp", displayName: "Ramp preset",
        items: [item("violet", "Violet"), item("ocean", "Ocean"), item("forest", "Forest"),
            item("magma", "Magma"), item("viridis", "Viridis"), item("colorblind", "Colorblind-safe")],
        value: item("violet", "Violet"),
    });
    startColor = new ColorPicker({ name: "startColor", displayName: "Start / hue", value: { value: "#7C5CFF" } });
    endColor = new ColorPicker({ name: "endColor", displayName: "End color", value: { value: "#1B0F4D" } });
    splitLow = new ColorPicker({ name: "splitLow", displayName: "Split — low", value: { value: "#2166AC" } });
    splitMid = new ColorPicker({ name: "splitMid", displayName: "Split — mid", value: { value: "#F7F7F7" } });
    splitHigh = new ColorPicker({ name: "splitHigh", displayName: "Split — high", value: { value: "#B2182B" } });
    scaleMode = new ItemDropdown({
        name: "scaleMode", displayName: "Color scaling",
        items: [item("quantile", "Quantile"), item("linear", "Linear"), item("log", "Log")],
        value: item("quantile", "Quantile"),
    });
    bucketCount = new ItemDropdown({
        name: "bucketCount", displayName: "Buckets",
        items: [item("0", "Continuous"), item("3", "3"), item("5", "5"), item("7", "7")],
        value: item("5", "5"),
    });
    // No-data color: blank = theme-neutral gray (the safe default — a loud no-data
    // color reads as a high value). Surfaced as the "No-data" custom-color row.
    noDataColor = new ColorPicker({ name: "noDataColor", displayName: "No-data color", value: { value: "" } });
    name = "colors";
    displayName = "Colors";
    slices = [this.paletteMode, this.ramp, this.startColor, this.endColor,
        this.splitLow, this.splitMid, this.splitHigh, this.noDataColor, this.scaleMode, this.bucketCount];

    /**
     * Show only the color controls that apply to the current palette type, so the
     * native Format pane never presents an inert picker (Z-137 §1). Called by the
     * formatting service before the card is populated; the model is rebuilt on
     * every pane render, so reading paletteMode here always reflects the live value.
     * The in-visual overlay drives the same intent via colorMode() auto-switching.
     */
    onPreProcess(): void {
        // Dormant: the native Colors card is force-hidden (see ~L358), so this slice-visibility
        // logic never renders today. Kept (not removed) to avoid cert-file churn; the in-visual
        // overlay is the live color surface (Z-137 §1). Revisit in v1.1 (remove or re-expose).
        const mode = this.paletteMode.value.value as string;
        // start/hue is the single custom color for mono & theme, and the start of duotone.
        this.startColor.visible = mode === "mono" || mode === "theme" || mode === "duotone";
        this.endColor.visible = mode === "duotone";
        this.ramp.visible = mode === "ramp";
        const split = mode === "split";
        this.splitLow.visible = this.splitMid.visible = this.splitHigh.visible = split;
        // noDataColor, scaleMode, bucketCount, paletteMode always apply.
    }
}

// --- Legend -----------------------------------------------------------------
class LegendCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show legend", value: true });
    position = new ItemDropdown({
        name: "position", displayName: "Position",
        items: [item("bottom", "Bottom"), item("top", "Top")],
        value: item("bottom", "Bottom"),
    });
    align = new ItemDropdown({
        name: "align", displayName: "Alignment",
        items: [item("start", "Left"), item("center", "Center"), item("end", "Right")],
        value: item("start", "Left"),
    });
    swatchSize = new NumUpDown({ name: "swatchSize", displayName: "Swatch size", value: 11 });
    gradientLength = new NumUpDown({ name: "gradientLength", displayName: "Gradient length", value: 120 });
    showLabels = new ToggleSwitch({ name: "showLabels", displayName: "Low / high labels", value: true });
    lessLabel = new TextInput({ name: "lessLabel", displayName: "Low label", value: "Less", placeholder: "Less" });
    moreLabel = new TextInput({ name: "moreLabel", displayName: "High label", value: "More", placeholder: "More" });
    showNoData = new ToggleSwitch({ name: "showNoData", displayName: "No-data swatch", value: true });
    noDataSide = new ItemDropdown({
        name: "noDataSide", displayName: "No-data side",
        items: [item("right", "Right"), item("left", "Left")],
        value: item("right", "Right"),
    });
    title = new TextInput({ name: "title", displayName: "Legend title", value: "", placeholder: "(none)" });
    name = "legend";
    displayName = "Legend";
    slices = [this.show, this.position, this.align, this.swatchSize, this.gradientLength,
        this.showLabels, this.lessLabel, this.moreLabel, this.showNoData, this.noDataSide, this.title];
}

// --- Insights -------------------------------------------------------------------
class InsightsCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show insights", value: true });
    polarity = new ItemDropdown({
        name: "polarity", displayName: "Higher values are",
        items: [item("good", "Good (more is better)"), item("bad", "Bad (less is better)"), item("neutral", "Neutral (no good/bad color)")],
        // Default neutral: never color insights good/bad until the user declares the
        // direction, so an error/outage spike is never shown green out of the box.
        value: item("neutral", "Neutral (no good/bad color)"),
    });
    count = new NumUpDown({ name: "count", displayName: "Max insights", value: 3 });
    name = "insights";
    displayName = "Insights";
    slices = [this.show, this.polarity, this.count];
}

// --- Pattern styles (Z-149) -------------------------------------------------
// The Core-5 cell pattern set, in the fixed order from patterns.ts. `diagonal`
// is index 0 = the back-compat default (reproduces the legacy hatch). Shared by
// the Accessibility threshold overlay and each Z-146 rule slot.
const PATTERN_STYLE_LABELS: Record<PatternStyle, string> = {
    diagonal: "Diagonal lines",
    dots: "Dots",
    crosshatch: "Crosshatch",
    grid: "Grid",
    stars: "Stars",
};
export const PATTERN_STYLE_ITEMS = (["diagonal", "dots", "crosshatch", "grid", "stars"] as PatternStyle[])
    .map(k => item(k, PATTERN_STYLE_LABELS[k]));
const DEFAULT_PATTERN_STYLE = PATTERN_STYLE_ITEMS[0]; // diagonal

// --- Accessibility ----------------------------------------------------------
class AccessibilityCard extends Card {
    focusRing = new ToggleSwitch({ name: "focusRing", displayName: "Keyboard focus ring", value: true });
    // CVD-safe pattern on cells at or above the threshold — independent of the Day-badges
    // threshold. Uses its own threshold value so users can get the pattern without enabling
    // the emoji badge. Visual verification pending Desktop (see Z-110 / Z-106).
    patternOnThreshold = new ToggleSwitch({
        name: "patternOnThreshold", displayName: "Pattern on threshold", value: false,
        description: "Overlay a CVD-safe hatch on cells at or above the threshold. Turn this on to reveal the threshold value and pattern-style controls.",
    });
    patternThresholdValue = new NumUpDown({ name: "patternThresholdValue", displayName: "Pattern threshold ≥", value: 0 });
    // Z-149 — pattern style for the threshold overlay. Default `diagonal` reproduces
    // the legacy hatch (back-compat). Shown only when patternOnThreshold is on.
    patternStyle = new ItemDropdown({ name: "patternStyle", displayName: "Pattern style", items: PATTERN_STYLE_ITEMS, value: DEFAULT_PATTERN_STYLE });
    name = "accessibility";
    displayName = "Accessibility";
    slices = [this.focusRing, this.patternOnThreshold, this.patternThresholdValue, this.patternStyle];

    /** Pattern-style dropdown is only relevant when the threshold pattern is on. */
    onPreProcess(): void {
        (this.patternStyle as unknown as { visible?: boolean }).visible = this.patternOnThreshold.value;
    }
}

// --- Header (KPI) -----------------------------------------------------------
class HeaderCard extends Card {
    titleText = new TextInput({
        name: "titleText", displayName: "Title text", value: "", placeholder: "(blank = auto)",
        // Issue #2 — this in-canvas title is the product title. To avoid two competing
        // titles, turn OFF Power BI's own visual title (General → Title) and use this.
        // Blank = an auto title ("<Value> by <Split-by>", or the value field name).
        description: "The visual's own title. To avoid a duplicate, turn off the native Power BI title under General → Title. Leave blank for an automatic title (e.g. \"Tickets by Region\").",
    });
    align = new ItemDropdown({
        name: "align", displayName: "Title align",
        items: [item("left", "Left"), item("center", "Center"), item("right", "Right")],
        value: item("left", "Left"),
    });
    ruleShow = new ToggleSwitch({ name: "ruleShow", displayName: "Accent rule", value: true });
    ruleColor = new ColorPicker({ name: "ruleColor", displayName: "Rule color", value: { value: "#7C5CFF" } });
    ruleWidth = new NumUpDown({ name: "ruleWidth", displayName: "Rule width", value: 2 });
    name = "header";
    displayName = "Header";
    slices = [this.titleText, this.align, this.ruleShow, this.ruleColor, this.ruleWidth];
}

// --- Day badges + Rules (Z-146) ---------------------------------------------
// EVOLVED (DD-5) from the shipped "Day badges" card into a rules list, with full
// back-compat: peak + the legacy single threshold stay exactly as-is, and three
// optional rule slots generalize the threshold into "good / bad / target breach".
// Rules default OFF (DD-6). Each rule's default color is token-sourced (Z-148).
const RULE_OPERATOR_ITEMS = [
    item(">=", "≥"), item(">", ">"), item("<=", "≤"), item("<", "<"),
    item("==", "="), item("between", "between"),
];
const RULE_COMPARE_ITEMS = [item("value", "Value"), item("target", "Value − Target")];

/** One rule slot: enabled + operator + value(+value2) + compareTo + badge + color + pattern. */
class RuleSlot {
    on: ToggleSwitch;
    ruleName: TextInput;
    operator: ItemDropdown;
    value: NumUpDown;
    value2: NumUpDown;
    compareTo: ItemDropdown;
    badge: TextInput;
    color: ColorPicker;
    pattern: ToggleSwitch;
    patternStyle: ItemDropdown;

    constructor(n: 1 | 2 | 3, defaultName: string, defaultColor: string) {
        this.on = new ToggleSwitch({ name: `rule${n}On`, displayName: `Rule ${n}`, value: false });
        this.ruleName = new TextInput({ name: `rule${n}Name`, displayName: "Name", value: defaultName, placeholder: defaultName });
        this.operator = new ItemDropdown({ name: `rule${n}Operator`, displayName: "Operator", items: RULE_OPERATOR_ITEMS, value: RULE_OPERATOR_ITEMS[0] });
        this.value = new NumUpDown({ name: `rule${n}Value`, displayName: "Value", value: 0 });
        this.value2 = new NumUpDown({ name: `rule${n}Value2`, displayName: "and", value: 0 });
        this.compareTo = new ItemDropdown({ name: `rule${n}CompareTo`, displayName: "Compare", items: RULE_COMPARE_ITEMS, value: RULE_COMPARE_ITEMS[0] });
        this.badge = new TextInput({ name: `rule${n}Badge`, displayName: "Badge", value: "", placeholder: "(emoji)" });
        // Token-sourced default color (Okabe-Ito CVD-safe) — never a raw hex literal.
        this.color = new ColorPicker({ name: `rule${n}Color`, displayName: "Color", value: { value: defaultColor } });
        this.pattern = new ToggleSwitch({ name: `rule${n}Pattern`, displayName: "CVD hatch", value: false });
        // Z-149 — per-rule pattern style. Default `diagonal` keeps an already-on
        // pattern toggle rendering the legacy hatch (back-compat).
        this.patternStyle = new ItemDropdown({ name: `rule${n}PatternStyle`, displayName: "Pattern style", items: PATTERN_STYLE_ITEMS, value: DEFAULT_PATTERN_STYLE });
    }

    slices(): formattingSettings.Slice[] {
        return [this.on, this.ruleName, this.operator, this.value, this.value2,
            this.compareTo, this.badge, this.color, this.pattern, this.patternStyle];
    }
}

class DayBadgesCard extends Card {
    peakOn = new ToggleSwitch({ name: "peakOn", displayName: "Mark peak day", value: false });
    peakEmoji = new TextInput({ name: "peakEmoji", displayName: "Peak emoji", value: "🔥", placeholder: "🔥" });
    // Legacy single threshold — preserved verbatim for back-compat (§4). Renders
    // identically for any report that set it; rules generalize but never replace it.
    thresholdOn = new ToggleSwitch({ name: "thresholdOn", displayName: "Mark threshold", value: false });
    thresholdValue = new NumUpDown({ name: "thresholdValue", displayName: "Threshold ≥", value: 0 });
    thresholdEmoji = new TextInput({ name: "thresholdEmoji", displayName: "Threshold emoji", value: "⚠️", placeholder: "⚠️" });
    // Three rule slots (DD-4). Defaults: token Okabe-Ito good=blue, bad/breach=orange.
    rule1 = new RuleSlot(1, "Good day", RULE_GOOD_COLOR);
    rule2 = new RuleSlot(2, "Bad day", RULE_BAD_COLOR);
    rule3 = new RuleSlot(3, "Target breach", RULE_BAD_COLOR);
    name = "badges";
    displayName = "Day badges";
    slices = [
        this.peakOn, this.peakEmoji, this.thresholdOn, this.thresholdValue, this.thresholdEmoji,
        ...this.rule1.slices(), ...this.rule2.slices(), ...this.rule3.slices(),
    ];

    /** Hide a rule's fields when it's off, value2 unless operator = between, and
     *  the per-rule pattern style unless that rule's pattern toggle is on (Z-149). */
    onPreProcess(): void {
        for (const r of [this.rule1, this.rule2, this.rule3]) {
            const on = r.on.value;
            for (const s of [r.ruleName, r.operator, r.value, r.compareTo, r.badge, r.color, r.pattern]) {
                (s as unknown as { visible?: boolean }).visible = on;
            }
            (r.value2 as unknown as { visible?: boolean }).visible = on && (r.operator.value.value as string) === "between";
            (r.patternStyle as unknown as { visible?: boolean }).visible = on && r.pattern.value;
        }
    }

    /** Resolve the live rule slots into the engine's Rule[] (only enabled ones, in order). */
    activeRules(): Rule[] {
        const out: Rule[] = [];
        for (const r of [this.rule1, this.rule2, this.rule3]) {
            if (!r.on.value) continue;
            out.push({
                name: (r.ruleName.value || "Rule").trim(),
                operator: r.operator.value.value as Rule["operator"],
                value: r.value.value,
                value2: r.value2.value,
                compareTo: r.compareTo.value.value as Rule["compareTo"],
                badge: r.badge.value ? r.badge.value : undefined,
                color: r.color.value.value || undefined,
                patternOn: r.pattern.value,
                patternStyle: (r.patternStyle.value.value as PatternStyle) || "diagonal",
            });
        }
        return out;
    }
}

// --- Annotations (Z-152) ----------------------------------------------------
// Author-written notes: click a day → type a note (see interaction/noteEditor.ts).
// This REPLACED the old data-bound `annotation` role — annotations are authored
// in the visual now, not sourced from a column.
//
// The notes THEMSELVES are not here. They live in the `notesStore.data` blob,
// which has no Card and never enters the formatting model — see notes/store.ts
// for why (short version: SettingsOverlay.reset() fires removeObject over every
// card, so a store on a card would be destroyed by the gear's Reset button).
// This card holds DISPLAY preferences only.
class AnnotationsCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show annotations", value: true });
    markerStyle = new ItemDropdown({
        name: "markerStyle", displayName: "Marker",
        items: [item("number", "Number"), item("dot", "Dot"), item("icon", "Icon")],
        value: item("number", "Number"),
    });
    markerIcon = new TextInput({ name: "markerIcon", displayName: "Marker icon", value: "📌", placeholder: "📌" });
    // Token-sourced default = brand accent (#7C5CFF), never a raw hex literal here.
    markerColor = new ColorPicker({ name: "markerColor", displayName: "Marker color", value: { value: ACCENT_TOKEN } });
    // What a NEW note gets. Existing notes carry their own mode in the store.
    //
    // Defaults to MARKER, not a callout. On a full-year grid the cells are ~10–14px
    // and there is no free canvas: an always-visible callout box necessarily covers
    // the days around the one it annotates — it hides the data it exists to explain.
    // So a new note is a numbered marker (text on hover / in the day panel), and the
    // author opts a callout in per-note, for the one or two headline points that
    // earn the space.
    defaultMode = new ItemDropdown({
        name: "defaultMode", displayName: "New note shows",
        items: [item("marker", "Marker only"), item("text", "Text"), item("arrow", "Text + arrow"), item("all", "Marker + text + arrow")],
        value: item("marker", "Marker only"),
    });
    name = "annotations";
    displayName = "Annotations";
    slices = [this.show, this.markerStyle, this.markerIcon, this.markerColor, this.defaultMode];

    /** markerIcon only applies in Icon mode; markerColor only to the Number/Dot. */
    onPreProcess(): void {
        const icon = (this.markerStyle.value.value as string) === "icon";
        (this.markerIcon as unknown as { visible?: boolean }).visible = icon;
        (this.markerColor as unknown as { visible?: boolean }).visible = !icon;
    }
}

// --- Summary table ------------------------------------------------------------
// An alternate full-screen VIEW, not a chrome band: when on, the visual shows a
// summary table (per month, or per group when a Split-by is bound) INSTEAD of the
// calendar grid — never both. A floating Visual/Table switch (bottom-right,
// interaction/viewToggle.ts) lets authors AND readers flip between the two views;
// the flip is session-local by design (it must work in Reading view, where
// persistProperties would not survive).
class SummaryTableCard extends Card {
    show = new ToggleSwitch({
        name: "show", displayName: "Show summary table", value: false,
        description: "Replace the calendar with a summary table (by month, or by group when a Split-by field is bound). A Visual/Table switch appears at the bottom right to flip between the two views.",
    });
    name = "summaryTable";
    displayName = "Summary table";
    slices = [this.show];
}

// --- Day detail panel (Z-145) -----------------------------------------------
// A persistent, keyboard-reachable panel opened by clicking a day. Default ON —
// the centerpiece "investigation tool" gap of the v1-GAPS slice.
class DayDetailCard extends Card {
    enabled = new ToggleSwitch({ name: "enabled", displayName: "Show day detail panel", value: true });
    position = new ItemDropdown({
        name: "position", displayName: "Panel position",
        items: [item("auto", "Auto"), item("right", "Right"), item("bottom", "Bottom")],
        value: item("auto", "Auto"),
    });
    // Only effective on faceted (Split-by) reports; honestly omitted otherwise.
    showTopContributor = new ToggleSwitch({ name: "showTopContributor", displayName: "Top contributor (faceted)", value: true });
    name = "dayDetail";
    displayName = "Day detail panel";
    slices = [this.enabled, this.position, this.showTopContributor];
}

// --- Toolbar ----------------------------------------------------------------
class ToolbarCard extends Card {
    show = new ToggleSwitch({ name: "show", displayName: "Show gear", value: true });
    position = new ItemDropdown({
        name: "position", displayName: "Gear position",
        items: [item("auto", "Auto (avoid content)"), item("bl", "Bottom left"), item("tl", "Top left"), item("tr", "Top right"), item("br", "Bottom right")],
        value: item("auto", "Auto (avoid content)"),
    });
    closeOnClickAway = new ToggleSwitch({ name: "closeOnClickAway", displayName: "Close on click-away", value: true });
    name = "toolbar";
    displayName = "Toolbar";
    slices = [this.show, this.position, this.closeOnClickAway];
}

// --- Zentrix branding (ZENTRIX-BRAND) ---------------------------------------
// Isolated attribution card. Default ON — shows a subtle "Zentrix" wordmark in
// the tooltip. Free v1: any user can turn it off here (no premium gate on this
// toggle). Removing this card + the "branding" object in capabilities.json +
// the branding folder fully reverts the visual.
class BrandingCard extends Card {
    showBranding = new ToggleSwitch({ name: "showBranding", displayName: "Show branding", value: true });
    name = "branding";
    displayName = "Zentrix branding";
    slices = [this.showBranding];
}

/** Visual formatting settings — mirrors spec §7 format pane + theming expansion. */
export class VisualFormattingSettingsModel extends Model {
    dataDisplay = new DataDisplayCard();
    timeIntel = new TimeIntelligenceCard();
    smallMultiples = new SmallMultiplesCard();
    cells = new CellsCard();
    colors = new ColorsCard();
    labels = new LabelsCard();
    header = new HeaderCard();
    facetTitle = new TextStyleCard("facetTitle", "Facet titles", 11, { bold: true });
    headline = new TextStyleCard("headline", "Headline", 15, { bold: true });
    statChips = new TextStyleCard("statChips", "Stat chips", 14, { bold: true });
    monthRail = new TextStyleCard("monthRail", "Month rail", 10);
    weekdayRail = new TextStyleCard("weekdayRail", "Weekday rail", 10);
    yearTags = new TextStyleCard("yearTags", "Year tags", 11, { bold: true });
    legend = new LegendCard();
    legendText = new TextStyleCard("legendText", "Legend text", 10);
    badges = new DayBadgesCard();
    annotations = new AnnotationsCard();
    insights = new InsightsCard();
    summaryTable = new SummaryTableCard();
    dayDetail = new DayDetailCard();
    toolbar = new ToolbarCard();
    accessibility = new AccessibilityCard();
    branding = new BrandingCard(); // ZENTRIX-BRAND

    cards = [
        this.dataDisplay, this.timeIntel, this.smallMultiples, this.cells, this.colors, this.labels, this.header,
        this.headline, this.statChips, this.monthRail, this.weekdayRail, this.yearTags, this.facetTitle,
        this.legend, this.legendText, this.badges, this.annotations, this.insights, this.summaryTable, this.dayDetail, this.toolbar, this.accessibility,
        this.branding, // ZENTRIX-BRAND
    ];

    constructor() {
        super();
        // The in-visual floating gear is the primary settings surface (its whole
        // point). The native Format pane intentionally keeps ONLY the three cards
        // that belong there: Toolbar (controls the gear itself), Accessibility
        // (host-level a11y, expected natively for compliance), and Zentrix branding.
        // Every other card is reachable from the gear — including Fiscal year, which
        // is wired into the gear's Data category (settingsSchema.ts) so nothing is
        // lost by hiding Time intelligence here.
        const PANE_CARDS = new Set(["toolbar", "accessibility", "branding"]);
        for (const c of this.cards) {
            (c as unknown as { name: string; visible?: boolean }).visible = PANE_CARDS.has(c.name);
        }
    }
}
