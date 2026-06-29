/*
 *  Zentrix Calendar Heatmap — Power BI custom visual
 *  Phase 6 implementation. Built against docs/phase-3-spec.md and
 *  roadmap/phase-5-engineering-plan.md (single source of truth one level up).
 */
"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { select, Selection } from "d3";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";
import { EmptyReason, CalendarModel, DayCell, FacetedRender } from "./types";
import { buildFacetedModel, AggregationMode } from "./model/dataTransform";
import {
    buildColorAccessor, ColorAccessor, ScaleMode, PaletteMode, RampPreset, resolvePalette, NO_DATA_DARK, NO_DATA_LIGHT,
} from "./render/colors";
import { renderGrid, CellSel, GridGeometry, GridOptions, predictGridSize } from "./render/grid";
import { renderMonthBlocks, predictMonthBlocksSize } from "./render/monthBlocks";
import { renderFacets, predictFacetSize, FacetLayoutOptions } from "./render/facets";
import { renderHeader, headerBandHeight } from "./render/header";
import { planChrome } from "./render/responsive";
import { renderLegend, LegendAlign, NoDataSide } from "./render/legend";
import { renderInsights } from "./render/insights";
import { computeInsights, computeAnomalies, DEFAULT_INSIGHT_CONFIG, Polarity } from "./insights";
import {
    cellBox, drawTodayRing, drawHoverRing, drawSelectedRing, drawFocusRing, drawBadge, drawNoDataHairline,
    drawAnnotationDot, drawThresholdPattern, applyHighlight, STATE,
} from "./render/states";
import { bindSelection, syncSelectionState, bindBackgroundContextMenu } from "./interaction/selection";
import { HeatmapTooltip } from "./interaction/tooltip";
import { bindKeyboard } from "./interaction/keyboard";
import { SettingsOverlay } from "./interaction/settingsPanel";
import { PremiumGate } from "./interaction/license";
import { LandingPage } from "./interaction/landingPage";

/** Pick the first corner whose gear-sized box doesn't overlap any content rect. */
function pickCorner(w: number, h: number, rects: number[][]): string {
    const G = 52, I = 10;
    const boxes: Record<string, [number, number]> = {
        br: [w - G - I, h - G - I], bl: [I, h - G - I], tr: [w - G - I, I], tl: [I, I],
    };
    const hits = (x: number, y: number) =>
        rects.some(([rx, ry, rw, rh]) => x < rx + rw && x + G > rx && y < ry + rh && y + G > ry);
    for (const c of ["br", "bl", "tr", "tl"]) { const [x, y] = boxes[c]; if (!hits(x, y)) return c; }
    return "br";
}

