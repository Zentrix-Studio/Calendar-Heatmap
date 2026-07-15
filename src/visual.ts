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
import { renderGrid, CellSel, GridGeometry, predictGridSize } from "./render/grid";
import { renderMonthBlocks, predictMonthBlocksSize } from "./render/monthBlocks";
import { renderFacets, predictFacetSize } from "./render/facets";
import { renderHeader } from "./render/header";
import { planChrome } from "./render/responsive";
import { renderLegend, LegendAlign, NoDataSide } from "./render/legend";
import { renderInsights } from "./render/insights";
import { computeInsights, computeAnomalies, DEFAULT_INSIGHT_CONFIG, Polarity } from "./insights";
import {
    cellBox, drawTodayRing, drawHoverRing, drawSelectedRing, drawFocusRing, drawBadge, drawNoDataHairline,
    drawRuleOutline,
} from "./render/states";
import { renderAnnotations, NoteAnchor } from "./render/annotations";
import { renderSummaryTable } from "./render/summaryTable";
import { drawPattern, PatternStyle } from "./render/patterns";
import { evaluateRules, Rule } from "./render/rules";
import {
    accent as ACCENT_TOKEN, fontFamily as FONT_FAMILY, resolveSurface, HcColors,
} from "./theme/zentrixTokens";
import { bindSelection, syncSelectionState, bindBackgroundContextMenu } from "./interaction/selection";
import { HeatmapTooltip } from "./interaction/tooltip";
import { autoHeaderTitle, dateLabel, dayKey } from "./interaction/dayData";
import { DayDetailPanel, PanelPosition } from "./interaction/detailPanel";
import { bindKeyboard } from "./interaction/keyboard";
import { SettingsOverlay } from "./interaction/settingsPanel";
import { PremiumGate } from "./interaction/license";
import { LandingPage } from "./interaction/landingPage";
import { NoteEditor } from "./interaction/noteEditor";
import { ViewToggle } from "./interaction/viewToggle";
import { NoteStore, cellNoteKey, isMarkerStyle } from "./notes/store";
import type { AnnotationTheme, MarkerStyle, Note, NoteMode } from "./notes/core";

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

/**
 * Resolve the note editor's palette from the token mirror. The shared editor
 * (@zentrix/visual-annotations) takes colors rather than importing tokens — that is
 * what keeps it dependency-free and shareable — so the visual hands them over here.
 */
function noteTheme(dark: boolean, hc: HcColors | null): AnnotationTheme {
    const s = resolveSurface(dark, hc);
    return {
        bg: s.bg, fg: s.fg, muted: s.muted,
        accent: hc ? s.fg : ACCENT_TOKEN,
        line: hc ? s.fg : (dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)"),
        font: FONT_FAMILY,
    };
}

/** Rough perceived-luminance check on a #rrggbb color → true if dark. */
function isDarkColor(hex?: string): boolean {
    if (!hex || hex[0] !== "#" || hex.length < 7) return false;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
}

type Group = Selection<SVGGElement, unknown, null, undefined>;

export class Visual implements IVisual {
    private host: IVisualHost;
    private element: HTMLElement;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    /** One <defs> per render — holds the reusable Z-149 <pattern> defs (cleared
     *  each render alongside the drawing groups). */
    private defsGroup: Selection<SVGDefsElement, unknown, null, undefined>;
    private contentGroup: Group;
    private badgeGroup: Group;
    private annotationGroup: Group;
    private selectedGroup: Group;
    private todayGroup: Group;
    private hoverGroup: Group;
    private focusGroup: Group;

    private selectionManager: ISelectionManager;
    private tooltip: HeatmapTooltip;
    private panel: DayDetailPanel;
    private noteEditor: NoteEditor;
    private toolbar: SettingsOverlay;
    private premium: PremiumGate;
    private landing: LandingPage;
    private viewToggle: ViewToggle;
    private events: IVisualEventService;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    /** Last successful render inputs, replayed on in-visual settings changes. */
    private lastRender?: { render: FacetedRender; width: number; height: number; firstDayOfWeek: number };
    /**
     * Which view fills the canvas while the Summary-table option is ON: the table
     * (default) or the calendar. Flipped by the bottom-right ViewToggle. Session-
     * local on purpose — it must work for report READERS in Reading view, where a
     * persistProperties write would not survive. Re-armed to `true` whenever the
     * option is off, so turning it on always opens on the table.
     */
    private tableView = true;
    /** Cell element that opened the detail panel — focus returns here on Esc/close. */
    private panelOrigin: SVGElement | null = null;

