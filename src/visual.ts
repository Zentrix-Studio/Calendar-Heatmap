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
import { EmptyReason, CalendarModel, DayCell, FacetedRender, HourModel, HourCell } from "./types";
import { buildFacetedModel, buildHourModel, AggregationMode } from "./model/dataTransform";
import {
    buildColorAccessor, ColorAccessor, ScaleMode, PaletteMode, RampPreset, resolvePalette, NO_DATA_DARK, NO_DATA_LIGHT,
} from "./render/colors";
import { renderGrid, CellSel, GridGeometry, predictGridSize } from "./render/grid";
import { renderMonthBlocks, predictMonthBlocksSize } from "./render/monthBlocks";
import { renderFacets, predictFacetSize } from "./render/facets";
import { renderHeader } from "./render/header";
import { planChrome } from "./render/responsive";
import { renderLegend, legendExtent, LegendAlign, NoDataSide } from "./render/legend";
import { renderInsights } from "./render/insights";
import { computeInsights, computeAnomalies, DEFAULT_INSIGHT_CONFIG, Polarity } from "./insights";
import {
    cellBox, drawTodayRing, drawHoverRing, drawSelectedRing, drawFocusRing, drawBadge, drawNoDataHairline,
    drawRuleOutline, applyHighlight,
} from "./render/states";
import { renderAnnotations, NoteAnchor } from "./render/annotations";
import { renderSummaryTable, TableGrain } from "./render/summaryTable";
import { renderInsightView, InsightAction } from "./render/insightView";
import { renderHourGrid, predictHourGridSize, asColorCell, hourLabel, HourGridOptions, HourCellSel } from "./render/hourGrid";
import { drawNonWorking, drawEventMarker, renderEventKey, isWeekend, tintOver, NonWorkingStyle, EventMarker, WeekendSet } from "./render/marks";
import { drawPattern, PatternStyle } from "./render/patterns";
import { rankedDays, filterColors, DayFilterMode } from "./render/dayFilter";
import { setNumberFormat, setFormatLocale, setValueFormat, formatWith, compactScale } from "./render/format";
import { drawCellLabels } from "./render/cellLabels";
import { evaluateRules, Rule } from "./render/rules";
import {
    accent as ACCENT_TOKEN, fontFamily as FONT_FAMILY, resolveSurface, HcColors,
    surfaceElevatedLight, surfaceBase, textPrimary, textPrimaryLight,
} from "./theme/zentrixTokens";
import { bindSelection, syncSelectionState, bindBackgroundContextMenu, bindCanvasContextMenu } from "./interaction/selection";
import { HeatmapTooltip } from "./interaction/tooltip";
import { TooltipRouter, TooltipStyle, HoverContent, dayTooltipItems } from "./interaction/tooltipRouter";
import { autoHeaderTitle, dateLabel, dayKey, formatNum as formatNumber, metricLabel } from "./interaction/dayData";
import { DayDetailPanel, PanelPosition } from "./interaction/detailPanel";
import { bindKeyboard } from "./interaction/keyboard";
import { SettingsOverlay } from "./interaction/settingsPanel";
import { PremiumGate } from "./interaction/license";
import { LandingPage } from "./interaction/landingPage";
import { NoteEditor } from "./interaction/noteEditor";
import { ViewToggle, ViewMode, PILL_STRIP } from "./interaction/viewToggle";
import { ActionBar, ExportFormat, AB_STRIP, AB_TOP, AB_BELOW_GEAR } from "./interaction/actionBar";
import { buildExportTables, toCsv, fileStem, ExportTable } from "./interaction/exportData";
import { fmtNum } from "./render/viewChrome";
import { buildWorkbookBase64, buildPdfBase64 } from "./interaction/exportFiles";
import { captureVisualSnapshot, renderTablePages, PrintTable } from "./interaction/exportSnapshot";
import { NoteStore, cellNoteKey, isMarkerStyle } from "./notes/store";
import type { AnnotationTheme, MarkerStyle, Note, NoteMode } from "./notes/core";

/**
 * Which optional field wells are filled — the `@` data flags the gear's `dimIf` reads
 * (SETTINGS-TAXONOMY "Control conventions"). Read from `metadata.columns`, not from the
 * projection: a role can be bound yet unprojected, and the author has still filled it.
 */
export function boundRoleFlags(dataView: DataView | undefined): Record<string, boolean> {
    const cols = dataView?.metadata?.columns ?? [];
    const has = (role: string) => cols.some(c => Boolean(c.roles?.[role]));
    return {
        hasSplit: has("category"), hasTarget: has("target"), hasHoliday: has("holiday"),
        hasEvent: has("event"), hasEventType: has("eventType"),
    };
}

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

/**
 * Colours › Canvas (HM-V2-20): where the visual's surface comes from. `dark` drives
 * every themed surface (labels, tooltip, panel, Table/Insight); `bg` is the colour
 * painted behind the visual, or null to stay transparent over the report page.
 * "Follow report theme" is the pre-port behaviour, unchanged. High contrast always
 * wins — the host's two colours, nothing of ours.
 */