/** Rough perceived-luminance check on a #rrggbb color → true if dark. */
function isDarkColor(hex?: string): boolean {
    if (!hex || hex[0] !== "#" || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

type Group = Selection<SVGGElement, unknown, null, undefined>;

/** Insight card line height / fixed overhead (px) — shared by the planner that
 * reserves the band and the renderer that draws into it. */
const INSIGHT_LINE_H = 18, INSIGHT_OVERHEAD = 24;

/** Per-update render scratch — derived once, threaded through the render helpers
 * so each cohesive block (style, layout, grid, overlays, interaction) stays a
 * small private method without recomputing shared inputs. */
interface RenderContext {
    input: FacetedRender;
    combined: CalendarModel;
    faceted: boolean;
    width: number;
    height: number;
    firstDayOfWeek: number;
    locale: string;
    drawnDays: DayCell[];
    s: VisualFormattingSettingsModel;
    dark: boolean;
    hc: boolean;
    labelColor: string;
    strongColor: string;
    colorOpts: { mode: ScaleMode; buckets: number; ramp: string[]; noData: string };
    sharedScale: boolean;
    colors: ColorAccessor;
    facetColors: ColorAccessor[];
    colorsFor: (i: number) => ColorAccessor;
    // Chrome bands (legend / insights) and grid scaffolding.
    legendBandH: number;
    monthLayout: boolean;
    insightsOn: boolean;
    polarity: Polarity;
    insightItemsAll: ReturnType<typeof computeInsights>;
    gridBase: Omit<GridOptions, "width" | "height" | "originX" | "originY" | "colors" | "topOffset">;
    facetLayout: (region: { x: number; y: number; w: number; h: number }) => FacetLayoutOptions;
    // Resolved by the responsive planner.
    headerH: number;
    legendShown: boolean;
    legendLabels: boolean;
    legendTopH: number;
    legendBottomH: number;
    insightItems: ReturnType<typeof computeInsights>;
    insightsH: number;
    // Filled in once the grid/facets are drawn.
    geo: GridGeometry;
    cells: CellSel;
}

export class Visual implements IVisual {
    private host: IVisualHost;
    private element: HTMLElement;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private contentGroup: Group;
    private badgeGroup: Group;
    private selectedGroup: Group;
    private todayGroup: Group;
    private hoverGroup: Group;
    private focusGroup: Group;

    private selectionManager: ISelectionManager;
    private tooltip: HeatmapTooltip;
    private toolbar: SettingsOverlay;
    private premium: PremiumGate;
    private landing: LandingPage;
    private events: IVisualEventService;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    /** Last successful render inputs, replayed on in-visual settings changes. */
    private lastRender?: { render: FacetedRender; width: number; height: number; firstDayOfWeek: number };

    /** Header-band survival flags carried from planChromeBands() to drawHeader(). */
    private headerPlan?: { showHeader: boolean; showHeaderRule: boolean; showHeaderChips: boolean };

    /** Whether to wire cross-filter selection / keyboard / context-menu. False when
     * the host disables interactions (hostCapabilities.allowInteractions === false)
     * or the report is in advanced edit mode. Recomputed each update(); replayed by
     * rerenderFromSettings(). Defaults true so reading view stays fully interactive. */
    private interactive = true;

    /** Stroke color for hover/selected/focus/today rings. The brand accent in normal
     * mode; the OS high-contrast foreground when the host reports HC, so rings stay
     * visible against the HC theme. Set per render in wireTooltipAndInteraction(). */
    private ringAccent: string = STATE.accent;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.formattingSettingsService = new FormattingSettingsService();
        this.selectionManager = this.host.createSelectionManager();
        this.events = this.host.eventService;
        this.tooltip = new HeatmapTooltip(options.element);
        // The settings overlay mutates the live formatting model optimistically and
        // calls back here so the canvas repaints immediately — no waiting on the async
        // persistProperties → host → update() loop, which is flaky for fresh edits.
        this.toolbar = new SettingsOverlay(options.element, this.host, () => this.rerenderFromSettings());
        // Premium licence gate for the diagnostic insight engine; repaints when the
        // async plan check resolves (free core + premium gate, Phase-8 decision).
        this.premium = new PremiumGate(this.host, () => this.rerenderFromSettings());
        // Onboarding carousel — shown only when nothing is bound (the "noData" state).
        this.landing = new LandingPage(options.element);

        this.svg = select(options.element)
            .append("svg")
            .classed("zentrix-heatmap", true)
            .attr("width", "100%")
            .attr("height", "100%");

        // Layer order (bottom → top): cells/labels, badges, selected rings, today, hover, focus.
        // The content group wraps the gridcell cells, so it carries role="grid" for
        // assistive tech (cells set role="gridcell" + aria-selected in the sync path).
        this.contentGroup = this.svg.append("g").classed("content", true)
            .attr("role", "grid")
            .attr("aria-label", "Calendar heatmap");
        this.badgeGroup = this.svg.append("g").classed("badges", true);
        this.selectedGroup = this.svg.append("g").classed("selected-rings", true);
        this.todayGroup = this.svg.append("g").classed("today-ring", true);
        this.hoverGroup = this.svg.append("g").classed("hover-ring", true);
        this.focusGroup = this.svg.append("g").classed("focus-ring", true);

        // Click on empty canvas clears the cross-filter.
        this.svg.on("click", () => {
            this.selectionManager.clear();
            this.selectedGroup.selectAll("*").remove();
            this.contentGroup.selectAll<SVGRectElement, DayCell>("rect.cell").attr("fill-opacity", 1);
        });

        // Native right-click menu on the empty canvas (empty-selection context menu).
        bindBackgroundContextMenu(this.svg, this.selectionManager);

        // Show the onboarding carousel immediately. Power BI does NOT call update()
        // until at least one data role is bound, so a landing page shown only from
        // update() never appears on a fresh visual (the canvas stays blank). Mount
        // it here from the constructor; update() hides it the moment data arrives
        // and re-shows it if every field is later removed.
        try {
            this.landing.show();
        } catch {
            // Guard: a landing-page error must not blank the visual.
        }
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
            this.formattingSettings =
                this.formattingSettingsService.populateFormattingSettingsModel(
                    VisualFormattingSettingsModel, dataView);
            const palette = this.host.colorPalette;
            const dark = !palette.isHighContrast && isDarkColor(palette.background && palette.background.value);
            // Honor the host: skip all cross-filter wiring when interactions are
            // disabled (allowInteractions === false) or the report is in advanced
            // edit mode. allowInteractions is exposed on hostCapabilities in API
            // 5.11.0; default true so normal reading view is unchanged.
            const allowInteractions = this.host.hostCapabilities?.allowInteractions !== false;
            // EditMode.Advanced === 1. Compare the numeric value rather than the
            // ambient const-enum member so the check survives bundlers (e.g. esbuild)
            // that don't inline const enums declared in the API's .d.ts.
            const advancedEdit = options.editMode === 1; /* EditMode.Advanced */
            this.interactive = allowInteractions && !advancedEdit;
            this.toolbar.update(this.formattingSettings, dark);
            this.premium.refresh();

            const viewport = options.viewport;
            this.svg.attr("width", viewport.width).attr("height", viewport.height);
            [this.contentGroup, this.badgeGroup, this.selectedGroup, this.todayGroup, this.hoverGroup, this.focusGroup]
                .forEach(g => g.selectAll("*").remove());

            const reason = this.checkRoles(dataView);
            if (reason) {
                // ALWAYS draw the SVG text guidance first — it cannot fail and
                // guarantees the canvas is never blank even if the (DOM-overlay)
                // landing page throws in the host sandbox.
                this.renderEmptyState(reason, viewport.width, viewport.height);
                if (reason === "noData") {
                    // Nothing bound at all → layer the full onboarding carousel on
                    // top. Guarded so a landing-page error can't blank the visual.
                    try {
                        this.landing.setTheme(dark);
                        this.landing.show();
                    } catch {
                        // Guard: a landing-page error must not blank the visual.
                    }
                } else {
                    // A partial binding (mid-drag) → focused one-line hint only.
                    this.landing.hide();
                }
                this.events.renderingFinished(options);
                return;
            }
            // Real data is bound → tear the landing page down.
            this.landing.hide();

            const s = this.formattingSettings;
            const firstDayOfWeek = parseInt(s.dataDisplay.firstDayOfWeek.value.value as string, 10) || 0;
            const aggMode = s.dataDisplay.aggregation.value.value as AggregationMode;
            const render = buildFacetedModel(dataView!, this.host, firstDayOfWeek, aggMode);
            if (!render) {
                this.renderEmptyState("noData", viewport.width, viewport.height);
                this.events.renderingFinished(options);
                return;
            }

            this.lastRender = { render, width: viewport.width, height: viewport.height, firstDayOfWeek };
            this.render(render, viewport.width, viewport.height, firstDayOfWeek);
            this.events.renderingFinished(options);
        } catch (e) {
            try {
                const vp = options.viewport;
                this.contentGroup.selectAll("*").remove();
                this.renderMessage("Something went wrong rendering this visual.", vp.width, vp.height, "#E5484D");
            } catch {
                // Guard: error-fallback must not throw or the renderingFailed event won't fire.
            }
            this.events.renderingFailed(options, String(e));
        }
    }

    /**
     * Repaint from the last render inputs after an in-visual settings edit. The
     * formatting model was mutated in place by the overlay, so reading it fresh
     * reflects the change without a host round-trip.
     */
    private rerenderFromSettings(): void {
        const r = this.lastRender;
        if (!r) return;
        [this.contentGroup, this.badgeGroup, this.selectedGroup, this.todayGroup, this.hoverGroup, this.focusGroup]
            .forEach(g => g.selectAll("*").remove());
        this.render(r.render, r.width, r.height, r.firstDayOfWeek);
    }

    private render(input: FacetedRender, width: number, height: number, firstDayOfWeek: number): void {
        // Pure extraction: each helper owns one cohesive block and runs in the
        // original order, threading a single RenderContext so values aren't recomputed.
        const ctx = this.resolveStyle(input, width, height, firstDayOfWeek);
        this.planChromeBands(ctx);
        this.drawHeader(ctx);
        this.drawCalendar(ctx);
        this.drawLegend(ctx);
        this.drawCellOverlays(ctx);
        this.drawNotes(ctx);
        this.drawInsightsCard(ctx);
        this.placeToolbar(ctx);
        this.wireTooltipAndInteraction(ctx);
    }

    /** Theme / palette / color-scale resolution + the grid scaffolding (gridBase,
     * facetLayout) and premium-insight computation. Produces the RenderContext. */
    private resolveStyle(input: FacetedRender, width: number, height: number, firstDayOfWeek: number): RenderContext {
        const combined = input.combined;
        const faceted = input.facets.length > 1;
        // Honor the report's culture for all date/number text (falls back to a
        // deterministic en-US when the host doesn't supply one — e.g. tests/dev).
        const locale = this.host.locale || "en-US";
        // The cells actually drawn — one model's days (single) or every panel's (faceted).
        const drawnDays: DayCell[] = faceted ? input.facets.flatMap(f => f.model.days) : combined.days;
        const s = this.formattingSettings;
        const palette = this.host.colorPalette;
        const hc = palette.isHighContrast;
        // Auto-detect a dark report theme from the canvas background.
        const dark = !hc && isDarkColor(palette.background && palette.background.value);

        const ramp = hc
            ? [palette.background.value, palette.foreground.value]
            : resolvePalette({
                mode: s.colors.paletteMode.value.value as PaletteMode,
                preset: s.colors.ramp.value.value as RampPreset,
                startColor: s.colors.startColor.value.value,
                endColor: s.colors.endColor.value.value,
                splitLow: s.colors.splitLow.value.value,
                splitMid: s.colors.splitMid.value.value,
                splitHigh: s.colors.splitHigh.value.value,
                themeAccent: (palette.foreground && palette.foreground.value) || "#7C5CFF",
                dark,
            });
        const labelColor = hc ? palette.foreground.value : (dark ? "#8A8A99" : "#70707F");
        const strongColor = hc ? palette.foreground.value : (dark ? "#F4F4F6" : "#1A1A22");
        // No-data is "absence", not a value — defaults to a theme-neutral gray so it
        // can't compete with the ramp. Users may override it via the No-data custom color.
        const noDataOverride = s.colors.noDataColor.value.value;
        const noData = hc ? palette.background.value
            : (/^#[0-9a-fA-F]{6}$/.test(noDataOverride) ? noDataOverride : (dark ? NO_DATA_DARK : NO_DATA_LIGHT));

        const colorOpts = {
            mode: s.colors.scaleMode.value.value as ScaleMode,
            buckets: parseInt(s.colors.bucketCount.value.value as string, 10) || 0,
            ramp, noData,
        };
        // Color scale. In single-grid mode this fits the one model. In facet mode the
        // default is a SHARED scale (fit across every panel's day values) so colors are
        // comparable across panels; the user can opt into a per-panel scale instead.
        const sharedScale = !faceted || s.smallMultiples.sharedScale.value;
        const colors = buildColorAccessor(
            { ...combined, days: drawnDays, valueDomain: input.sharedDomain }, colorOpts);
        const facetColors: ColorAccessor[] = faceted && !sharedScale
            ? input.facets.map(f => buildColorAccessor(f.model, colorOpts))
            : [];
        const colorsFor = (i: number): ColorAccessor => (sharedScale ? colors : facetColors[i]);

        // Legend band reservation height (top or bottom). Left/Right (vertical) is a
        // follow-up — it needs the grid to reserve side-width.
        const lg = s.legend;
        const legendBandH = lg.show.value ? Math.max(lg.swatchSize.value, s.legendText.toStyle().size) + 12 : 0;
        const monthLayout = (s.dataDisplay.layout.value.value as string) === "month";

        // Premium insight engine — deterministic, in-sandbox. Gated by the
        // Insights card; reserves a bottom band (like the legend).
        // Diagnostic insights are premium. Free core keeps the heatmap + KPI header;
        // the insight card/anomaly tooltip require an active licence (gate is
        // fail-open in unsupported/dev envs - see PremiumGate).
        const premiumOk = this.premium.active;
        if (s.insights.show.value && !!combined.series && !premiumOk) this.premium.notifyBlocked();
        const insightsOn = s.insights.show.value && !!combined.series && premiumOk;
        const polarity = s.insights.polarity.value.value as Polarity;
        const fiscalStartMonth = parseInt(s.timeIntel.fiscalStart.value.value as string, 10) || 1;
        const insightItemsAll = insightsOn
            ? computeInsights(combined.series!, { ...DEFAULT_INSIGHT_CONFIG, polarity, fiscalStartMonth }, Math.max(1, Math.round(s.insights.count.value)))
            : [];

        // Base grid options shared by the predictor and the real render. Heights /
        // top-offset are filled in once the responsive planner has decided which
        // chrome bands survive (see below).
        const gridBase = {
            cellSize: s.cells.cellSize.value,
            gap: s.cells.cellGap.value,
            radius: s.cells.cornerRadius.value,
            firstDayOfWeek,
            showMonthLabels: s.labels.showMonthLabels.value,
            showWeekdayLabels: s.labels.showWeekdayLabels.value,
            labelColor, strongColor,
            cellStroke: hc ? palette.foreground.value : undefined,
            monthStyle: s.monthRail.toStyle(),
            weekdayStyle: s.weekdayRail.toStyle(),
            yearStyle: s.yearTags.toStyle(),
        };
        const facetLayout = (region: { x: number; y: number; w: number; h: number }): FacetLayoutOptions => ({
            region,
            columns: Math.max(0, Math.round(s.smallMultiples.columns.value)),
            monthLayout,
            titleStyle: s.facetTitle.toStyle(),
            titleColor: strongColor,
            gridBase,
            colorsFor,
        });

        return {
            input, combined, faceted, width, height, firstDayOfWeek, locale, drawnDays, s,
            dark, hc, labelColor, strongColor, colorOpts, sharedScale, colors, facetColors, colorsFor,
            legendBandH, monthLayout, insightsOn, polarity, insightItemsAll, gridBase, facetLayout,
            // Filled in by planChromeBands / drawCalendar below.
            headerH: 0, legendShown: false, legendLabels: false, legendTopH: 0, legendBottomH: 0,
            insightItems: [], insightsH: 0, geo: undefined!, cells: undefined!,
        };
    }

    /** Run the responsive planner that sheds the lowest-priority chrome band when
     * cells would otherwise shrink below the floor, then resolve surviving bands. */
    private planChromeBands(ctx: RenderContext): void {
        const { s, combined, input, faceted, width, height, colors, monthLayout,
            gridBase, facetLayout, legendBandH, insightItemsAll } = ctx;
        const lg = s.legend;
        const legendPos = lg.position.value.value as "bottom" | "top";

        // The KPI header, legend, and insights bands all compete with the grid for
        // space. Rather than reserving them unconditionally (which forced cells to a
        // 3px floor on small canvases), predict the cell size for a given chrome
        // reservation and let the planner shed the lowest-priority band first.
        // Header band height adapts to the configured headline/stat fonts (≥ 42)
        // so large sizes don't clip — must match renderHeader's own computation.
        const HEADER_H = headerBandHeight(s.headline.toStyle().size, s.statChips.toStyle().size);
        const predict = (top: number, bottom: number): number => {
            if (faceted) {
                return predictFacetSize(input.facets,
                    facetLayout({ x: 0, y: top, w: width, h: height - top - bottom - 4 }));
            }
            const opts = { ...gridBase, colors, width, height: height - bottom, topOffset: top };
            return monthLayout
                ? predictMonthBlocksSize(combined, opts, width, height - bottom)
                : predictGridSize(combined, opts, width, height - bottom);
        };

        const plan = planChrome({
            headerH: s.labels.showHeader.value ? HEADER_H : 0,
            legendH: lg.show.value ? legendBandH : 0,
            legendTop: legendPos === "top",
            insightsCount: insightItemsAll.length,
            insightsLineH: INSIGHT_LINE_H,
            insightsOverhead: INSIGHT_OVERHEAD,
            predict,
            floor: 7,
        });

        // Resolve the surviving bands from the plan.
        ctx.headerH = plan.showHeader ? HEADER_H : 0;
        ctx.legendShown = plan.showLegend;
        ctx.legendLabels = plan.legendLabels;
        ctx.legendTopH = ctx.legendShown && legendPos === "top" ? legendBandH : 0;
        ctx.legendBottomH = ctx.legendShown && legendPos === "bottom" ? legendBandH : 0;
        ctx.insightItems = insightItemsAll.slice(0, plan.insightsCount);
        ctx.insightsH = ctx.insightItems.length ? (INSIGHT_OVERHEAD + ctx.insightItems.length * INSIGHT_LINE_H) : 0;

        // Stash the plan parts the header render still needs (chips / rule survival).
        this.headerPlan = { showHeader: plan.showHeader, showHeaderRule: plan.showHeaderRule, showHeaderChips: plan.showHeaderChips };
    }

    /** Draw the KPI header now that the planner has decided its fate (and which of
     * its parts — chips, rule — fit). In facet mode it summarizes the rollup. */
    private drawHeader(ctx: RenderContext): void {
        const plan = this.headerPlan;
        if (!plan || !plan.showHeader) return;
        const { s, combined, width, strongColor, labelColor, locale } = ctx;
        const titleText = s.header.titleText.value && s.header.titleText.value.trim();
        renderHeader(this.contentGroup, combined, {
            width,
            title: titleText || combined.valueName,
            align: s.header.align.value.value as "left" | "center" | "right",
            headline: s.headline.toStyle(),
            stat: s.statChips.toStyle(),
            ruleShow: s.header.ruleShow.value && plan.showHeaderRule,
            ruleColor: s.header.ruleColor.value.value,
            ruleWidth: s.header.ruleWidth.value,
            textColor: strongColor, mutedColor: labelColor,
            showChips: plan.showHeaderChips,
            locale,
        });
    }

    /** Render the calendar grid (single) or small-multiple facets, recording the
     * resulting geometry + cell selection on the context. */
    private drawCalendar(ctx: RenderContext): void {
        const { faceted, input, combined, width, height, gridBase, colors, monthLayout,
            facetLayout, headerH, legendTopH, legendBottomH, insightsH } = ctx;
        const gridOpts = {
            ...gridBase,
            colors,
            width, height: height - legendBottomH - insightsH,
            topOffset: headerH + legendTopH,
        };

        let geo: GridGeometry, cells: CellSel;
        if (faceted) {
            // Small multiples: tile one calendar per category into the content band.
            const top = headerH + legendTopH;
            const region = { x: 0, y: top, w: width, h: height - top - legendBottomH - insightsH - 4 };
            const res = renderFacets(this.contentGroup, input.facets, facetLayout(region));
            geo = res.geo; cells = res.cells;
        } else {
            const res = monthLayout
                ? renderMonthBlocks(this.contentGroup, combined, gridOpts)
                : renderGrid(this.contentGroup, combined, gridOpts);
            geo = res.geo; cells = res.cells;
        }
        ctx.geo = geo; ctx.cells = cells;
    }

    /** Legend band, hugging the grid content edge. */
    private drawLegend(ctx: RenderContext): void {
        if (!ctx.legendShown) return;
        const { s, geo, drawnDays, colors, labelColor, legendBandH, legendLabels, headerH } = ctx;
        const lg = s.legend;
        const legendPos = lg.position.value.value as "bottom" | "top";
        // Hug the grid content edge (not the canvas edge) so the legend stays
        // attached to the chart even when the grid is shorter than the viewport.
        const legendY = legendPos === "bottom"
            ? geo.marginTop + geo.gridHeight + 8
            : Math.max(headerH + 2, geo.marginTop - legendBandH - 2);
        renderLegend(this.contentGroup, {
            x: geo.marginLeft,
            y: legendY,
            availableWidth: geo.gridWidth,
            align: lg.align.value.value as LegendAlign,
            swatchSize: lg.swatchSize.value,
            gradientLength: lg.gradientLength.value,
            colors, labelColor,
            showLabels: lg.showLabels.value && legendLabels,
            lessLabel: lg.lessLabel.value || "Less",
            moreLabel: lg.moreLabel.value || "More",
            showNoData: lg.showNoData.value && drawnDays.some(d => d.noData),
            noDataSide: lg.noDataSide.value.value as NoDataSide,
            title: lg.title.value,
            textStyle: s.legendText.toStyle(),
        });
    }

    /** No-data hairlines, annotation dots, CVD hatch patterns, and emoji badges —
     * all the per-cell overlays drawn into the badge layer across every panel. */
    private drawCellOverlays(ctx: RenderContext): void {
        const { s, drawnDays, dark } = ctx;
        // No-data cells get a subtle inset outline so empty days read as "empty",
        // never as a value — independent of the chosen palette (DECISION 3).
        // Annotated days get a corner dot so notable days are visible at a glance
        // (the note itself surfaces in the tooltip). Runs across every panel.
        for (const d of drawnDays) {
            if (d.noData) drawNoDataHairline(this.badgeGroup, cellBox(d), dark);
            else if (d.annotation) drawAnnotationDot(this.badgeGroup, cellBox(d));
        }

        // Day badges — emoji on notable days (peak / threshold) across every panel.
        // Accessibility - CVD-safe hatch on threshold-breach cells (a non-color cue,
        // independent of the emoji badge). Uses its own threshold value so the pattern
        // can be shown without enabling the emoji badge (Z-105b decoupling).
        // TODO Z-110/Z-106: visual verification of the hatch pattern pending Desktop.
        if (s.accessibility.patternOnThreshold.value) {
            const patThr = s.accessibility.patternThresholdValue.value;
            for (const d of drawnDays) if (d.value != null && d.value >= patThr) drawThresholdPattern(this.badgeGroup, cellBox(d), dark);
        }
        const bs = s.badges;
        if (bs.peakOn.value || bs.thresholdOn.value) {
            let peak: DayCell | undefined; let peakVal = -Infinity;
            for (const d of drawnDays) if (d.value != null && d.value > peakVal) { peakVal = d.value; peak = d; }
            if (bs.thresholdOn.value) {
                const thr = bs.thresholdValue.value;
                const emoji = bs.thresholdEmoji.value || "⚠️";
                for (const d of drawnDays) if (d.value != null && d.value >= thr) drawBadge(this.badgeGroup, cellBox(d), emoji);
            }
            if (bs.peakOn.value && peak) drawBadge(this.badgeGroup, cellBox(peak), bs.peakEmoji.value || "🔥");
        }
    }

    /** Honest "showing N of M" notes (spec §8 — never silently truncate). */
    private drawNotes(ctx: RenderContext): void {
        const { combined, input, faceted, width, geo, labelColor } = ctx;
        const notes: string[] = [];
        if (combined.totalDays > combined.days.length) {
            notes.push(`Showing last ${combined.days.length} of ${combined.totalDays} days`);
        }
        if (faceted && input.totalCategories > input.facets.length) {
            notes.push(`Showing ${input.facets.length} of ${input.totalCategories} groups`);
        }
        notes.forEach((text, i) => {
            this.contentGroup.append("text")
                .attr("x", width - 4)
                .attr("y", geo.marginTop + geo.gridHeight + 16 + i * 13)
                .attr("text-anchor", "end")
                .attr("fill", labelColor)
                .attr("font-family", "Segoe UI, -apple-system, sans-serif")
                .attr("font-size", "10px")
                .text(text);
        });
    }

    /** Premium insights card — docked along the reserved bottom band. */
    private drawInsightsCard(ctx: RenderContext): void {
        const { s, width, height, insightItems, insightsH, labelColor, strongColor } = ctx;
        if (!insightItems.length) return;
        renderInsights(this.contentGroup, insightItems, {
            x: 2, y: height - insightsH + 2, width: width - 4,
            font: "Segoe UI, -apple-system, sans-serif",
            labelColor, textColor: strongColor,
            toneColors: { positive: "#2EA043", negative: "#E5484D", neutral: s.header.ruleColor.value.value || "#7C5CFF" },
        });
    }

    /** Auto-place the gear in a corner clear of content (header / grid / legend / insights). */
    private placeToolbar(ctx: RenderContext): void {
        const { s, width, height, geo, headerH, legendShown, legendBandH, insightsH } = ctx;
        const legendPos = s.legend.position.value.value as "bottom" | "top";
        const contentRects: number[][] = [];
        if (headerH > 0) contentRects.push([0, 0, width, headerH]);
        contentRects.push([geo.marginLeft, geo.marginTop, geo.gridWidth, geo.gridHeight]);
        if (legendShown) {
            const lY = legendPos === "bottom" ? geo.marginTop + geo.gridHeight + 2 : Math.max(headerH, geo.marginTop - legendBandH - 2);
            contentRects.push([geo.marginLeft, lY, Math.max(240, geo.gridWidth), legendBandH]);
        }
        if (insightsH > 0) contentRects.push([0, height - insightsH, width, insightsH]);
        this.toolbar.setCorner(pickCorner(width, height, contentRects));
    }

    /** Build the anomaly lookup, set the tooltip context/branding, and wire the
     * cell interaction model (selection / hover / keyboard). */
    private wireTooltipAndInteraction(ctx: RenderContext): void {
        const { s, combined, faceted, drawnDays, cells, colors, dark, insightsOn, polarity, locale } = ctx;
        // Anomaly lookup for the tooltip (top-1 line on flagged days) — overall series.
        let anomalyMap: Map<number, { score: number; direction: "high" | "low"; severity: "moderate" | "strong" }> | undefined;
        if (insightsOn && combined.series) {
            anomalyMap = new Map();
            for (const a of computeAnomalies(combined.series).anomalies) {
                anomalyMap.set(a.date.getTime(), { score: a.score, direction: a.direction, severity: a.severity });
            }
        }
        // Interaction model exposes every drawn cell (all panels in facet mode) while
        // keeping the combined chrome metadata (value/target names, hasToday).
        const interactModel: CalendarModel = faceted ? { ...combined, days: drawnDays } : combined;
        this.tooltip.setContext(interactModel, colors, dark, anomalyMap, polarity, locale);
        this.tooltip.setBranding(s.branding.showBranding.value); // ZENTRIX-BRAND
        // HC: draw rings in the OS foreground color so they stay visible; brand accent otherwise.
        this.ringAccent = ctx.hc ? ctx.strongColor : STATE.accent;
        this.wireInteractions(interactModel, cells, s.accessibility.focusRing.value, locale);
    }

    /** Attach tooltip, selection, hover, and keyboard behaviors to the cells. */
    private wireInteractions(model: CalendarModel, cells: CellSel, focusRingEnabled: boolean, locale: string): void {
        const box = (d: DayCell) => cellBox(d);

        // Today ring (only when today ∈ range). In facet mode today appears in every
        // panel, so ring each matching cell.
        if (model.hasToday) {
            const now = new Date();
            const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            for (const d of model.days) {
                if (d.date.getTime() === todayKey) drawTodayRing(this.todayGroup, box(d), this.ringAccent);
            }
        }

        // Selection state: dim cross-highlight + selected rings. When the host has
        // supplied a highlights[] array (another visual is cross-highlighting us) and
        // the user has made no manual selection, honor that highlight dim instead —
        // reusing the same opacity treatment (DECISION: host highlight ⊃ idle state).
        const applyState = () => {
            const isSelected = syncSelectionState(cells, this.selectionManager);
            if (model.hasHighlights && !this.selectionManager.hasSelection()) applyHighlight(cells);
            this.selectedGroup.selectAll("*").remove();
            cells.each((d) => { if (isSelected(d)) drawSelectedRing(this.selectedGroup, box(d), this.ringAccent); });
            this.syncAriaSelected(cells, isSelected);
        };
        // Always reflect persisted selection + host highlight (display-only, safe in
        // read-only / edit mode). The cross-filter *inputs* are gated below.
        applyState();

        // Hover ring (transient overlay — no reflow) + custom Zentrix tooltip. Hover
        // is display-only (no report state change) so it stays on even when the host
        // disables interactions.
        cells
            .on("mouseenter", (e: MouseEvent, d: DayCell) => {
                this.hoverGroup.selectAll("*").remove();
                drawHoverRing(this.hoverGroup, box(d), this.ringAccent);
                this.tooltip.show(d, e.clientX, e.clientY);
            })
            .on("mousemove", (e: MouseEvent) => this.tooltip.move(e.clientX, e.clientY))
            .on("mouseleave", () => {
                this.hoverGroup.selectAll("*").remove();
                this.tooltip.hide();
            });

        // Cross-filter inputs (click-select, keyboard nav/select, context menu) only
        // when the host permits interactions — skipped in read-only / advanced edit.
        if (this.interactive) this.bindCrossFilter(model, cells, applyState, focusRingEnabled, locale);
    }

    /** Wire the cross-filter *inputs* — click-select, keyboard navigation/select,
     * and the keyboard/right-click context menu. Gated by this.interactive so the
     * host's allowInteractions / advanced-edit signal is honored. */
    private bindCrossFilter(
        model: CalendarModel, cells: CellSel, applyState: () => void,
        focusRingEnabled: boolean, locale: string,
    ): void {
        bindSelection(cells, this.selectionManager, applyState);
        bindKeyboard({
            cells, model, valueName: model.valueName, locale,
            onActivate: (d, multi) => {
                if (!d.selectionId) return;
                this.selectionManager.select(d.selectionId, multi).then(applyState);
            },
            onClear: () => this.selectionManager.clear().then(applyState),
            onContextMenu: (d, node) => {
                // Same host menu as right-click, anchored at the focused cell so the
                // menu opens where the keyboard user is (rect.left / rect.bottom).
                const rect = node.getBoundingClientRect();
                this.selectionManager.showContextMenu(
                    d.selectionId ?? ({} as powerbi.visuals.ISelectionId),
                    { x: rect.left, y: rect.bottom });
            },
            drawFocus: (d) => {
                this.focusGroup.selectAll("*").remove();
                if (d && focusRingEnabled) drawFocusRing(this.focusGroup, cellBox(d), this.ringAccent);
            },
        });
    }

    /** ARIA: reflect each cell's selection state for assistive tech (role="grid"
     * wrapper is set in the constructor on the content group). */
    private syncAriaSelected(cells: CellSel, isSelected: (d: DayCell) => boolean): void {
        cells.attr("aria-selected", d => (isSelected(d) ? "true" : "false"));
    }

    /** Determine whether the required roles are present; null = ready to render. */
    private checkRoles(dataView: DataView | undefined): EmptyReason | null {
        const cat = dataView && dataView.categorical;
        const hasDate = !!(cat && cat.categories &&
            cat.categories.some(c => c.source.roles && c.source.roles["date"]));
        const hasValue = !!(cat && cat.values &&
            cat.values.some(v => v.source.roles && v.source.roles["value"]));

        if (!hasDate && !hasValue) return "noData";
        if (!hasDate) return "missingDate";
        if (!hasValue) return "missingValue";
        return null;
    }

    private renderEmptyState(reason: EmptyReason, w: number, h: number): void {
        const messages: Record<EmptyReason, string> = {
            noData: "Add a Date field and a Value field to build the calendar",
            missingDate: "Add a Date field — it sets the day axis",
            missingValue: "Add a Value field — it drives the color intensity",
        };
        this.renderMessage(messages[reason], w, h, "#70707F");
    }

    private renderMessage(text: string, w: number, h: number, color: string): void {
        this.contentGroup.append("text")
            .attr("x", w / 2)
            .attr("y", h / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("fill", color)
            .attr("font-family", "Segoe UI, -apple-system, sans-serif")
            .attr("font-size", "13px")
            .text(text);
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}