    /** Author-written annotations (Z-152), hydrated from the persisted blob each update(). */
    private notes = new NoteStore();
    /**
     * The store JSON we last persisted but the host has not yet echoed back. Same
     * contract as SettingsOverlay's `pending` map: persistProperties → host →
     * update() is async and unreliable for a freshly-written property, so a stale
     * update() must not revert an edit the user can already see.
     */
    private pendingNotes: string | null = null;
    /**
     * Authoring context (Edit / focus-in-edit). Annotations are author-only:
     * persistProperties writes visual metadata, which only survives a report save.
     * Reading view renders notes and reveals them on hover; it never offers to add.
     */
    private authoring = true;
    /** In-flight callout drag, or null. Window-level so the pointer can leave the box. */
    private calloutDrag: {
        note: Note; startX: number; startY: number; dx0: number; dy0: number; ps: number; moved: boolean;
    } | null = null;
    /** The drag that just ended actually moved → swallow the click it produces.
     *  Cleared on the next mousedown, so a drag whose element got replaced mid-drag
     *  (and therefore never fires a click) can't poison the following click. */
    private dragJustMoved = false;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.element = options.element;
        this.formattingSettingsService = new FormattingSettingsService();
        this.selectionManager = this.host.createSelectionManager();
        this.events = this.host.eventService;
        this.tooltip = new HeatmapTooltip(options.element);
        // Persistent day-detail panel (Z-145). Closing it clears the cross-filter
        // (DD-2: panel and selection are unified) and restores focus to the cell.
        this.panel = new DayDetailPanel(options.element, {
            onClose: () => this.closeDetailPanel(),
            onAnnotate: (d) => this.openNoteEditor(d),
        });
        // Annotation editor (Z-152) — the shared @zentrix/visual-annotations editor.
        // Edits are optimistic (repaint from the working copy on every keystroke) and
        // only persisted on commit, so a note is never written to the report half-typed.
        this.noteEditor = new NoteEditor(options.element, noteTheme(false, null), {
            onChange: (note) => { this.notes.upsert(note); this.rerenderFromSettings(); },
            onCommit: (note) => {
                // A note with no text is not a note. Committing an empty one removes it
                // rather than leaving an invisible marker the author can't find again.
                if (note.text.trim()) this.notes.upsert(note);
                else this.notes.remove(note.id);
                this.persistNotes();
            },
            onDelete: (note) => { this.notes.remove(note.id); this.persistNotes(); },
            onClose: () => { /* the canvas repaint is driven by commit/delete */ },
        });
        // The settings overlay mutates the live formatting model optimistically and
        // calls back here so the canvas repaints immediately — no waiting on the async
        // persistProperties → host → update() loop, which is flaky for fresh edits.
        this.toolbar = new SettingsOverlay(options.element, this.host, () => this.rerenderFromSettings());
        // Premium licence gate for the diagnostic insight engine; repaints when the
        // async plan check resolves (free core + premium gate, Phase-8 decision).
        this.premium = new PremiumGate(this.host, () => this.rerenderFromSettings());
        // Onboarding carousel — shown only when nothing is bound (the "noData" state).
        this.landing = new LandingPage(options.element);
        // Visual ⇄ Summary-table switch (bottom-right), shown only while the
        // Summary table option is on. An open note editor is committed first —
        // same contract as the canvas-click handler: the user can already see
        // their text, so discarding it on a view flip would read as data loss.
        this.viewToggle = new ViewToggle(options.element, (mode) => {
            this.noteEditor.commit();
            this.tableView = mode === "table";
            this.rerenderFromSettings();
        });

        this.svg = select(options.element)
            .append("svg")
            .classed("zentrix-heatmap", true)
            .attr("width", "100%")
            .attr("height", "100%");

        // Reusable <pattern> defs (Z-149) — created once, populated per render and
        // referenced by url(#…) fills. Sits before the drawing groups in the DOM.
        this.defsGroup = this.svg.append("defs").classed("zx-pattern-defs", true);
        // Layer order (bottom → top): cells/labels, badges, annotations, selected
        // rings, today, hover, focus. Annotations sit ABOVE the badges (so a callout
        // is never painted over by a CVD hatch) but BELOW the rings, which are
        // transient interaction chrome and must always win.
        this.contentGroup = this.svg.append("g").classed("content", true);
        this.badgeGroup = this.svg.append("g").classed("badges", true);
        this.annotationGroup = this.svg.append("g").classed("annotations", true);
        this.selectedGroup = this.svg.append("g").classed("selected-rings", true);
        this.todayGroup = this.svg.append("g").classed("today-ring", true);
        this.hoverGroup = this.svg.append("g").classed("hover-ring", true);
        this.focusGroup = this.svg.append("g").classed("focus-ring", true);

