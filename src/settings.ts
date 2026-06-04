"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { TextStyle } from "./render/text";

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
    cellGap = new NumUpDown({ name: "cellGap", displayName: "Cell gap", value: 3 });
    cornerRadius = new NumUpDown({ name: "cornerRadius", displayName: "Corner radius", value: 2 });
    name = "cells";
    displayName = "Cells";
    slices = [this.cellSize, this.cellGap, this.cornerRadius];
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

// --- Accessibility ----------------------------------------------------------
class AccessibilityCard extends Card {
    focusRing = new ToggleSwitch({ name: "focusRing", displayName: "Keyboard focus ring", value: true });
    // CVD-safe hatch on cells at or above the threshold — independent of the Day-badges
    // threshold. Uses its own threshold value so users can get the pattern without enabling
    // the emoji badge. Visual verification pending Desktop (see Z-110 / Z-106).
    patternOnThreshold = new ToggleSwitch({ name: "patternOnThreshold", displayName: "Pattern on threshold", value: false });
    patternThresholdValue = new NumUpDown({ name: "patternThresholdValue", displayName: "Pattern threshold ≥", value: 0 });
    name = "accessibility";
    displayName = "Accessibility";
    slices = [this.focusRing, this.patternOnThreshold, this.patternThresholdValue];
}

// --- Header (KPI) -----------------------------------------------------------
class HeaderCard extends Card {
    titleText = new TextInput({ name: "titleText", displayName: "Title text", value: "", placeholder: "(blank = field name)" });
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

// --- Day badges -------------------------------------------------------------
class DayBadgesCard extends Card {
    peakOn = new ToggleSwitch({ name: "peakOn", displayName: "Mark peak day", value: false });
    peakEmoji = new TextInput({ name: "peakEmoji", displayName: "Peak emoji", value: "🔥", placeholder: "🔥" });
    thresholdOn = new ToggleSwitch({ name: "thresholdOn", displayName: "Mark threshold", value: false });
    thresholdValue = new NumUpDown({ name: "thresholdValue", displayName: "Threshold ≥", value: 0 });
    thresholdEmoji = new TextInput({ name: "thresholdEmoji", displayName: "Threshold emoji", value: "⚠️", placeholder: "⚠️" });
    name = "badges";
    displayName = "Day badges";
    slices = [this.peakOn, this.peakEmoji, this.thresholdOn, this.thresholdValue, this.thresholdEmoji];
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
    insights = new InsightsCard();
    toolbar = new ToolbarCard();
    accessibility = new AccessibilityCard();
    branding = new BrandingCard(); // ZENTRIX-BRAND

    cards = [
        this.dataDisplay, this.timeIntel, this.smallMultiples, this.cells, this.colors, this.labels, this.header,
        this.headline, this.statChips, this.monthRail, this.weekdayRail, this.yearTags, this.facetTitle,
        this.legend, this.legendText, this.badges, this.insights, this.toolbar, this.accessibility,
        this.branding, // ZENTRIX-BRAND
    ];

    constructor() {
        super();
        // All settings live in the in-visual overlay; the Format pane keeps only
        // the Toolbar and Branding cards. Hidden cards still populate + persist.
        // ZENTRIX-BRAND: free v1 — any user can remove the attribution from the
        // Format pane (no premium gate on this toggle).
        for (const c of this.cards) {
            (c as unknown as { name: string; visible?: boolean }).visible =
                c.name === "toolbar" || c.name === "branding" || c.name === "timeIntel"; // ZENTRIX-BRAND
        }
    }
}