export function resolveCanvas(
    mode: string, customBg: string, palette: { isHighContrast?: boolean; background?: { value: string } },
): { dark: boolean; bg: string | null } {
    if (palette.isHighContrast) return { dark: false, bg: null };
    if (mode === "light") return { dark: false, bg: resolveSurface(false).bg };
    if (mode === "dark") return { dark: true, bg: resolveSurface(true).bg };
    if (mode === "custom" && /^#[0-9a-fA-F]{6}$/.test(customBg)) return { dark: isDarkColor(customBg), bg: customBg };
    return { dark: isDarkColor(palette.background && palette.background.value), bg: null };
}

type Group = Selection<SVGGElement, unknown, null, undefined>;

/** The colour-palette key the "Theme" palette asks for. The host hands out the theme's
 *  data colours in the order keys are first requested, and the ramp asks first. */
const THEME_ACCENT_KEY = "zentrix-theme-accent";

/**
 * A table as the PDF prints it (zentrix-qa#5): numbers in the Table view's format,
 * percentage columns with their sign, dates as written. Text cells are not escaped —
 * this is a picture, not a spreadsheet.
 */
function printTable(t: ExportTable): PrintTable {
    const head = t.rows[0].map(c => String(c ?? ""));
    const body = t.rows.slice(1);
    const numeric = head.map((_, i) => body.some(r => typeof r[i] === "number"));
    const pct = head.map(h => /%/.test(h));
    return {
        title: t.name, head, numeric,
        rows: body.map(r => r.map((c, i) => (c == null ? "" : typeof c === "number"
            ? (pct[i] ? `${c > 0 ? "+" : ""}${c}%` : fmtNum(c)) : String(c)))),
    };
}

/**
 * The data a cross-highlight leaves (zentrix-qa#12). Another visual highlighting this
 * one — Power BI's default interaction for a visual declaring supportsHighlight — dims
 * the calendar to the highlighted part, but the Table and Insight views kept showing
 * every group's totals. This rebuilds the input from each day's highlight value (a day
 * outside the highlight has no data), so every view answers the same question.
 */
export function highlightedView(input: FacetedRender): FacetedRender {
    const pick = (days: DayCell[]): DayCell[] => days.map(d => {
        const on = !!d.isHighlighted && d.highlightValue != null;
        return { ...d, value: on ? d.highlightValue! : null, noData: !on };
    });
    const combinedDays = pick(input.combined.days);
    const facets = input.facets.map(f => ({ key: f.key, model: { ...f.model, days: pick(f.model.days) } }));
    const combined = {
        ...input.combined,
        days: combinedDays,
        highlighted: true,
        series: input.combined.series && {
            ...input.combined.series,
            data: combinedDays.map(d => ({ date: d.date, value: d.noData ? null : d.value })),
        },
    };
    return {
        ...input, combined, facets,
        // Group statistics come from the panels' own highlight values.
        groups: input.facets.length > 1 ? facets.map(f => ({ key: f.key, days: f.model.days })) : undefined,
    };
}

/** The host download service, typed loosely enough for a host that predates
 *  `exportStatus` (API 4.6) or `exportVisualsContentExtended` (API 5.3). */
interface DownloadServiceLike {
    exportVisualsContent(content: string, fileName: string, fileType: string, fileDescription: string): Promise<boolean>;
    exportVisualsContentExtended?(content: string, fileName: string, fileType: string, fileDescription: string): Promise<{ downloadCompleted: boolean; fileName?: string }>;
    exportStatus?(): Promise<number>;
}

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
    /** Overlays › Tooltip style: card / native / off (HM-V2-20). Every hover goes through it. */
    private tips: TooltipRouter;
    private panel: DayDetailPanel;
    private noteEditor: NoteEditor;
    private toolbar: SettingsOverlay;
    private premium: PremiumGate;
    private landing: LandingPage;
    private viewToggle: ViewToggle;
    /** Top-right quick-action bar — Export (HM-V2-30). */
    private actionBar: ActionBar;
    private events: IVisualEventService;

    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;

    /** Last successful render inputs, replayed on in-visual settings changes. */
    private lastRender?: { render: FacetedRender; width: number; height: number; firstDayOfWeek: number };
    /**
     * Which view fills the canvas: the calendar, the Table or the Insight page.
     * Flipped by the bottom-right Calendar / Table / Insight pill. Session-local on
     * purpose — it must work for report READERS in Reading view, where a
     * persistProperties write would not survive (ledger ST-B). Seeded ONCE per mount
     * from `viewSwitch.defaultView` (HM-V2-01), then left to the reader.
     */
    private viewMode: ViewMode = "visual";
    private viewSeeded = false;
    /** Full-canvas DOM host for the Table / Insight views (hidden in calendar view). */
    private viewHost: HTMLDivElement;
    /** Table row grain — session UI state, kept across re-renders. */
    private tableGrain: TableGrain | undefined;
    /** Durable Table-view UI state (stat cards collapsed), from the `tableState` blob. */
    private tableState: { statsCollapsed?: boolean } | null = null;
    /** tableState JSON persisted but not yet echoed back — same in-flight contract as
     *  `pendingNotes`. */
    private pendingTableState: string | null = null;
    /** The DataView behind `lastRender` — the Hours layout reads raw timestamps from it. */
    private lastDataView?: DataView;
    /** Hours model cache, keyed by the inputs that shape it (HM-V2-12). */
    private hourCache: { dv: DataView; key: string; model: HourModel | null } | null = null;
    /** Hour buckets the reader has cross-filtered (Hours layout). */
    private hourSelected = new Set<HourCell>();
    /** The selection a report bookmark restored (zentrix-qa#1), or null once the user
     *  selects or clears by hand. See `syncSelectionState`. */
    private restoredSelection: powerbi.visuals.ISelectionId[] | null = null;
    /** Every cell the last calendar render drew — resolves an Insight card's day. */
    private lastDrawnDays: DayCell[] = [];
    /** Cell element that opened the detail panel — focus returns here on Esc/close. */
    private panelOrigin: SVGElement | null = null;
    /** UAT-7 — a small-tile gear click switched us into focus mode; open the bar
     *  on the first in-focus update so the click still lands in settings. */
    private pendingFocusOpen = false;
    /** Was the last update in focus mode? Leaving it closes an open settings panel. */
    private wasInFocus = false;

    /** Author-written annotations (Z-152), hydrated from the persisted blob each update(). */
    private notes = new NoteStore();
    /**
     * The store JSON we last persisted but the host has not yet echoed back. Same
     * contract as SettingsOverlay's `pending` map: persistProperties → host →
     * update() is async and unreliable for a freshly-written property, so a stale
     * update() must not revert an edit the user can already see.
     */
    private pendingNotes: string | null = null;
    /** Custom colour blob we last persisted but the host hasn't echoed back — same
     *  in-flight contract as `pendingNotes` (see `syncColors`). */
    private pendingColors: string | null = null;
    /** Last `colors` fill values the host handed us, per property. Lets `syncColors`
     *  tell a fresh native-Format-pane colour edit (value changed) apart from a
     *  stale one, so a pane edit is folded into the blob but a gear edit isn't
     *  clobbered by the pane's old value. */
    private lastPaneColors: Record<string, string> = {};
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
        this.tips = new TooltipRouter(this.tooltip, this.host.tooltipService);
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
        this.toolbar = new SettingsOverlay(options.element, this.host, () => this.rerenderFromSettings(),
            () => this.persistColors());
        // Premium licence gate for the diagnostic insight engine; repaints when the
        // async plan check resolves (free core + premium gate, Phase-8 decision).
        this.premium = new PremiumGate(this.host, () => this.rerenderFromSettings());
        // Onboarding carousel — shown only when nothing is bound (the "noData" state).
        this.landing = new LandingPage(options.element);
        // Calendar / Table / Insight switch (bottom-right, beside the gear). An open
        // note editor is committed first — same contract as the canvas-click
        // handler: the user can already see their text, so discarding it on a view
        // flip would read as data loss.
        this.viewToggle = new ViewToggle(options.element, (mode) => {
            this.noteEditor.commit();
            this.viewMode = mode;
            this.rerenderFromSettings();
        });
        this.viewToggle.onLockedClick = () => this.premium.notifyBlocked();
        // Quick-action bar (HM-V2-30). The host's answer on downloads arrives async; when
        // it changes whether the bar can show, the calendar re-lays out, because the
        // bar's strip is only reserved while the bar is on screen.
        this.actionBar = new ActionBar(options.element,
            this.host as unknown as { downloadService?: powerbi.extensibility.IDownloadService }, {
                onExport: (format) => this.exportData(format),
                onAvailabilityChange: () => this.rerenderFromSettings(),
            });
        // The pill steps aside while the gear's bar is expanded over the same strip.
        this.toolbar.onOpenChange((open) => this.viewToggle.setBarOpen(open));
        this.viewHost = document.createElement("div");
        this.viewHost.className = "zx-alt-view";
        // Above the SVG, below the pill (12), the gear (20) and every popover.
        this.viewHost.style.cssText = "position:absolute;inset:0;z-index:5;display:none";
        options.element.appendChild(this.viewHost);

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
            this.restoredSelection = null;
            this.selectionManager.clear();
            this.panel.close();
            this.selectedGroup.selectAll("*").remove();
            this.contentGroup.selectAll<SVGRectElement, DayCell>("rect.cell").attr("fill-opacity", 1);
            this.hourSelected.clear();
            this.contentGroup.selectAll("rect.hour-cell").attr("fill-opacity", 1);
        });

        // Native right-click menu on the empty canvas (empty-selection context menu).
        bindBackgroundContextMenu(this.svg, this.selectionManager);
        // …and on every HTML region beside the SVG: Table, Insight, pill, gear, bar,
        // day panel, landing page (zentrix-qa#13, cert 1180.2.5).
        bindCanvasContextMenu(options.element, this.selectionManager);
        // Bookmarks (zentrix-qa#1): the host hands a bookmark's selection back here, not
        // through update(). Keep it and repaint; the host already holds the selection,
        // so this only redraws — it never calls select().
        // https://learn.microsoft.com/en-us/power-bi/developer/visuals/bookmarks-support
        try {
            this.selectionManager.registerOnSelectCallback((ids: powerbi.extensibility.ISelectionId[]) => {
                this.restoredSelection = ids as unknown as powerbi.visuals.ISelectionId[];
                this.restoreHourSelection();
                this.rerenderFromSettings();
            });
        } catch { /* a host without bookmark support still renders */ }

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
            // Custom heatmap colours persist as a JSON text blob, NOT the `colors`
            // object's fill properties (the host drops a structural `fill` written
            // via persistProperties; text/enum survive). Apply the blob over the
            // freshly-populated model before anything reads colours.
            this.syncColors(dataView);
            const dark = this.canvas().dark;
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
            // zentrix-qa#35 (family drift): the gear hid under 300×180 — Desktop's default
            // insert size — so a new visual could not be configured without resizing.
            // A small-tile gear click already opens settings in FOCUS MODE (UAT-7, below),
            // so it only steps aside where it would be most of the tile.
            const tooSmallForGear = options.viewport.width < 160 || options.viewport.height < 110;
            this.toolbar.update(this.formattingSettings, dark, readingView || tooSmallForGear, boundRoleFlags(dataView));
            // UAT-7 — tiles too small for the settings popover to make sense: the
            // gear click switches the report into FOCUS MODE instead. The visual
            // fills the canvas, update() re-runs with isInFocus, and the bar
            // auto-opens there so the click still lands in settings. forceOpen
            // bypasses the gate by design; hosts without focus support fall back
            // to opening in place (gate returns false).
            // Threshold: the master+detail popover is ~640px wide and ~430px tall;
            // under that the popover buries the grid (UAT-7 screenshot). 1200×420
            // stays in-place — the popover covering a SHORT tile vertically has
            // always been the normal config UX; it's narrow tiles that break.
            const needsFocusForSettings = !readingView && !options.isInFocus
                && (options.viewport.width < 640 || options.viewport.height < 400);
            this.toolbar.setOpenGate(needsFocusForSettings ? () => {
                try { this.host.switchFocusModeState(true); } catch { return false; }
                this.pendingFocusOpen = true;
                return true;
            } : null);
            // zentrix-qa#22 (QA-STANDARD §2, Sankey L-5): back from focus mode, an open
            // panel must not come back over the now-small calendar.
            if (this.wasInFocus && !options.isInFocus && this.toolbar.isOpen()) this.toolbar.close();            this.wasInFocus = !!options.isInFocus;
            if (options.isInFocus && this.pendingFocusOpen) {
                this.pendingFocusOpen = false;
                this.toolbar.forceOpen();
            }
            this.premium.refresh();
            this.actionBar.refreshAvailability();

            const viewport = options.viewport;
            this.svg.attr("width", viewport.width).attr("height", viewport.height);
            this.clearLayers();

            // Hydrate the annotation store from the persisted blob (reconciling any
            // optimistic edit the host hasn't echoed back yet).
            this.loadNotes(dataView);
            this.hydrateTableState(dataView);

            const reason = this.checkRoles(dataView);
            if (reason) {
                // No data → no view to switch between; the toggle would dangle.
                this.exitAltView();
                this.forgetRender();
                // ALWAYS draw the SVG text guidance first — it cannot fail and
                // guarantees the canvas is never blank even if the (DOM-overlay)
                // landing page throws in the host sandbox.
                this.renderEmptyState(reason, viewport.width, viewport.height);
                if (reason === "noData") {
                    // Nothing bound at all → layer the full onboarding carousel on
                    // top. Guarded so a landing-page error can't blank the visual.
                    try {
                        this.landing.setTheme(dark);
                        this.landing.setSize(viewport.width, viewport.height);
                        this.landing.show();
                        // Family parity (zentrix-qa#35): no gear over the landing page —
                        // there is nothing to configure until a field is bound.
                        this.toolbar.update(this.formattingSettings, dark, true);
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
            // zentrix-qa#19: every surface formats with the Value measure's own format
            // string and the report's locale, set once here before anything draws.
            setFormatLocale(this.host.locale);
            setValueFormat(dataView?.categorical?.values?.find(v => v.source.roles?.["value"])?.source.format);
            const firstDayOfWeek = parseInt(s.dataDisplay.firstDayOfWeek.value.value as string, 10) || 0;
            const aggMode = s.dataDisplay.aggregation.value.value as AggregationMode;
            const render = buildFacetedModel(dataView!, this.host, firstDayOfWeek, aggMode);
            if (!render) {
                this.exitAltView();
                this.forgetRender();
                this.lastDateColumn = dataView?.categorical?.categories?.find(c => c.source.roles?.["date"]);
                this.renderEmptyState(this.dateIsNotDates() ? "notADate" : "noValues", viewport.width, viewport.height);
                this.events.renderingFinished(options);
                return;
            }

            this.lastRender = { render, width: viewport.width, height: viewport.height, firstDayOfWeek };
            this.lastDataView = dataView;
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
    /**
     * Opacity of the days a selection or cross-highlight leaves out (HM-V2-20).
     * Cells › Click & hover: "Dim other days" off → 1 (selection shows by its rings
     * alone); otherwise 1 − strength, strength clamped to 10–95 % so a selection can
     * neither vanish the rest of the year nor become invisible. Default 72 % → 0.28,
     * the pre-port constant (STATE.dimOpacity).
     */
    private dimOpacity(): number {
        const it = this.formattingSettings.interactions;
        if (!it.dimUnselected.value) return 1;
        const pct = Math.min(95, Math.max(10, Number(it.dimStrength.value) || 0));
        return Math.round((1 - pct / 100) * 100) / 100;
    }

    /** The resolved canvas surface for the current settings (see `resolveCanvas`). */
    private canvas(): { dark: boolean; bg: string | null } {
        const c = this.formattingSettings.canvas;
        return resolveCanvas(c.surfaceMode.value.value as string, c.bgFill.value.value, this.host.colorPalette);
    }

    // -- quick-action bar + export (HM-V2-30) ----------------------------------

    /** The bar's own surface: the visual's light / dark card, or the host's two
     *  colours in high contrast. */
    private themeActionBar(dark: boolean, hc: boolean): void {
        const palette = this.host.colorPalette;
        const hcColors = hc ? { background: palette.background.value, foreground: palette.foreground.value } : null;
        const surface = resolveSurface(dark, hcColors);
        const edge = hc ? surface.fg : (dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.10)");
        this.actionBar.setTheme(dark, surface, edge, ACCENT_TOKEN, surfaceElevatedLight, hc);
    }

    /** The corner box the bar occupies, as a pickCorner content rect. */
    private barRect(canvasW: number): number[] {
        return [canvasW - AB_STRIP, 0, AB_STRIP, AB_TOP + 44];
    }

    /** A gear pinned to the top-right takes the bar's corner: start the bar below it. */
    private syncBarTop(): void {
        this.actionBar.setTop(this.toolbar.isVisible() && this.toolbar.corner() === "tr" ? AB_BELOW_GEAR : AB_TOP);
    }

    private downloadService(): DownloadServiceLike | null {
        try {
            const dl = (this.host as unknown as { downloadService?: DownloadServiceLike }).downloadService;
            return dl && typeof dl.exportVisualsContent === "function" ? dl : null;
        } catch { return null; }
    }

    /** Why the host would refuse before a file is built; null = go ahead. `exportStatus`
     *  is API 4.6+; a host without it doesn't pre-screen (Sankey Pro parity). */
    private async exportBlockedReason(dl: DownloadServiceLike): Promise<string | null> {
        if (typeof dl.exportStatus !== "function") return null;
        try {
            const status = await dl.exportStatus();
            if (status === 1 /* NotDeclared */) return "Export isn't declared in this build of the visual.";
            if (status === 2 /* NotSupported */) return "Downloads aren't supported in this Power BI host.";
            if (status === 3 /* DisabledByAdmin */) return "Your Power BI admin has turned off custom-visual downloads.";
            return null;
        } catch { return null; } // advisory — let the real call decide
    }

    /** Hand one file to the host. `exportVisualsContentExtended` (API 5.3+) reports
     *  whether the download completed; the older call resolves a boolean. A falsy
     *  result means the host refused, which must never look like nothing happened. */
    private async sendFile(dl: DownloadServiceLike, content: string, name: string, type: string, desc: string): Promise<boolean> {
        if (typeof dl.exportVisualsContentExtended === "function") {
            const r = await dl.exportVisualsContentExtended(content, name, type, desc);
            return !!r?.downloadCompleted;
        }
        return !!(await dl.exportVisualsContent(content, name, type, desc));
    }

    /**
     * Export the calendar's data as CSV (one file per table), an Excel workbook (one
     * sheet per table) or a PDF (a snapshot of the calendar, then the tables drawn as
     * pages). Files and types follow learn.microsoft.com/power-bi/developer/visuals/
     * file-download-api (csv as text; pdf / xlsx as "base64").
     *
     * Outcomes (zentrix-qa#4): the host's pre-check already ruled out an admin block,
     * so a download that comes back false after it is the user pressing Cancel on Power
     * BI's save prompt. That stops the export — no second prompt for the next file — and
     * says "cancelled", never "refused by your tenant". A throw is a real failure.
     */
    private async exportData(format: ExportFormat): Promise<void> {
        const dl = this.downloadService();
        const r = this.lastRender;
        if (!dl || !r) return;
        const blocked = await this.exportBlockedReason(dl);
        if (blocked) { this.actionBar.flash(blocked); return; }
        const input = r.render;
        const tables = buildExportTables(input, r.firstDayOfWeek, input.categoryName);
        const stem = fileStem(input.combined.valueName);
        const cancelled = "Export cancelled — no file was saved.";
        try {
            if (format === "csv") {
                let saved = 0;
                for (const t of tables) {
                    const ok = await this.sendFile(dl, toCsv(t.rows), `${stem}-${t.name.toLowerCase()}.csv`, "csv", `${t.name} table`);
                    if (!ok) { this.actionBar.flash(saved ? `Export stopped after ${saved} of ${tables.length} files.` : cancelled); return; }
                    saved++;
                }
                this.actionBar.flash(`Downloaded ${tables.length} CSV files.`);
                return;
            }
            if (format === "xlsx") {
                const ok = await this.sendFile(dl, buildWorkbookBase64(tables), `${stem}.xlsx`, "base64", "Calendar data");
                this.actionBar.flash(ok ? `Downloaded ${stem}.xlsx.` : cancelled);
                return;
            }
            const surface = this.canvas();
            const bg = surface.bg ?? resolveSurface(surface.dark).bg;
            const snapshot = await captureVisualSnapshot(this.svg.node() as SVGSVGElement, r.width, r.height, bg);
            const light = resolveSurface(false);
            const pages = renderTablePages(tables.map(printTable), {
                bg: light.bg, fg: light.fg, muted: light.muted, rule: light.muted, font: FONT_FAMILY,
            });
            const pdf = buildPdfBase64({
                jpegBase64: snapshot.jpegBase64, imageWidth: snapshot.width, imageHeight: snapshot.height,
                title: "Calendar heatmap",
                footnote: "The day and month tables follow this snapshot.",
                pages,
            });
            const ok = await this.sendFile(dl, pdf, `${stem}.pdf`, "base64", "Calendar snapshot and data");
            this.actionBar.flash(ok ? `Downloaded ${stem}.pdf.` : cancelled);
        } catch {
            this.actionBar.flash("The file couldn't be created in this Power BI host, so nothing was downloaded.");
        }
    }

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

    // -- alternate views (Table / Insight) -----------------------------------

    /** Back to the calendar with the pill and the view host hidden (no-data / empty
     *  states: nothing to switch between). */
    private exitAltView(): void {
        this.viewMode = "visual";
        this.viewToggle.hide();
        this.hideViewHost();
    }

    /**
     * HM-V2-13 — the data went away (fields unbound, no rows): drop every cached render
     * input. `rerenderFromSettings` repaints from `lastRender`, and it is called by the
     * gear, the note editor, the view pill AND the licence check resolving later — so a
     * cache that outlives the data lets any of those resurrect the previous calendar
     * over the empty state (the HeatStreams #83 failure class, inverted).
     */
    private forgetRender(): void {
        this.lastRender = undefined;
        this.lastDataView = undefined;
        this.hourCache = null;
        this.hourSelected.clear();
        this.lastDrawnDays = [];
        this.panel.close();
        this.tips.hide();
        // Nothing to export without data.
        this.actionBar.setWanted(false);
    }

    private hideViewHost(): void {
        if (this.viewHost.style.display === "none") return;
        this.viewHost.textContent = "";
        this.viewHost.style.display = "none";
    }

    /** Restore the Table view's UI state from its durable blob, honouring an
     *  in-flight optimistic write exactly like `loadNotes` (Sankey parity). */
    private hydrateTableState(dataView?: DataView): void {
        const obj = (dataView?.metadata?.objects as { tableState?: { data?: unknown } } | undefined)?.tableState;
        const stored = typeof obj?.data === "string" ? obj.data : "";
        if (this.pendingTableState != null) {
            if (stored === this.pendingTableState) this.pendingTableState = null;
            else return; // keep the optimistic state until the host echoes it
        }
        if (!stored) { this.tableState = null; return; }
        try {
            const o = JSON.parse(stored) as { statsCollapsed?: unknown };
            this.tableState = o && typeof o === "object" ? { statsCollapsed: o.statsCollapsed === true } : null;
        } catch { this.tableState = null; }
    }

    /** Table-view UI change (stat cards collapsed/expanded) → persist durably. It is a
     *  non-card blob, so the gear's Reset (removeObject over every card) leaves it. */
    private persistTableState(statsCollapsed: boolean): void {
        this.tableState = { statsCollapsed };
        const blob = JSON.stringify(this.tableState);
        if (blob === this.pendingTableState) return;
        this.pendingTableState = blob;
        this.host.persistProperties({
            merge: [{ objectName: "tableState", selector: null, properties: { data: blob } }],
        } as powerbi.VisualObjectInstancesToPersist);
    }

    /**
     * An Insight card's number was clicked: flip back to the calendar and open that
     * day — a transient, session-local preview (family pattern; never a cross-filter,
     * never a persisted setting). With a Split-by bound the date exists in every
     * panel, so the panel whose value is largest that day is the one opened. A day
     * outside the drawn window (render cap) just lands on the calendar.
     */
    private applyInsightAction(a: InsightAction): void {
        this.viewMode = "visual";
        this.viewToggle.set("visual");
        this.rerenderFromSettings();
        let hit: DayCell | undefined;
        for (const d of this.lastDrawnDays) {
            if (d.date.getTime() !== a.time) continue;
            if (!hit || (d.value ?? -Infinity) > (hit.value ?? -Infinity)) hit = d;
        }
        if (!hit) return;
        this.focusGroup.selectAll("*").remove();
        drawFocusRing(this.focusGroup, cellBox(hit));
        if (this.formattingSettings.dayDetail.enabled.value) {
            this.panelOrigin = null;
            this.panel.open(hit, { focus: false });
        }
    }

    // -- custom colours (blob persistence) -----------------------------------

    /**
     * EVERY ColorPicker slice in the model, keyed by `object.property`. The host
     * drops a structural `fill` written via persistProperties for ALL of them —
     * not just the palette — so the heatmap colours, all text-style colours, the
     * three rule colours, the header rule colour and the annotation marker colour
     * all persist through the blob. Rule colours live in `badges.slices` (flattened
     * by RuleSlot.slices()), so a flat walk of each card's slices reaches them.
     */
    private colorSlices(): { key: string; obj: string; prop: string; slice: { value: { value: string } } }[] {
        const out: { key: string; obj: string; prop: string; slice: { value: { value: string } } }[] = [];
        const cards = this.formattingSettings.cards as
            { name: string; slices?: { name: string; type?: string; value: { value: string } }[] }[];
        for (const card of cards) {
            for (const slice of card.slices ?? []) {
                if (slice.type === "ColorPicker") {
                    out.push({ key: `${card.name}.${slice.name}`, obj: card.name, prop: slice.name, slice });
                }
            }
        }
        return out;
    }

    /**
     * Apply the persisted colour blob over the freshly-populated model, and fold a
     * fresh native-Format-pane colour edit back into the blob so the gear and pane
     * stay in sync. Fills persist here (as text) rather than on the `colors` object,
     * because the host drops a structural `fill` written via persistProperties.
     * Reconciles an in-flight optimistic edit like `loadNotes` does.
     */
    private syncColors(dataView?: DataView): void {
        const objects = dataView?.metadata?.objects as
            Record<string, Record<string, { solid?: { color?: string } } | powerbi.DataViewPropertyValue>> | undefined;
        const raw = objects?.colorStore?.data;
        const blobJson = typeof raw === "string" ? raw : "";
        if (this.pendingColors != null) {
            if (blobJson === this.pendingColors) this.pendingColors = null; // host confirmed
            // else: our write is still in flight → keep applying the pending copy
        }
        const effective = this.pendingColors ?? blobJson;
        let blob: Record<string, string> = {};
        try { blob = effective ? JSON.parse(effective) as Record<string, string> : {}; } catch { blob = {}; }

        let merged = false;
        for (const { key, obj, prop, slice } of this.colorSlices()) {
            // A native-pane fill (host-persisted) for this object/property, if any.
            const paneVal = (objects?.[obj]?.[prop] as { solid?: { color?: string } } | undefined)?.solid?.color;
            const seen = key in this.lastPaneColors;
            const paneChanged = typeof paneVal === "string" && paneVal !== this.lastPaneColors[key];
            if (typeof paneVal === "string") this.lastPaneColors[key] = paneVal;
            if (seen && paneChanged) {
                // The pane fill CHANGED after we'd already recorded it → a fresh native
                // Format-pane edit. It wins and is folded into the durable blob. (A gear
                // edit never changes the pane fill — the host drops it — so it can't be
                // mistaken for this.)
                blob[key] = paneVal as string;
                merged = true;
            } else if (blob[key] == null && typeof paneVal === "string") {
                // No gear-set value yet, but the pane already has one (e.g. first load
                // of a report that only ever used the native pane) → adopt it. When the
                // blob DOES have the key it wins, so a gear edit survives a reload.
                blob[key] = paneVal;
                merged = true;
            }
            if (typeof blob[key] === "string") slice.value = { value: blob[key] };
        }
        if (merged && this.pendingColors == null) this.persistColorBlob(blob);
    }

    /** Snapshot every ColorPicker in the model to the durable blob (called on a gear
     *  colour edit and on Reset). */
    private persistColors(): void {
        const blob: Record<string, string> = {};
        for (const { key, slice } of this.colorSlices()) blob[key] = slice.value.value;
        this.persistColorBlob(blob);
    }

    private persistColorBlob(blob: Record<string, string>): void {
        const json = JSON.stringify(blob);
        this.pendingColors = json;
        this.host.persistProperties({
            merge: [{ objectName: "colorStore", selector: null, properties: { data: json } }],
        } as unknown as powerbi.VisualObjectInstancesToPersist);
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

    private render(input: FacetedRender, canvasW: number, canvasH: number, firstDayOfWeek: number): void {
        const s = this.formattingSettings;
        const combined = input.combined;
        // Labels › Numbers (HM-V2-31) — set before ANY surface formats a number: the
        // Table and Insight views below, the header, tooltip and panel after.
        setNumberFormat(s.labels.displayUnits.value.value as string, s.labels.decimals.value);
        // Hours layout (HM-V2-12) folds every row into weekday × hour: no day cells, and
        // always the all-groups data (a note says so when a Split-by is bound).
        const hoursMode = (s.dataDisplay.layout.value.value as string) === "hours";
        const faceted = input.facets.length > 1 && !hoursMode;
        // The cells actually drawn — one model's days (single) or every panel's (faceted).
        const drawnDays: DayCell[] = hoursMode ? [] : faceted ? input.facets.flatMap(f => f.model.days) : combined.days;
        const palette = this.host.colorPalette;
        const hc = palette.isHighContrast;
        // Colours › Canvas: follow the report theme (auto-detect dark from its
        // background — the default), or pin a Zentrix light / dark / custom surface.
        const surface = this.canvas();
        const dark = surface.dark;
        this.element.style.background = surface.bg ?? "";
        this.tips.setStyle(s.tooltip.type.value.value as TooltipStyle);

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
                // zentrix-qa#31: the theme's first data colour — `foreground` is its TEXT
                // colour, so "Theme" painted grey on every theme. Asked for before any
                // event type, so this key always takes the theme's first colour.
                themeAccent: (typeof palette.getColor === "function" && palette.getColor(THEME_ACCENT_KEY).value)
                    || (palette.foreground && palette.foreground.value) || "#7C5CFF",
                dark,
            });
        const labelColor = hc ? palette.foreground.value : (dark ? "#8A8A99" : "#70707F");
        const strongColor = hc ? palette.foreground.value : (dark ? "#F4F4F6" : "#1A1A22");

        // Table / Insight — ALTERNATE VIEWS, not chrome bands: while one is active it
        // fills the whole canvas and the calendar (and all its chrome) does not draw
        // at all (ST-A). The bottom-right pill flips `viewMode` and repaints through
        // rerenderFromSettings, so the flip works in Reading view too (ST-B).
        const hcColorsForOverlay = hc
            ? { background: palette.background.value, foreground: palette.foreground.value }
            : null;
        const tableOn = s.summaryTable.show.value;
        const insightWanted = s.viewSwitch.insight.value && !!combined.series;
        // Same gate as the insight band (fail-open PremiumGate). Locked = a visible,
        // greyed teaser whose click raises the upgrade banner (NG-274 parity).
        const insightLocked = insightWanted && !this.premium.active;
        // On a tile too small for the gear the pill is pure occlusion; drop it. Between
        // that and a roomy tile it goes icons-only — the family's compact pill (#35).
        const tiny = canvasW < 160 || canvasH < 110;
        this.viewToggle.setCompact(canvasW < 420);
        if (!this.viewSeeded) {
            const want = s.viewSwitch.defaultView.value.value as ViewMode;
            this.viewMode = want === "table" && tableOn ? "table"
                : want === "insight" && insightWanted && !insightLocked ? "insight" : "visual";
            this.viewSeeded = true;
        }
        this.viewToggle.setTheme(dark, hcColorsForOverlay);
        this.viewToggle.setSegments({ table: !tiny && tableOn, insight: !tiny && insightWanted });
        this.viewToggle.setLocked({ insight: insightLocked },
            "Insight is a premium feature. Start your free trial to unlock it here.");
        // A view just switched off (or locked) falls back to the calendar.
        this.viewToggle.set(this.viewMode);
        this.viewMode = this.viewToggle.current();
        const pillShown = this.viewToggle.hasAlternate();
        const gearAuto = (s.toolbar.position.value.value as string) === "auto";

        if (this.viewMode !== "visual") {
            // A cross-highlight from another visual narrows these views too (zentrix-qa#12).
            const highlighting = !!combined.hasHighlights && combined.days.some(d => d.isHighlighted !== undefined);
            if (highlighting) input = highlightedView(input);
            // Cell-anchored surfaces can't survive without cells.
            this.panel.close();
            this.tips.hide();
            this.lastDrawnDays = [];
            // Export is a calendar-view tool, as in every sibling (Sankey: diagram only).
            this.actionBar.setWanted(false);
            const polarity = s.insights.polarity.value.value as Polarity;
            if (this.viewMode === "table") {
                renderSummaryTable(this.viewHost, input, {
                    dark, hc: hcColorsForOverlay,
                    valueName: combined.valueName,
                    categoryName: input.categoryName,
                    firstDayOfWeek,
                    grain: this.tableGrain,
                    onGrainChange: (g) => { this.tableGrain = g; },
                    statsCollapsed: this.tableState?.statsCollapsed,
                    onStatsChange: (collapsed) => this.persistTableState(collapsed),
                });
            } else {
                renderInsightView(this.viewHost, input, {
                    dark, hc: hcColorsForOverlay, polarity,
                    fiscalStartMonth: parseInt(s.timeIntel.fiscalStart.value.value as string, 10) || 1,
                    // zentrix-qa#33: Max insights is the real cap (it was floored at 5, so
                    // 1–4 did nothing) and Show insights off means no findings at all.
                    findings: s.insights.show.value ? Math.min(6, Math.max(1, Math.round(s.insights.count.value))) : 0,
                    weekend: s.nonWorking.weekend.value.value as WeekendSet,
                    onAction: (a) => this.applyInsightAction(a),
                });
            }
            // The gear and the pill share the bottom-right corner as one cluster
            // (the family placement); the gear stays reachable in every view.
            if (gearAuto) this.toolbar.setCorner("br");
            this.viewToggle.setGearAtBr(this.toolbar.isVisible() && this.toolbar.corner() === "br");
            return;
        }
        this.hideViewHost();
        // Quick-action bar (HM-V2-30): calendar view only, and not on a tile under the
        // Sankey's 380×240 floor, where a corner card is pure occlusion. While it shows,
        // the calendar leaves a strip on the right free for it — the pill strip's idea
        // turned sideways — so the bar never sits on a KPI chip, the legend or a day.
        const barWanted = Boolean(s.toolbar.actions.value) && canvasW >= 380 && canvasH >= 240;
        const barShown = this.actionBar.shownIf(barWanted);
        this.actionBar.setWanted(barWanted);
        this.themeActionBar(dark, hc);
        const width = canvasW - (barShown ? AB_STRIP : 0);
        // While the pill is up the calendar leaves the bottom strip free for it (and
        // the gear beside it), so neither ever sits on a day cell. Layout below reads
        // `height`; only the gear corner and the annotation clamp use the full canvas.
        let height = canvasH - (pillShown ? PILL_STRIP : 0);
        const hourModel = hoursMode ? this.getHourModel(firstDayOfWeek) : null;
        if (hoursMode && (!hourModel || !hourModel.hasTime)) {
            // Honest empty state rather than one meaningless midnight column.
            this.panel.close();
            this.tips.hide();
            this.lastDrawnDays = [];
            this.renderMessage(hourModel
                ? "The Hours layout needs a Date field with times of day. This one has dates only."
                : "No rows to place on the hour grid.", width, height, labelColor);
            this.toolbar.setCorner(pillShown && gearAuto ? "br"
                : pickCorner(canvasW, canvasH, barShown ? [this.barRect(canvasW)] : []));
            this.viewToggle.setGearAtBr(this.toolbar.isVisible() && this.toolbar.corner() === "br");
            this.syncBarTop();
            return;
        }
        // No-data is "absence", not a value — defaults to a theme-neutral gray so it
        // can't compete with the ramp. Users may override it via the No-data custom color.
        const noDataOverride = s.colors.noDataColor.value.value;
        const noData = hc ? palette.background.value
            : (/^#[0-9a-fA-F]{6}$/.test(noDataOverride) ? noDataOverride : (dark ? NO_DATA_DARK : NO_DATA_LIGHT));

        // Event marker colour: one per Event type (the host's own theme palette, so it
        // follows the report theme), the brand accent when no type is bound, the
        // foreground in high contrast.
        const eventColorOf = (d: Pick<DayCell, "eventType">): string => {
            if (hc) return palette.foreground.value;
            if (d.eventType && typeof palette.getColor === "function") return palette.getColor(d.eventType).value;
            return ACCENT_TOKEN;
        };
        const colorOpts = {
            mode: s.colors.scaleMode.value.value as ScaleMode,
            buckets: parseInt(s.colors.bucketCount.value.value as string, 10) || 0,
            ramp, noData,
        };
        // Color scale. In single-grid mode this fits the one model. In facet mode the
        // default is a SHARED scale (fit across every panel's day values) so colors are
        // comparable across panels; the user can opt into a per-panel scale instead.
        const sharedScale = !faceted || s.smallMultiples.sharedScale.value;
        // Filter › Top N / Bottom N days (HM-V2-20): days outside the cut paint as
        // no-data. Calendar layouts only — the Hours grid has no days to rank.
        const keepDays = hourModel ? null : rankedDays(drawnDays,
            s.filter.mode.value.value as DayFilterMode, s.filter.count.value);
        const colors = hourModel
            ? buildColorAccessor({ ...combined, days: hourModel.cells.map(asColorCell), valueDomain: hourModel.valueDomain }, colorOpts)
            : filterColors(buildColorAccessor({ ...combined, days: drawnDays, valueDomain: input.sharedDomain }, colorOpts), keepDays);
        const facetColors: ColorAccessor[] = faceted && !sharedScale
            ? input.facets.map(f => filterColors(buildColorAccessor(f.model, colorOpts), keepDays))
            : [];
        const colorsFor = (i: number): ColorAccessor => (sharedScale ? colors : facetColors[i]);

        // Honest notes (spec §8 — never silently truncate): render-day cap, facet cap,
        // field issues, a scale fallback. They get their OWN rows at the bottom of the
        // layout — drawn under the grid they overprinted the legend / event key and hid
        // behind the view pill (zentrix-qa#10, #20, #21).
        const notes: string[] = [];
        if (combined.totalDays > combined.days.length) {
            notes.push(`Showing the last ${combined.days.length} of ${combined.totalDays} days — enlarge or filter to see the rest`);
        }
        if (hoursMode && input.facets.length > 1) {
            notes.push(`Hours layout: all ${input.categoryName ?? "groups"} combined`);
        }
        for (const issue of combined.fieldIssues ?? []) notes.push(issue);
        if (colors.note) notes.push(colors.note); // log → linear fallback, all-equal values
        if (faceted && input.totalCategories > input.facets.length) {
            notes.push(`Showing the ${input.facets.length} largest of ${input.totalCategories} groups`);
        }
        const NOTE_ROW = 13;
        const notesH = notes.length ? notes.length * NOTE_ROW + 4 : 0;
        height -= notesH;

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
        // The read-out lives on the Insight page (view switch) now, so the calendar
        // view no longer reserves a bottom band of insight lines under the grid. The
        // engine still feeds the Insight page and the tooltip's anomaly line.
        const insightItemsAll: ReturnType<typeof computeInsights> = [];
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
            showWeekNumbers: s.labels.showWeekNumbers.value,
            // MVP-B: fiscalStart re-anchors the year bands only when the author has
            // opted into the fiscal layout — by itself it still touches insights only
            // (QA-02's original contract for the bare fiscalStart is preserved).
            fiscalStartMonth: s.timeIntel.fiscalDisplay.value ? fiscalStartMonth : 1,
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
        const hourOpts = (top: number, h: number): HourGridOptions => ({
            width, height: h, topOffset: top,
            cellSize: s.cells.cellSize.value, gapX: s.cells.cellGapX.value, gapY: s.cells.cellGapY.value,
            radius: s.cells.cornerRadius.value, colors, labelColor,
            cellStroke: hc ? palette.foreground.value : undefined,
            weekdayStyle: s.weekdayRail.toStyle(), monthStyle: s.monthRail.toStyle(),
        });
        const predict = (top: number, bottom: number): number => {
            if (hourModel) return predictHourGridSize(hourOpts(top, height - bottom));
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

        let geo: GridGeometry, cells: CellSel | null = null, hourCells: HourCellSel | null = null;
        if (hourModel) {
            const res = renderHourGrid(this.contentGroup, hourModel,
                hourOpts(headerH + legendTopH, height - legendBottomH - insightsH));
            geo = res.geo; hourCells = res.cells;
        } else if (faceted) {
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

        // zentrix-qa#21 — never crop silently. Cells under 1.5px are not a calendar any
        // more: say so instead. Otherwise, if any day still lands outside the box (a
        // layout that can't shrink further), label the visual as cut off.
        if (!hourModel && drawnDays.length) {
            const smallest = drawnDays.reduce((m, d) => Math.min(m, d.ps ?? 0), Infinity);
            if (smallest < 1.5) {
                this.contentGroup.selectAll("*").remove();
                this.panel.close();
                this.lastDrawnDays = [];
                this.renderMessage("Too small to show this calendar — enlarge the visual or filter to fewer days.",
                    width, height, labelColor);
                this.toolbar.setCorner(pillShown && gearAuto ? "br" : pickCorner(canvasW, canvasH, barShown ? [this.barRect(canvasW)] : []));
                this.viewToggle.setGearAtBr(this.toolbar.isVisible() && this.toolbar.corner() === "br");
                this.syncBarTop();
                return;
            }
            const cut = drawnDays.some(d => (d.px ?? 0) + (d.ps ?? 0) > width + 0.5 || (d.py ?? 0) + (d.ps ?? 0) > height + 0.5);
            if (cut) {
                const t = this.contentGroup.append("text").classed("zx-cut-note", true)
                    .attr("x", 4).attr("y", Math.max(12, height - 4))
                    .attr("fill", labelColor).attr("font-family", FONT_FAMILY).attr("font-size", "10px")
                    .attr("font-weight", "600")
                    .text("Some days don't fit — enlarge the visual to see them all");
                t.attr("paint-order", "stroke").attr("stroke", dark ? surfaceBase : surfaceElevatedLight).attr("stroke-width", 3);
            }
        }

        if (legendShown) {
            // Hug the grid content edge (not the canvas edge) so the legend stays
            // attached to the chart even when the grid is shorter than the viewport.
            const legendY = legendPos === "bottom"
                ? geo.marginTop + geo.gridHeight + 8
                : Math.max(headerH + 2, geo.marginTop - legendBandH - 2);
            const legendOpts = {
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
                showNoData: lg.showNoData.value && (hourModel
                    ? hourModel.cells.some(c => c.value == null)
                    : drawnDays.some(d => d.noData)),
                noDataSide: lg.noDataSide.value.value as NoDataSide,
                title: lg.title.value,
                textStyle: s.legendText.toStyle(),
            };
            renderLegend(this.contentGroup, legendOpts);
            // Event-type key (HM-V2-11) shares the legend band, in the free width beside
            // the legend's REAL extent — it used a fixed share of the grid width, so a
            // longer gradient or larger text ran "No data" into it and a third type
            // collapsed to "+1" with space to spare (zentrix-qa#10/#32).
            const types = combined.eventTypes ?? [];
            if (!hourModel && s.events.show.value && s.events.showKey.value && types.length) {
                const align = lg.align.value.value as LegendAlign;
                const ts = s.legendText.toStyle();
                const [l0, l1] = legendExtent(legendOpts);
                const onLeft = align === "end";
                const right = onLeft ? l0 - 16 : width - 4;
                const maxWidth = onLeft ? l0 - 16 - 2 : width - 4 - (l1 + 16);
                renderEventKey(this.contentGroup, {
                    right, y: legendY + legendBandH / 2 - 2, maxWidth, types,
                    colorOf: (t) => eventColorOf({ eventType: t }),
                    labelColor, fontSize: Math.max(9, ts.size - 1), font: ts.family || FONT_FAMILY, bold: ts.bold,
                });
            }
        }

        // No-data cells get a subtle inset outline so empty days read as "empty",
        // never as a value — independent of the chosen palette (DECISION 3).
        for (const d of drawnDays) {
            if (d.noData) drawNoDataHairline(this.badgeGroup, cellBox(d), dark);
        }

        // Weekends + holidays (HM-V2-10): drawn under the badges and markers so a
        // day's emoji / event flag always sits on top of the non-working wash.
        const nw = s.nonWorking;
        const wkSet = nw.weekend.value.value as WeekendSet;
        const nwStyle = nw.style.value.value as NonWorkingStyle;
        const nwInk = hc ? palette.foreground.value : labelColor;
        // Days that end up under the tint wash — the cell labels pick their ink against
        // the washed colour, not the raw one (zentrix-qa#8).
        const tinted = new Set<DayCell>();
        if (nw.shadeWeekends.value || nw.showHolidays.value) {
            for (const d of drawnDays) {
                const off = (nw.shadeWeekends.value && isWeekend(d.date, wkSet)) || (nw.showHolidays.value && !!d.holiday);
                if (!off) continue;
                // A day the Filter KEPT never gets the wash — it would read as one of the
                // faded days. It takes the outline mark instead (zentrix-qa#8).
                const style: NonWorkingStyle = nwStyle === "tint" && keepDays?.has(d) ? "outline" : nwStyle;
                drawNonWorking(this.defs, this.badgeGroup, cellBox(d), style, dark, nwInk, hc);
                if (style === "tint" && !hc) tinted.add(d);
            }
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

        // Labels › Cell values (HM-V2-32) — after the badges, so a badged day keeps its
        // badge (both sit at the centre). A day the Filter faded to no-data has no
        // number to show. Ink is chosen per cell against that cell's own fill.
        if (s.labels.showCellValues.value) {
            const labelOpts = {
                fontSize: Math.min(24, Math.max(6, Number(s.labels.cellValueSize.value) || 10)),
                fontFamily: FONT_FAMILY,
                inkA: hc ? palette.foreground.value : textPrimaryLight,
                inkB: hc ? palette.background.value : textPrimary,
                // Auto = the KPI chips' compact scale (1.2K) — the only one that fits a cell.
                format: (n: number) => formatWith(n, compactScale),
            };
            if (hourModel) {
                drawCellLabels(this.badgeGroup, hourModel.cells, {
                    ...labelOpts, fillOf: c => colors.of(asColorCell(c)),
                });
            } else {
                const facetIndex = new Map(input.facets.map((f, i) => [f.key, i] as [string, number]));
                drawCellLabels(this.badgeGroup, drawnDays, {
                    ...labelOpts,
                    fillOf: d => {
                        const fill = colorsFor(faceted && !sharedScale ? (facetIndex.get(d.facetKey ?? "") ?? 0) : 0).of(d);
                        return tinted.has(d) ? tintOver(fill, dark) : fill;
                    },
                    skip: d => d.noData || badgeByDay.has(d) || (keepDays != null && !keepDays.has(d)),
                });
            }
        }

        // Events from the data (HM-V2-11) — bottom-right corner, clear of the note dot
        // (top-left) and the badge (centre).
        if (s.events.show.value) {
            const marker = s.events.marker.value.value as EventMarker;
            for (const d of drawnDays) {
                if (d.events?.length) drawEventMarker(this.badgeGroup, cellBox(d), marker, eventColorOf(d), d.events.length);
            }
        }

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
                dark, width, height: canvasH,
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

        notes.forEach((text, i) => {
            this.contentGroup.append("text")
                .classed("zx-note", true)
                .attr("x", width - 4)
                .attr("y", height + 2 + (i + 1) * NOTE_ROW - 3)
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
                // Tone dots track the ACTIVE PALETTE so they recolour with the grid:
                // the dot uses the palette's strong high (More) stop by default, and
                // only a negative insight drops to the low (Less) stop. A mid stop
                // reads muddy on a small dot, so neutral shares the high stop. UAT-5:
                // in high contrast every mark maps to the host palette instead.
                toneColors: hc
                    ? { positive: palette.foreground.value, negative: palette.foreground.value, neutral: palette.foreground.value }
                    : (() => {
                        const sw = colors.swatches;
                        const high = sw[sw.length - 1] || strongColor;
                        const low = sw[0] || high;
                        return { positive: high, negative: low, neutral: high };
                    })(),
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
        // The bar's corner is taken too: Auto must not park the gear under it.
        if (barShown) contentRects.push(this.barRect(canvasW));
        // With the pill up, the gear joins it bottom-right in the reserved strip (one
        // control cluster, the family placement); otherwise it avoids content as before.
        this.toolbar.setCorner(pillShown && gearAuto ? "br" : pickCorner(canvasW, canvasH, contentRects));
        this.viewToggle.setGearAtBr(this.toolbar.isVisible() && this.toolbar.corner() === "br");
        this.syncBarTop();
        this.lastDrawnDays = drawnDays;

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
        this.tooltip.setEventColor(s.events.show.value ? eventColorOf : undefined); // HM-V2-11
        this.tooltip.setBranding(s.branding.showBranding.value); // ZENTRIX-BRAND

        // Day detail panel context (Z-145). HC colors come from the host palette so
        // the panel honors a High-Contrast theme; otherwise themed dark/light tokens.
        const dd = s.dayDetail;
        const hcColors = hc
            ? { background: palette.background.value, foreground: palette.foreground.value }
            : null;
        this.panel.setContext({
            eventColorOf: s.events.show.value ? eventColorOf : undefined,
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
            rightInset: barShown ? AB_STRIP : 0,
        });
        // If the panel is disabled, close it; otherwise re-resolve the open day so it
        // survives this re-render (format edits / resize) — spec §4.1.
        if (!dd.enabled.value) this.panel.close();
        else this.panel.refresh();

        // Annotation entry point. Normally it's the "Add note" button inside the
        // detail panel (which already opens on a cell click). With the panel turned
        // off there'd be no way in, so a click then opens the editor directly.
        const annotateOnClick = !dd.enabled.value && this.authoring && ann.show.value;
        if (hourCells && hourModel) {
            // No day under an hour bucket: the day panel and notes don't apply here.
            this.panel.close();
            this.lastDrawnDays = [];
            this.wireHourInteractions(hourCells, hourModel);
        } else if (cells) {
            this.wireInteractions(interactModel, cells, s.accessibility.focusRing.value, dd.enabled.value, annotateOnClick);
        }
    }

    /** Re-mark the Hours buckets a bookmark restored: a bucket is selected when every
     *  row it stands for is in the restored set (its click selects all of them). */
    private restoreHourSelection(): void {
        this.hourSelected.clear();
        const ids = this.restoredSelection;
        const model = this.hourCache?.model;
        if (!ids || !ids.length || !model) return;
        const has = (id: powerbi.visuals.ISelectionId) => ids.some(x => { try { return x.equals(id); } catch { return false; } });
        for (const c of model.cells) {
            if (c.selectionIds.length && c.selectionIds.every(has)) this.hourSelected.add(c);
        }
    }

    /** The Hours model for the current DataView, built once per (data, week start,
     *  aggregate) — it makes a selection id per row, so it is not rebuilt per repaint. */
    private getHourModel(firstDayOfWeek: number): HourModel | null {
        const dv = this.lastDataView;
        if (!dv) return null;
        const agg = this.formattingSettings.dataDisplay.aggregation.value.value as AggregationMode;
        const key = `${firstDayOfWeek}|${agg}`;
        if (this.hourCache && this.hourCache.dv === dv && this.hourCache.key === key) return this.hourCache.model;
        const model = buildHourModel(dv, this.host, firstDayOfWeek, agg);
        this.hourCache = { dv, key, model };
        this.hourSelected.clear();
        if (this.restoredSelection) this.restoreHourSelection(); // a bookmark that arrived first
        return model;
    }

    /**
     * Hours layout interactions: hover → tooltip (bucket, value, row count), click →
     * cross-filter EVERY row in the bucket (Ctrl/⌘ adds), canvas click clears. Each
     * cell carries a spoken label for screen readers.
     */
    private wireHourInteractions(cells: HourCellSel, model: HourModel): void {
        const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const slot = (c: HourCell) => `${WD[c.weekday]} ${hourLabel(c.hour)}–${hourLabel((c.hour + 1) % 24)}`;
        const valueText = (c: HourCell) => (c.value == null ? "no data" : formatNumber(c.value));
        const label = metricLabel(model.valueName, model.aggMode);
        cells.attr("role", "img")
            .attr("aria-label", c => `${slot(c)}: ${label} ${valueText(c)}`);
        const hourTip = (c: HourCell): HoverContent => ({
            card: (x, y) => {
                const lines = [slot(c).toUpperCase(), c.value == null ? "No data" : formatNumber(c.value), label];
                if (c.rows) lines.push(`${c.rows} row${c.rows === 1 ? "" : "s"} in this hour`);
                this.tooltip.showLines(lines, x, y);
            },
            items: () => [
                { displayName: "When", value: slot(c) },
                { displayName: label, value: valueText(c) },
                ...(c.rows ? [{ displayName: "Rows", value: String(c.rows) }] : []),
            ],
            identities: c.selectionIds,
        });

        const paint = () => {
            const any = this.hourSelected.size > 0;
            const dim = this.dimOpacity();
            cells.attr("fill-opacity", c => (!any || this.hourSelected.has(c) ? 1 : dim));
            this.selectedGroup.selectAll("*").remove();
            cells.each((c) => { if (this.hourSelected.has(c)) drawSelectedRing(this.selectedGroup, { x: c.px ?? 0, y: c.py ?? 0, size: c.ps ?? 0 }); });
        };
        paint();

        cells
            .on("click", (e: MouseEvent, c: HourCell) => {
                e.stopPropagation();
                if (!c.selectionIds.length) return;
                const multi = e.ctrlKey || e.metaKey;
                if (!multi) {
                    const only = this.hourSelected.size === 1 && this.hourSelected.has(c);
                    this.hourSelected.clear();
                    if (!only) this.hourSelected.add(c);
                } else if (this.hourSelected.has(c)) this.hourSelected.delete(c);
                else this.hourSelected.add(c);
                const ids = [...this.hourSelected].flatMap(h => h.selectionIds);
                this.restoredSelection = null;
                (ids.length ? this.selectionManager.select(ids, false) : this.selectionManager.clear()).then(paint, paint);
                paint();
            })
            .on("contextmenu", (e: MouseEvent, c: HourCell) => {
                e.preventDefault();
                e.stopPropagation();
                this.selectionManager.showContextMenu(c.selectionIds[0] ?? ({} as powerbi.visuals.ISelectionId), { x: e.clientX, y: e.clientY });
            })
            .on("mouseenter", (e: MouseEvent, c: HourCell) => {
                if (this.toolbar.isOpen()) return;
                this.hoverGroup.selectAll("*").remove();
                drawHoverRing(this.hoverGroup, { x: c.px ?? 0, y: c.py ?? 0, size: c.ps ?? 0 });
                this.tips.show(e, hourTip(c));
            })
            .on("mousemove", (e: MouseEvent, c: HourCell) => { if (!this.toolbar.isOpen()) this.tips.move(e, hourTip(c)); })
            .on("mouseleave", () => { this.hoverGroup.selectAll("*").remove(); this.tips.hide(); });
    }

    /** Close the detail panel, clear the unified selection (DD-2), restore cell focus. */
    private closeDetailPanel(): void {
        this.panel.close();
        this.restoredSelection = null;
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

        // Selection state: dim cross-highlight + selected rings. When the host is
        // cross-highlighting this visual (values[].highlights[]) and the user has made
        // no manual selection, honor that highlight dim instead — same opacity
        // treatment, so host highlight ⊃ idle state (capabilities supportsHighlight).
        const applyState = () => {
            const dim = this.dimOpacity();
            const restored = this.restoredSelection;
            const isSelected = syncSelectionState(cells, this.selectionManager, dim, restored);
            const anySelected = restored ? restored.length > 0 : this.selectionManager.hasSelection();
            if (model.hasHighlights && !anySelected) applyHighlight(cells, dim);
            this.selectedGroup.selectAll("*").remove();
            cells.each((d) => { if (isSelected(d)) drawSelectedRing(this.selectedGroup, box(d)); });
        };

        // A user gesture replaces whatever a bookmark restored.
        const userChange = () => { this.restoredSelection = null; applyState(); };
        bindSelection(cells, this.selectionManager, userChange);
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
        const metric = metricLabel(model.valueName, model.aggMode);
        const dayTip = (d: DayCell): HoverContent => ({
            card: (x, y) => this.tooltip.show(d, x, y),
            items: () => dayTooltipItems(d, metric, model.targetName),
            identities: d.selectionId ? [d.selectionId] : [],
        });
        cells
            .on("mouseenter", (e: MouseEvent, d: DayCell) => {
                if (this.toolbar.isOpen()) return;
                this.hoverGroup.selectAll("*").remove();
                drawHoverRing(this.hoverGroup, box(d));
                this.tips.show(e, dayTip(d));
            })
            .on("mousemove", (e: MouseEvent, d: DayCell) => {
                if (this.toolbar.isOpen()) return;
                this.tips.move(e, dayTip(d));
            })
            .on("mouseleave", () => {
                this.hoverGroup.selectAll("*").remove();
                this.tips.hide();
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
                if (d.selectionId) this.selectionManager.select(d.selectionId, multi).then(userChange);
                if (panelEnabled && !multi) this.toggleDetailPanel(d, origin, true);
            },
            onClear: () => this.selectionManager.clear().then(userChange),
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

    /** The Date-well column of the last empty update (for the empty-state wording). */
    private lastDateColumn?: powerbi.DataViewCategoryColumn;

    private dateFieldName(): string { return this.lastDateColumn?.source.displayName ?? ""; }

    /** True when the Date well has values but none of them is a date (a text column
     *  dropped into it) — a different message from "no rows under this filter". */
    private dateIsNotDates(): boolean {
        const vals = this.lastDateColumn?.values ?? [];
        const present = vals.filter(v => v != null && v !== "");
        if (!present.length) return false;
        return present.every(v => !(v instanceof Date) && (typeof v !== "number") && isNaN(new Date(String(v)).getTime()));
    }

    private renderEmptyState(reason: EmptyReason, w: number, h: number): void {
        const messages: Record<EmptyReason, string> = {
            noData: "Add a Date field and a Value field to build the calendar",
            missingDate: "Add a Date field — it sets the day axis",
            missingValue: "Add a Value field — it drives the colour intensity",
            // zentrix-qa#17: both fields bound is a reader's situation, not an author's —
            // never tell them to add fields that are already there.
            noValues: "No values for the current filters",
            notADate: `${this.dateFieldName() || "The Date field"} isn't a date — bind a date or date/time column`,
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