        // Click on empty canvas clears the cross-filter and closes the detail panel.
        // An open note editor is COMMITTED first, not discarded — the user can see
        // their text on the canvas already (it's applied optimistically), so throwing
        // it away here would read as data loss.
        this.svg.on("click", () => {
            this.noteEditor.commit();
            this.selectionManager.clear();
            this.panel.close();
            this.selectedGroup.selectAll("*").remove();
            this.contentGroup.selectAll<SVGRectElement, DayCell>("rect.cell").attr("fill-opacity", 1);
        });

        // Native right-click menu on the empty canvas (empty-selection context menu).
        bindBackgroundContextMenu(this.svg, this.selectionManager);

        // Callout dragging (Z-152). Bound ONCE at construction, on the window rather
        // than the callout: a drag must keep tracking after the pointer leaves the
        // box, and re-binding these per render would leak a listener per repaint.
        if (typeof window !== "undefined") {
            window.addEventListener("mousemove", (e: MouseEvent) => this.dragCallout(e));
            window.addEventListener("mouseup", () => this.endCalloutDrag());
        }

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

    /** The <defs> selection typed as a GroupSel for the pattern module (Z-149). */
    private get defs(): Group { return this.defsGroup as unknown as Group; }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView: DataView | undefined = options.dataViews && options.dataViews[0];
            this.formattingSettings =
                this.formattingSettingsService.populateFormattingSettingsModel(
                    VisualFormattingSettingsModel, dataView);
            const palette = this.host.colorPalette;
            const dark = !palette.isHighContrast && isDarkColor(palette.background && palette.background.value);
            // In-visual settings are author tools (CEO call): show the gear only in an
            // authoring context (Edit / focus-in-edit), hide it for report consumers in
            // Reading view — where their edits wouldn't persist anyway. viewMode is
            // undefined in some hosts / the preview harness; treat unknown as authoring
            // so we never hide the bar from an author.
            // NB: ViewMode is a const enum with NO runtime value (the package only emits
            // `version`/`schemas`), so we compare the literal (View === 0), typed via a
            // cast rather than referencing powerbi.ViewMode.View — which would be
            // `undefined.View` at runtime and throw.
            const readingView = options.viewMode === (0 as powerbi.ViewMode);
            // Annotation authoring rides the same gate, for the same reason: a note
            // persisted from Reading view would not survive a refresh (see `authoring`).
            this.authoring = !readingView;
            // QA-04: on tiles smaller than the bar's own popover (282px wide) the gear
            // can only overlap the grid, so hide it — resize the tile to author.
            const tooSmallForGear = options.viewport.width < 300 || options.viewport.height < 180;
            this.toolbar.update(this.formattingSettings, dark, readingView || tooSmallForGear);
            this.premium.refresh();

            const viewport = options.viewport;
            this.svg.attr("width", viewport.width).attr("height", viewport.height);
            this.clearLayers();

            // Hydrate the annotation store from the persisted blob (reconciling any
            // optimistic edit the host hasn't echoed back yet).
            this.loadNotes(dataView);

            const reason = this.checkRoles(dataView);
            if (reason) {
                // No data → no view to switch between; the toggle would dangle.
                this.viewToggle.hide();
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
                this.viewToggle.hide();
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
        this.clearLayers();
        this.render(r.render, r.width, r.height, r.firstDayOfWeek);
    }

    /** Wipe every drawing layer. Both render entry points go through here so a new
     *  layer can't be added to one path and forgotten in the other. */
    private clearLayers(): void {
        this.defsGroup.selectAll("*").remove();
        [this.contentGroup, this.badgeGroup, this.annotationGroup, this.selectedGroup,
            this.todayGroup, this.hoverGroup, this.focusGroup]
            .forEach(g => g.selectAll("*").remove());
    }

    // -- annotations (Z-152) -------------------------------------------------

    /**
     * Hydrate the note store from `metadata.objects.notesStore.data`, reconciling
     * against an optimistic edit that the host hasn't confirmed yet. Mirrors
     * SettingsOverlay's pending-edit reconcile: if the host echoes back what we
     * wrote, the edit landed and we drop the pending copy; if it echoes something
     * else, our write is still in flight and the local store must win, or the
     * canvas would visibly revert the note the user just typed.
     */
    private loadNotes(dataView?: DataView): void {
        const objects = dataView?.metadata?.objects as
            { notesStore?: { data?: powerbi.DataViewPropertyValue } } | undefined;
        const raw = objects?.notesStore?.data;
        const json = typeof raw === "string" ? raw : "";
        if (this.pendingNotes != null) {
            if (json === this.pendingNotes) this.pendingNotes = null; // host confirmed
            else return;                                             // in flight → keep ours
        }
        this.notes.load(json);
    }

    /** Write the store through to the report and repaint. */
    private persistNotes(): void {
        const json = this.notes.toJSON();
        this.pendingNotes = json;
        this.host.persistProperties({
            merge: [{ objectName: "notesStore", selector: null, properties: { data: json } }],
        } as powerbi.VisualObjectInstancesToPersist);
        this.rerenderFromSettings();
    }

    /**
     * Drag a callout to reposition it. The offset is stored in CELL-SIZE units, not
     * pixels: `planChrome` rescales cells whenever the viewport changes, so a pixel
     * offset would drift away from its day on every resize. Dividing the pixel delta
     * by the cell size makes the placement hold.
     */
    private dragCallout(e: MouseEvent): void {
        const d = this.calloutDrag;
        if (!d) return;
        const dxPx = e.clientX - d.startX, dyPx = e.clientY - d.startY;
        // A few px of jitter while clicking is not a drag — otherwise every click to
        // open the editor would also nudge the box.
        if (!d.moved && Math.abs(dxPx) + Math.abs(dyPx) < 3) return;
        d.moved = true;
        d.note.dx = d.dx0 + dxPx / d.ps;
        d.note.dy = d.dy0 + dyPx / d.ps;
        this.notes.upsert(d.note);
        this.rerenderFromSettings();
    }

    /** Finish a drag: persist only if the box actually moved. */
    private endCalloutDrag(): void {
        const d = this.calloutDrag;
        this.calloutDrag = null;
        if (!d?.moved) return;
        this.dragJustMoved = true;
        this.persistNotes();
    }

    /** Open the editor for a day — on its existing note, or on a fresh one. */
    private openNoteEditor(d: DayCell): void {
        if (!this.authoring) return;
        const anchor = cellNoteKey(d);
        const existing = this.notes.get(anchor);
        if (!existing && this.notes.isFull()) return;
        const mode = (this.formattingSettings.annotations.defaultMode.value.value as NoteMode);
        const note = existing ?? this.notes.create(anchor, mode);
        this.noteEditor.open(note, dateLabel(d.date), !existing);
    }

    private render(input: FacetedRender, width: number, height: number, firstDayOfWeek: number): void {
        const combined = input.combined;
        const faceted = input.facets.length > 1;
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

        // Summary table — an ALTERNATE VIEW, not a chrome band: while active it
        // fills the whole canvas and the calendar (and all its chrome) does not
        // draw at all. The bottom-right ViewToggle flips `tableView` and repaints
        // through rerenderFromSettings, so the flip works in Reading view too.
        const summaryOn = s.summaryTable.show.value;
        if (!summaryOn) this.tableView = true; // re-arm: enabling always opens on the table
        const hcColorsForOverlay = hc
            ? { background: palette.background.value, foreground: palette.foreground.value }
            : null;
        if (summaryOn) this.viewToggle.show(this.tableView ? "table" : "visual", dark, hcColorsForOverlay);
        else this.viewToggle.hide();
        if (summaryOn && this.tableView) {
            // Cell-anchored surfaces can't survive without cells.
            this.panel.close();
            this.tooltip.hide();
            renderSummaryTable(this.contentGroup, input, {
                width, height, labelColor, strongColor,
                accentColor: hc ? palette.foreground.value : ACCENT_TOKEN,
                valueName: combined.valueName,
                categoryName: input.categoryName,
            });
            // The table + the ViewToggle own the bottom of the canvas; park the
            // gear top-right so the two floating controls never collide.
            this.toolbar.setCorner("tr");
            return;
        }
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

        // Legend band reservation (top or bottom). Left/Right (vertical) is a
        // follow-up — it needs the grid to reserve side-width.
        const lg = s.legend;
        const legendOn = lg.show.value;
        const legendPos = lg.position.value.value as "bottom" | "top";
        const legendSwatch = lg.swatchSize.value;
        const legendBandH = legendOn ? Math.max(legendSwatch, s.legendText.toStyle().size) + 12 : 0;
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
        const INSIGHT_LINE_H = 18, INSIGHT_OVERHEAD = 24;

        // Base grid options shared by the predictor and the real render. Heights /
        // top-offset are filled in once the responsive planner has decided which
        // chrome bands survive (see below).
        const gridBase = {
            cellSize: s.cells.cellSize.value,
            gapX: s.cells.cellGapX.value,
            gapY: s.cells.cellGapY.value,
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
        const facetLayout = (region: { x: number; y: number; w: number; h: number }) => ({
            region,
            columns: Math.max(0, Math.round(s.smallMultiples.columns.value)),
            monthLayout,
            titleStyle: s.facetTitle.toStyle(),
            titleColor: strongColor,
            gridBase,
            colorsFor,
        });

        // The KPI header, legend, and insights bands all compete with the grid for
        // space. Rather than reserving them unconditionally (which forced cells to a
        // 3px floor on small canvases), predict the cell size for a given chrome
        // reservation and let the planner shed the lowest-priority band first.
        const HEADER_H = 42; // renderHeader's fixed band height
        const headerRequested = s.labels.showHeader.value;
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
            headerH: headerRequested ? HEADER_H : 0,
            legendH: legendOn ? legendBandH : 0,
            legendTop: legendPos === "top",
            insightsCount: insightItemsAll.length,
            insightsLineH: INSIGHT_LINE_H,
            insightsOverhead: INSIGHT_OVERHEAD,
            predict,
            floor: 7,
        });

        // Resolve the surviving bands from the plan.
        const headerH = plan.showHeader ? HEADER_H : 0;
        const legendShown = plan.showLegend;
        const legendTopH = legendShown && legendPos === "top" ? legendBandH : 0;
        const legendBottomH = legendShown && legendPos === "bottom" ? legendBandH : 0;
        const insightItems = insightItemsAll.slice(0, plan.insightsCount);
        const insightsH = insightItems.length ? (INSIGHT_OVERHEAD + insightItems.length * INSIGHT_LINE_H) : 0;

        // Draw the KPI header now that the planner has decided its fate (and which
        // of its parts — chips, rule — fit). In facet mode it summarizes the rollup.
        if (plan.showHeader) {
            const titleText = s.header.titleText.value && s.header.titleText.value.trim();
            // Auto title (blank Title text): "<Value> by <Split-by>", else the value
            // field name (issue #2). This in-canvas title is the product title; authors
            // are told to turn off Power BI's own title to avoid a duplicate.
            const autoTitle = autoHeaderTitle(combined.valueName, input.categoryName);
            renderHeader(this.contentGroup, combined, {
                width,
                title: titleText || autoTitle,
                align: s.header.align.value.value as "left" | "center" | "right",
                headline: s.headline.toStyle(),
                stat: s.statChips.toStyle(),
                ruleShow: s.header.ruleShow.value && plan.showHeaderRule,
                ruleColor: s.header.ruleColor.value.value,
                ruleWidth: s.header.ruleWidth.value,
                textColor: strongColor, mutedColor: labelColor,
                showChips: plan.showHeaderChips,
            });
        }

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

        if (legendShown) {
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
                swatchSize: legendSwatch,
                gradientLength: lg.gradientLength.value,
                colors, labelColor,
                showLabels: lg.showLabels.value && plan.legendLabels,
                lessLabel: lg.lessLabel.value || "Less",
                moreLabel: lg.moreLabel.value || "More",
                showNoData: lg.showNoData.value && drawnDays.some(d => d.noData),
                noDataSide: lg.noDataSide.value.value as NoDataSide,
                title: lg.title.value,
                textStyle: s.legendText.toStyle(),
            });
        }

        // No-data cells get a subtle inset outline so empty days read as "empty",
        // never as a value — independent of the chosen palette (DECISION 3).
        for (const d of drawnDays) {
            if (d.noData) drawNoDataHairline(this.badgeGroup, cellBox(d), dark);
        }

        // Day badges — emoji on notable days (peak / threshold) across every panel.
        // Accessibility - CVD-safe hatch on threshold-breach cells (a non-color cue,
        // independent of the emoji badge). Uses its own threshold value so the pattern
        // can be shown without enabling the emoji badge (Z-105b decoupling).
        // TODO Z-110/Z-106: visual verification of the hatch pattern pending Desktop.
        if (s.accessibility.patternOnThreshold.value) {
            const patThr = s.accessibility.patternThresholdValue.value;
            const patStyle = (s.accessibility.patternStyle.value.value as PatternStyle) || "diagonal";
            for (const d of drawnDays) if (d.value != null && d.value >= patThr) drawPattern(this.defs, this.badgeGroup, cellBox(d), dark, patStyle);
        }
        const bs = s.badges;

        // ONE badge per cell. A day can satisfy the peak, the legacy threshold and a
        // rule simultaneously; drawing each source independently stacked 2–3 emoji at
        // the same cell centre (drawBadge centres its glyph), which renders as
        // unreadable overlapping mush rather than as a badge. So the sources bid into
        // this map and the winner is drawn once, after all of them have bid.
        // Precedence, least to most specific: threshold < rule < peak.
        const badgeByDay = new Map<DayCell, string>();

        if (bs.thresholdOn.value) {
            const thr = bs.thresholdValue.value;
            const emoji = bs.thresholdEmoji.value || "⚠️";
            for (const d of drawnDays) if (d.value != null && d.value >= thr) badgeByDay.set(d, emoji);
        }

        // Rules list (Z-146) — generalizes the single threshold. Builds ON the same
        // drawBadge/pattern plumbing. Each cue channel is first-match-wins (see
        // evaluateRules). When no rules are enabled this loop is a no-op, so the
        // legacy threshold output stays byte-identical (back-compat — DD-5/§4).
        const activeRules: Rule[] = bs.activeRules();
        const ruleNameByDay = new Map<string, string>();
        if (activeRules.length) {
            for (const d of drawnDays) {
                if (d.noData) continue;
                const hit = evaluateRules(d, activeRules);
                if (!hit.matched.length) continue;
                ruleNameByDay.set(`${d.facetKey ?? ""}|${d.date.getTime()}`, hit.matched[0].name);
                if (hit.colorRule?.color) drawRuleOutline(this.badgeGroup, cellBox(d), hit.colorRule.color);
                if (hit.patternRule?.patternOn) drawPattern(this.defs, this.badgeGroup, cellBox(d), dark, hit.patternRule.patternStyle ?? "diagonal");
                if (hit.badgeRule?.badge) badgeByDay.set(d, hit.badgeRule.badge);
            }
        }

        // Peak bids last — it is the single most specific day on the panel, so its
        // emoji must not be buried under a threshold or rule badge it also satisfies.
        if (bs.peakOn.value) {
            let peak: DayCell | undefined; let peakVal = -Infinity;
            for (const d of drawnDays) if (d.value != null && d.value > peakVal) { peakVal = d.value; peak = d; }
            if (peak) badgeByDay.set(peak, bs.peakEmoji.value || "🔥");
        }

        for (const [d, emoji] of badgeByDay) drawBadge(this.badgeGroup, cellBox(d), emoji);

        // Author-written annotations (Z-152). Notes are keyed by ISO date + facet, so
        // resolving them means matching each stored note against the days actually
        // drawn this render. A note whose day is filtered out or falls outside the
        // rendered window simply isn't drawn — it is NOT garbage-collected, because a
        // transient filter must not destroy the author's work.
        const ann = s.annotations;
        const noteTextByDay = new Map<string, string>();
        if (ann.show.value && this.notes.count()) {
            const cellByAnchor = new Map<string, DayCell>();
            for (const d of drawnDays) cellByAnchor.set(cellNoteKey(d), d);

            const anchors: NoteAnchor[] = [];
            for (const note of this.notes.ordered()) {
                const cell = cellByAnchor.get(note.anchor);
                if (!cell) continue;
                // Numbered markers count over the DRAWN set, so the numbering is
                // contiguous even when some notes are filtered away.
                anchors.push({ note, cell, index: anchors.length + 1 });
                if (note.text.trim()) noteTextByDay.set(dayKey(cell), note.text);
            }

            const styleRaw = ann.markerStyle.value.value;
            const res = renderAnnotations(this.annotationGroup, anchors, {
                markerStyle: (isMarkerStyle(styleRaw) ? styleRaw : "number") as MarkerStyle,
                markerIcon: ann.markerIcon.value || "📌",
                markerColor: ann.markerColor.value.value || ACCENT_TOKEN,
                dark, width, height,
                editable: this.authoring,
            });
            // A callout is directly manipulable while authoring: drag to move it,
            // click to edit it. Both live here rather than in the render module so
            // render/ stays free of host and state concerns.
            if (this.authoring) {
                res.callouts
                    .on("mousedown", (event: MouseEvent, a: NoteAnchor) => {
                        event.stopPropagation();
                        event.preventDefault(); // no text-selection drag-ghost
                        this.dragJustMoved = false;
                        this.calloutDrag = {
                            note: a.note, startX: event.clientX, startY: event.clientY,
                            dx0: a.note.dx, dy0: a.note.dy, ps: a.cell.ps || 12, moved: false,
                        };
                    })
                    .on("click", (event: MouseEvent, a: NoteAnchor) => {
                        event.stopPropagation();
                        // A click that ENDED a drag is a reposition, not a request to
                        // edit — opening the editor there would be maddening.
                        if (this.dragJustMoved) { this.dragJustMoved = false; return; }
                        this.noteEditor.open(a.note, dateLabel(a.cell.date), false);
                    });
            }
        }
        this.tooltip.setNotes(noteTextByDay);
        this.noteEditor.setTheme(noteTheme(dark, hc
            ? { background: palette.background.value, foreground: palette.foreground.value }
            : null));

        // Honest notes (spec §8 — never silently truncate): render-day cap, then facet cap.
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

        // Premium insights card — docked along the reserved bottom band.
        if (insightItems.length) {
            renderInsights(this.contentGroup, insightItems, {
                x: 2, y: height - insightsH + 2, width: width - 4,
                font: "Segoe UI, -apple-system, sans-serif",
                labelColor, textColor: strongColor,
                toneColors: { positive: "#2EA043", negative: "#E5484D", neutral: s.header.ruleColor.value.value || "#7C5CFF" },
            });
        }

        // Auto-place the gear in a corner clear of content (header / grid / legend / insights).
        const contentRects: number[][] = [];
        if (headerH > 0) contentRects.push([0, 0, width, headerH]);
        contentRects.push([geo.marginLeft, geo.marginTop, geo.gridWidth, geo.gridHeight]);
        if (legendShown) {
            const lY = legendPos === "bottom" ? geo.marginTop + geo.gridHeight + 2 : Math.max(headerH, geo.marginTop - legendBandH - 2);
            contentRects.push([geo.marginLeft, lY, Math.max(240, geo.gridWidth), legendBandH]);
        }
        if (insightsH > 0) contentRects.push([0, height - insightsH, width, insightsH]);
        this.toolbar.setCorner(pickCorner(width, height, contentRects));

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
        this.tooltip.setContext(interactModel, colors, dark, anomalyMap, polarity);
        this.tooltip.setRuleNames(ruleNameByDay); // Z-146 — surface matched rule name
        this.tooltip.setBranding(s.branding.showBranding.value); // ZENTRIX-BRAND

        // Day detail panel context (Z-145). HC colors come from the host palette so
        // the panel honors a High-Contrast theme; otherwise themed dark/light tokens.
        const dd = s.dayDetail;
        const hcColors = hc
            ? { background: palette.background.value, foreground: palette.foreground.value }
            : null;
        this.panel.setContext({
            model: interactModel,
            colors,
            dark,
            hc: hcColors,
            polarity,
            position: dd.position.value.value as PanelPosition,
            showTopContributor: dd.showTopContributor.value,
            brandingOn: s.branding.showBranding.value,
            ruleNameByDay, // Z-146 — surface matched rule name in the panel
            noteByDay: noteTextByDay,            // Z-152
            canAnnotate: this.authoring && ann.show.value,
            notesFull: this.notes.isFull(),
        });
        // If the panel is disabled, close it; otherwise re-resolve the open day so it
        // survives this re-render (format edits / resize) — spec §4.1.
        if (!dd.enabled.value) this.panel.close();
        else this.panel.refresh();

        // Annotation entry point. Normally it's the "Add note" button inside the
        // detail panel (which already opens on a cell click). With the panel turned
        // off there'd be no way in, so a click then opens the editor directly.
        const annotateOnClick = !dd.enabled.value && this.authoring && ann.show.value;
        this.wireInteractions(interactModel, cells, s.accessibility.focusRing.value, dd.enabled.value, annotateOnClick);
    }

    /** Close the detail panel, clear the unified selection (DD-2), restore cell focus. */
    private closeDetailPanel(): void {
        this.panel.close();
        this.selectionManager.clear();
        this.selectedGroup.selectAll("*").remove();
        this.contentGroup.selectAll<SVGRectElement, DayCell>("rect.cell").attr("fill-opacity", 1);
        if (this.panelOrigin) { try { this.panelOrigin.focus(); } catch { /* focus best-effort */ } }
    }

    /**
     * Toggle the detail panel for a day (DD-2: panel ⇄ selection are unified).
     * `origin` is the cell element to restore focus to on close. `focusPanel`
     * moves focus into the panel (keyboard path). Returns true if it opened, false
     * if it toggled closed. Selection itself is driven by the caller's `applyState`
     * (click → bindSelection; keyboard → onActivate) so we never double-select.
     */
    private toggleDetailPanel(d: DayCell, origin: SVGElement | null, focusPanel: boolean): boolean {
        const sameDayOpen = this.panel.isOpen() && this.panel.openDayKey() === `${d.facetKey ?? ""}|${d.date.getTime()}`;
        if (sameDayOpen) { this.closeDetailPanel(); return false; }
        this.panelOrigin = origin;
        this.panel.open(d, { focus: focusPanel });
        return true;
    }

    /** Attach tooltip, selection, hover, and keyboard behaviors to the cells. */
    private wireInteractions(
        model: CalendarModel, cells: CellSel, focusRingEnabled: boolean,
        panelEnabled: boolean, annotateOnClick: boolean,
    ): void {
        const box = (d: DayCell) => cellBox(d);

        // Today ring (only when today ∈ range). In facet mode today appears in every
        // panel, so ring each matching cell.
        if (model.hasToday) {
            const now = new Date();
            const todayKey = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            for (const d of model.days) {
                if (d.date.getTime() === todayKey) drawTodayRing(this.todayGroup, box(d));
            }
        }

        // Selection state: dim cross-highlight + selected rings.
        const applyState = () => {
            const isSelected = syncSelectionState(cells, this.selectionManager);
            this.selectedGroup.selectAll("*").remove();
            cells.each((d) => { if (isSelected(d)) drawSelectedRing(this.selectedGroup, box(d)); });
        };

        bindSelection(cells, this.selectionManager, applyState);
        applyState(); // restore persisted selection on re-render

        // Day detail panel — open/toggle on click (DD-2: unified with the selection
        // that bindSelection just drove). Namespaced so it coexists with the
        // selection click handler instead of clobbering it.
        if (panelEnabled) {
            cells.on("click.panel", (event: MouseEvent, d: DayCell) => {
                this.toggleDetailPanel(d, event.currentTarget as SVGElement, false);
            });
        } else if (annotateOnClick) {
            // Panel off → the click IS the annotate gesture (Z-152). Namespaced so it
            // coexists with bindSelection's cross-filter handler rather than replacing it.
            cells.on("click.annotate", (event: MouseEvent, d: DayCell) => {
                event.stopPropagation();
                this.openNoteEditor(d);
            });
        }

        // Hover ring (transient overlay — no reflow) + custom Zentrix tooltip.
        // While the settings bar is open, suppress the hover card + ring so they don't
        // overlap/compete with the menu (issue #7). The persistent day-detail panel is
        // unaffected — it only ever opens on an explicit click/Enter, never on hover.
        cells
            .on("mouseenter", (e: MouseEvent, d: DayCell) => {
                if (this.toolbar.isOpen()) return;
                this.hoverGroup.selectAll("*").remove();
                drawHoverRing(this.hoverGroup, box(d));
                this.tooltip.show(d, e.clientX, e.clientY);
            })
            .on("mousemove", (e: MouseEvent) => {
                if (this.toolbar.isOpen()) return;
                this.tooltip.move(e.clientX, e.clientY);
            })
            .on("mouseleave", () => {
                this.hoverGroup.selectAll("*").remove();
                this.tooltip.hide();
            });

        // Keyboard navigation + ARIA.
        bindKeyboard({
            cells, model, valueName: model.valueName,
            onActivate: (d, multi) => {
                // Enter/Space: drive selection, then open the detail panel and move
                // focus into it (keyboard parity — spec §4.1/§4.3). The focused cell
                // is the active element at activation; remember it for focus-restore.
                const origin = (typeof document !== "undefined"
                    && document.activeElement instanceof SVGElement) ? document.activeElement : null;
                if (d.selectionId) this.selectionManager.select(d.selectionId, multi).then(applyState);
                if (panelEnabled && !multi) this.toggleDetailPanel(d, origin, true);
            },
            onClear: () => this.selectionManager.clear().then(applyState),
            drawFocus: (d) => {
                this.focusGroup.selectAll("*").remove();
                if (d && focusRingEnabled) drawFocusRing(this.focusGroup, box(d));
            },
        });
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
