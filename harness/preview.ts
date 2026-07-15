/*
 * Standalone preview harness — mounts the real render layer with mock data so
 * renders can be verified outside Power BI (headless-Chrome screenshot).
 * Build: esbuild harness/preview.ts --bundle --outfile=harness/preview.js
 */
import { select } from "d3";
import { enumerateDays, layout, monthLabels } from "../src/model/dateGrid";
import { CalendarModel, DayCell } from "../src/types";
import { buildColorAccessor, ScaleMode, resolvePalette, PaletteSpec, VIOLET_RAMP_LIGHT, VIOLET_RAMP_DARK, NO_DATA_LIGHT, NO_DATA_DARK } from "../src/render/colors";
import { renderGrid } from "../src/render/grid";
import { renderMonthBlocks } from "../src/render/monthBlocks";
import { renderHeader } from "../src/render/header";
import { renderLegend } from "../src/render/legend";
import {
    drawHoverRing, drawSelectedRing, drawFocusRing, drawTodayRing,
    drawNoDataHairline, drawThresholdDot, drawBadge,
} from "../src/render/states";
import { HeatmapTooltip } from "../src/interaction/tooltip";
import { SettingsOverlay } from "../src/interaction/settingsPanel";
import { VisualFormattingSettingsModel } from "../src/settings";

/** Deterministic LCG so screenshots are stable across runs. */
function seeded(seed: number) {
    let s = seed >>> 0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

/** Build a realistic right-skewed year (support-ticket-like) with ~6% gaps. */
function mockModel(year: number, firstDayOfWeek = 0): CalendarModel {
    const days = enumerateDays(new Date(year, 0, 1), new Date(year, 11, 31));
    const { rows, cols, weeks } = layout(days, firstDayOfWeek);
    const labels = monthLabels(days, cols);
    const rnd = seeded(42);

    let vMin = Infinity, vMax = -Infinity;
    const cells: DayCell[] = days.map((date, i) => {
        const weekday = date.getDay();
        const noData = rnd() < 0.06;
        let value: number | null = null;
        if (!noData) {
            const skew = Math.pow(rnd(), 3) * 400;          // long right tail
            const weekendDamp = weekday === 0 || weekday === 6 ? 0.35 : 1;
            value = Math.round(skew * weekendDamp);
            vMin = Math.min(vMin, value);
            vMax = Math.max(vMax, value);
        }
        return {
            date, value, noData,
            col: cols[i], row: rows[i],
            selectionId: null,
            sourceIndex: noData ? -1 : i,
        };
    });

    return {
        days: cells, monthLabels: labels,
        range: [days[0], days[days.length - 1]],
        valueDomain: [vMin, vMax],
        weeks, hasToday: false,
        valueName: "Tickets resolved",
        totalDays: days.length,
    };
}

/** Multi-year mock for the perf/density check. */
function mockModelRange(startYear: number, endYear: number): CalendarModel {
    const days = enumerateDays(new Date(startYear, 0, 1), new Date(endYear, 11, 31));
    const { rows, cols, weeks } = layout(days, 0);
    const labels = monthLabels(days, cols);
    const rnd = seeded(7);
    let vMin = Infinity, vMax = -Infinity;
    const cells: DayCell[] = days.map((date, i) => {
        const value = Math.round(Math.pow(rnd(), 3) * 400);
        vMin = Math.min(vMin, value); vMax = Math.max(vMax, value);
        return { date, value, noData: false, col: cols[i], row: rows[i], selectionId: null, sourceIndex: i };
    });
    return {
        days: cells, monthLabels: labels,
        range: [days[0], days[days.length - 1]],
        valueDomain: [vMin, vMax], weeks, hasToday: false,
        valueName: "Tickets resolved", totalDays: days.length,
    };
}

interface PanelOpts { title: string; dark: boolean; mode: ScaleMode; buckets: number; }

function panel(parent: HTMLElement, p: PanelOpts): void {
    const W = 960, GRID_H = 180, LEGEND_H = 26, H = GRID_H + LEGEND_H;
    const card = document.createElement("div");
    card.style.cssText = `width:${W}px;margin:16px;padding:20px 24px;border-radius:14px;` +
        `background:${p.dark ? "#0F0F16" : "#FFFFFF"};` +
        `box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,-apple-system,sans-serif;`;
    const labelColor = p.dark ? "#8A8A99" : "#70707F";
    const h = document.createElement("div");
    h.textContent = p.title;
    h.style.cssText = `font-weight:600;font-size:15px;margin-bottom:2px;color:${p.dark ? "#F4F4F6" : "#1A1A22"};`;
    const sub = document.createElement("div");
    const scaleLabel = p.buckets >= 2 ? `${p.mode} · ${p.buckets} buckets` : `${p.mode} · continuous`;
    sub.textContent = `per day · 2025 · Zentrix   —   ${scaleLabel}`;
    sub.style.cssText = `font-size:11px;color:#8A8A99;margin-bottom:12px;`;
    card.appendChild(h); card.appendChild(sub); parent.appendChild(card);

    const svg = select(card).append("svg").attr("width", W).attr("height", H);
    const g = svg.append("g");
    const model = mockModel(2025, 0);
    const colors = buildColorAccessor(model, {
        mode: p.mode,
        buckets: p.buckets,
        ramp: p.dark ? VIOLET_RAMP_DARK : VIOLET_RAMP_LIGHT,
        noData: p.dark ? NO_DATA_DARK : NO_DATA_LIGHT,
    });
    const geo = renderGrid(g as any, model, {
        width: W, height: GRID_H, cellSize: 14, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors,
        showMonthLabels: true, showWeekdayLabels: true, labelColor,
    });
    renderLegend(g as any, {
        x: geo.marginLeft,
        y: geo.marginTop + geo.gridHeight + 14,
        gradientWidth: 120,
        colors, labelColor, showNoData: true,
        idSuffix: `${p.mode}-${p.buckets}-${p.dark ? "d" : "l"}`,
    });
}

/** Cell anatomy & states showcase (spec §6). */
function statesPanel(parent: HTMLElement, dark: boolean): void {
    const SIZE = 44, GAP = 120, PAD = 28, TOP = 56;
    const states = ["Default", "Hover", "Selected", "Cross-highlight", "Today", "No data", "Threshold"];
    const W = PAD * 2 + states.length * GAP, H = 150;
    const card = document.createElement("div");
    card.style.cssText = `width:${W}px;margin:16px;padding:20px 24px;border-radius:14px;` +
        `background:${dark ? "#0F0F16" : "#FFFFFF"};box-shadow:0 1px 3px rgba(0,0,0,.12);` +
        `font-family:Segoe UI,-apple-system,sans-serif;`;
    const h = document.createElement("div");
    h.textContent = `Cell anatomy & states — ${dark ? "dark" : "light"}`;
    h.style.cssText = `font-weight:600;font-size:15px;margin-bottom:14px;color:${dark ? "#F4F4F6" : "#1A1A22"};`;
    card.appendChild(h); parent.appendChild(card);

    const svg = select(card).append("svg").attr("width", W).attr("height", H);
    const fill = dark ? "#5A45C2" : "#9B7CF6";
    const noDataFill = dark ? "#1C1C26" : "#E6E6EC";
    const labelColor = dark ? "#8A8A99" : "#70707F";

    states.forEach((name, i) => {
        const x = PAD + i * GAP, y = TOP;
        const g = svg.append("g");
        const box = { x, y, size: SIZE };
        const cellFill = name === "No data" ? noDataFill : fill;
        // dim the cross-highlight sample to 28%
        g.append("rect").attr("x", x).attr("y", y).attr("width", SIZE).attr("height", SIZE)
            .attr("rx", 6).attr("fill", cellFill)
            .attr("fill-opacity", name === "Cross-highlight" ? 0.28 : 1);
        if (name === "Hover") drawHoverRing(g as any, box);
        if (name === "Selected") drawSelectedRing(g as any, box);
        if (name === "Today") { drawTodayRing(g as any, box); drawBadge(g as any, box, "🔥"); }
        if (name === "No data") drawNoDataHairline(g as any, box, dark);
        if (name === "Threshold") { drawThresholdDot(g as any, box); }
        // focus shown alongside default for reference
        if (name === "Default") drawFocusRing(g.append("g") as any, { x: x + 60, y, size: SIZE });

        svg.append("text").attr("x", x).attr("y", y + SIZE + 22)
            .attr("fill", dark ? "#F4F4F6" : "#1A1A22")
            .attr("font-family", "Segoe UI, sans-serif").attr("font-size", "12px")
            .attr("font-weight", "600").text(name);
        if (name === "Default") {
            svg.append("text").attr("x", x + 60).attr("y", y + SIZE + 22)
                .attr("fill", labelColor).attr("font-family", "Segoe UI, sans-serif")
                .attr("font-size", "11px").text("Focus");
        }
    });
}

/** Direction C with the framed KPI header. */
function headerPanel(parent: HTMLElement, dark: boolean): void {
    const W = 960, H = 240;
    const card = document.createElement("div");
    card.style.cssText = `width:${W}px;margin:16px;padding:20px 24px;border-radius:14px;` +
        `background:${dark ? "#0F0F16" : "#FFFFFF"};box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,sans-serif;`;
    parent.appendChild(card);
    const svg = select(card).append("svg").attr("width", W).attr("height", H);
    const g = svg.append("g");
    const model = mockModel(2025, 0);
    const labelColor = dark ? "#8A8A99" : "#70707F";
    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5,
        ramp: dark ? VIOLET_RAMP_DARK : VIOLET_RAMP_LIGHT,
        noData: dark ? NO_DATA_DARK : NO_DATA_LIGHT,
    });
    const headerH = renderHeader(g as any, model, {
        width: W, title: "Support throughput",
        accent: "#7C5CFF", textColor: dark ? "#F4F4F6" : "#1A1A22", mutedColor: labelColor,
    });
    renderGrid(g as any, model, {
        width: W, height: H - 24, cellSize: 14, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor, topOffset: headerH,
    });
}

/** Direction B — month-block layout. */
function monthBlockPanel(parent: HTMLElement, dark: boolean, multiYear = false): void {
    const W = multiYear ? 1240 : 960, H = multiYear ? 640 : 470;
    const card = document.createElement("div");
    card.style.cssText = `width:${W}px;margin:16px;padding:20px 24px;border-radius:14px;` +
        `background:${dark ? "#0F0F16" : "#FFFFFF"};box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,sans-serif;`;
    const h = document.createElement("div");
    h.textContent = multiYear
        ? "Tickets resolved — month blocks, 2-year (year stamped at each January)"
        : "Tickets resolved — month blocks (Direction B)";
    h.style.cssText = `font-weight:600;font-size:15px;margin-bottom:12px;color:${dark ? "#F4F4F6" : "#1A1A22"};`;
    card.appendChild(h); parent.appendChild(card);
    const svg = select(card).append("svg").attr("width", W).attr("height", H);
    const g = svg.append("g");
    const model = multiYear ? mockModelRange(2024, 2025) : mockModel(2025, 0);
    const labelColor = dark ? "#8A8A99" : "#70707F";
    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5,
        ramp: dark ? VIOLET_RAMP_DARK : VIOLET_RAMP_LIGHT,
        noData: dark ? NO_DATA_DARK : NO_DATA_LIGHT,
    });
    renderMonthBlocks(g as any, model, {
        width: W, height: H, cellSize: 16, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: false, labelColor,
    });
}

/** Show the custom tooltip (light + dark) pinned for screenshotting. */
function tooltipShowcase(): void {
    const model = mockModel(2025, 0);
    const byKey = new Map(model.days.map(d => [d.date.getTime(), d]));
    let sample = model.days.find(d => !d.noData)!;
    for (const d of model.days) {
        if (d.noData) continue;
        const prev = new Date(d.date.getFullYear(), d.date.getMonth(), d.date.getDate() - 1);
        const p = byKey.get(prev.getTime());
        if (p && !p.noData && p.value && d.value !== p.value) { sample = d; break; }
    }
    sample.tooltips = [{ name: "SLA Breaches", value: "3" }];
    const colors = buildColorAccessor(model, { mode: "quantile", buckets: 5, ramp: VIOLET_RAMP_LIGHT, noData: NO_DATA_LIGHT });
    const lbl = document.createElement("div");
    lbl.textContent = "Custom tooltip — dot matches hovered cell color (light & dark):";
    lbl.style.cssText = "margin:16px;font:600 15px Segoe UI;color:#1A1A22";
    document.getElementById("root")!.appendChild(lbl);
    const tl = new HeatmapTooltip(document.body); tl.setContext(model, colors, false); tl.show(sample, 180, 150);
    const td = new HeatmapTooltip(document.body); td.setContext(model, colors, true); td.show(sample, 420, 150);
}

/** In-visual settings bar — collapsed, open group row, open dropdown. */
function settingsShowcase(): void {
    const root = document.getElementById("root")!;
    const make = (label: string, open: boolean, group?: string, corner = "bl") => {
        const card = document.createElement("div");
        card.style.cssText = "position:relative;width:760px;height:230px;margin:16px;border-radius:14px;" +
            "background:#EFEFF3;box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,sans-serif;overflow:visible;";
        const l = document.createElement("div");
        l.textContent = label;
        l.style.cssText = "padding:14px;font-weight:600;font-size:14px;color:#1A1A22";
        card.appendChild(l);
        root.appendChild(card);
        const m = new VisualFormattingSettingsModel();
        m.toolbar.position.value = { value: corner, displayName: corner } as any;
        const ov = new SettingsOverlay(card, { persistProperties: () => undefined } as any);
        ov.update(m, false);
        if (open) ov.forceOpen(group);
    };
    make("Settings bar — ‘Scale’ dropdown (crisp text check)", true, "scale");
    make("Settings bar — top-right corner, menu opens DOWN", true, "scale", "tr");
    make("Settings bar — Headline type panel (font · size · B/I/U · color)", true, "headline");
    make("Settings bar — Badges (switch · emoji · stepper)", true, "badges");
    make("Settings bar — Custom colors (color triggers)", true, "custom");
    make("Settings bar — Labels (switch rows) + Legend", true, "legend");
}

/** Palette modes side by side. */
function paletteShowcase(parent: HTMLElement): void {
    const base: PaletteSpec = {
        mode: "ramp", preset: "violet", startColor: "#7C5CFF", endColor: "#1B0F4D",
        splitLow: "#2166AC", splitMid: "#F7F7F7", splitHigh: "#B2182B", themeAccent: "#7C5CFF", dark: false,
    };
    const specs: { title: string; spec: PaletteSpec }[] = [
        { title: "Ramp · Violet", spec: { ...base, mode: "ramp", preset: "violet" } },
        { title: "Ramp · Ocean", spec: { ...base, mode: "ramp", preset: "ocean" } },
        { title: "Ramp · Magma", spec: { ...base, mode: "ramp", preset: "magma" } },
        { title: "Mono · #E5484D", spec: { ...base, mode: "mono", startColor: "#E5484D" } },
        { title: "Duotone · amber→rust", spec: { ...base, mode: "duotone", startColor: "#FFE08A", endColor: "#C2410C" } },
        { title: "Split · blue–white–red", spec: { ...base, mode: "split" } },
    ];
    const card = document.createElement("div");
    card.style.cssText = "width:980px;margin:16px;padding:18px 22px;border-radius:14px;background:#fff;" +
        "box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,sans-serif;";
    const h = document.createElement("div");
    h.textContent = "Color palettes";
    h.style.cssText = "font-weight:600;font-size:15px;margin-bottom:10px;color:#1A1A22";
    card.appendChild(h); parent.appendChild(card);
    const model = mockModel(2025, 0);
    for (const { title, spec } of specs) {
        const t = document.createElement("div");
        t.textContent = title;
        t.style.cssText = "font-size:11px;color:#70707F;margin:8px 0 2px";
        card.appendChild(t);
        const svg = select(card).append("svg").attr("width", 940).attr("height", 86);
        const colors = buildColorAccessor(model, { mode: "quantile", buckets: 0, ramp: resolvePalette(spec), noData: NO_DATA_LIGHT });
        renderGrid(svg.append("g") as any, model, {
            width: 940, height: 86, cellSize: 9, gapX: 1, gapY: 1, radius: 1,
            firstDayOfWeek: 0, colors, showMonthLabels: false, showWeekdayLabels: false, labelColor: "#70707F",
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-127 — LinkedIn Image 3: Palette Flexibility (three mini-grids)
// Canvas: 1200 x 627, 48 px safe margin.  Hash: #palette3
// ─────────────────────────────────────────────────────────────────────────────
function palette3(root: HTMLElement): void {
    const TEXT_COL = "#1A1A22";
    const MUTED = "#70707F";
    const NO_DATA = NO_DATA_LIGHT;

    // Reset body so no host padding/grey shows through
    document.body.style.cssText = "margin:0;padding:0;background:#FFFFFF;";

    const shell = document.createElement("div");
    shell.style.cssText = [
        "width:1200px", "height:627px", "box-sizing:border-box",
        "padding:48px", "background:#FFFFFF",
        "font-family:Segoe UI,-apple-system,sans-serif",
        "display:flex", "flex-direction:column",
        "position:relative", "overflow:hidden",
    ].join(";");
    root.appendChild(shell);

    // Eyebrow
    const eyebrow = document.createElement("div");
    eyebrow.textContent = "ZENTRIX CALENDAR HEATMAP";
    eyebrow.style.cssText = `font-size:11px;letter-spacing:0.12em;color:${MUTED};margin-bottom:6px;font-weight:400;`;
    shell.appendChild(eyebrow);

    // Title
    const title = document.createElement("div");
    title.textContent = "Your data. Your palette.";
    title.style.cssText = `font-size:22px;font-weight:700;color:${TEXT_COL};margin-bottom:4px;line-height:1.2;`;
    shell.appendChild(title);

    // Subtitle
    const subtitle = document.createElement("div");
    subtitle.textContent = "Six presets including a CVD-verified colorblind-safe ramp.";
    subtitle.style.cssText = `font-size:14px;color:${MUTED};margin-bottom:16px;`;
    shell.appendChild(subtitle);

    // Three mini-grid rows
    const rows: { label: string; ramp: string[]; badge?: string; idSuffix: string }[] = [
        { label: "MAGMA  ·  editorial",    ramp: ["#3B0F70","#8C2981","#DE4968","#FE9F6D","#FCFDBF"], idSuffix: "p3-magma" },
        { label: "COLORBLIND-SAFE  ·  CVD-verified (protan / deutan / tritan)", ramp: ["#FFF7BC","#FEC44F","#FE9929","#D95F0E","#993404"], badge: "accessible", idSuffix: "p3-cb" },
        { label: "FOREST  ·  growth & activity", ramp: ["#E8F5E9","#A5D6A7","#66BB6A","#388E3C","#1B5E20"], idSuffix: "p3-forest" },
    ];

    const model = mockModel(2025, 0);
    const W = 1104;
    const MINI_H = 96;

    rows.forEach((row, idx) => {
        // Row label container (with optional badge)
        const labelRow = document.createElement("div");
        labelRow.style.cssText = [
            "display:flex", "align-items:center", "gap:8px",
            idx > 0 ? "margin-top:8px" : "",
        ].filter(Boolean).join(";");

        const labelEl = document.createElement("span");
        labelEl.textContent = row.label;
        labelEl.style.cssText = `font-size:10px;color:${MUTED};letter-spacing:0.1em;font-weight:400;`;
        labelRow.appendChild(labelEl);

        if (row.badge) {
            const badge = document.createElement("span");
            badge.textContent = row.badge;
            badge.style.cssText = [
                "background:#FFF7BC", "border:1px solid #FEC44F",
                "border-radius:9999px", "padding:2px 8px",
                "font-size:10px", "font-weight:600", "color:#993404",
            ].join(";");
            labelRow.appendChild(badge);
        }
        shell.appendChild(labelRow);

        // Legend swatch (inline gradient, right-aligned) + grid SVG
        const gridWrap = document.createElement("div");
        gridWrap.style.cssText = "position:relative;margin-top:4px;";
        shell.appendChild(gridWrap);

        const colors = buildColorAccessor(model, {
            mode: "quantile", buckets: 5, ramp: row.ramp, noData: NO_DATA,
        });
        const svg = select(gridWrap).append("svg").attr("width", W).attr("height", MINI_H);
        renderGrid(svg.append("g") as any, model, {
            width: W, height: MINI_H, cellSize: 9, gapX: 1, gapY: 1, radius: 1,
            firstDayOfWeek: 0, colors, showMonthLabels: false, showWeekdayLabels: false,
            labelColor: MUTED,
        });
    });

    // Optional tagline at bottom
    const tagline = document.createElement("div");
    tagline.textContent = "Free. Maintained. Certification pending.";
    tagline.style.cssText = `font-size:13px;color:${MUTED};margin-top:auto;padding-top:20px;`;
    shell.appendChild(tagline);
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch — hash-based: #palette3 → Z-127 image 3; no hash → full contact sheet
// ─────────────────────────────────────────────────────────────────────────────
const root = document.getElementById("root")!;
const which = (location.hash || "").slice(1);
try {
if (which === "palette3") {
    palette3(root);
} else {
// Full QA contact sheet (default, no hash)
paletteShowcase(root);
tooltipShowcase();
settingsShowcase();
// Before/after: linear-continuous leaves skewed data mostly pale; quantile spreads it.
panel(root, { title: "Tickets resolved — linear (before)", dark: false, mode: "linear", buckets: 0 });
panel(root, { title: "Tickets resolved — quantile, 5 buckets (after)", dark: false, mode: "quantile", buckets: 5 });
panel(root, { title: "Tickets resolved — quantile, 5 buckets", dark: true, mode: "quantile", buckets: 5 });
// Year-banding: multi-year stacks as labeled bands (fixes month-repeat + fills height).
function bandedPanel(parent: HTMLElement, startY: number, endY: number, W: number, H: number, dark: boolean): void {
    const card = document.createElement("div");
    card.style.cssText = `width:${W}px;margin:16px;padding:20px 24px;border-radius:14px;` +
        `background:${dark ? "#0F0F16" : "#FFFFFF"};box-shadow:0 1px 3px rgba(0,0,0,.12);font-family:Segoe UI,sans-serif;`;
    const h = document.createElement("div");
    h.textContent = `${endY - startY + 1}-year — banded by year (container ${H}px tall, vertically centered)`;
    h.style.cssText = `font-weight:600;font-size:15px;margin-bottom:12px;color:${dark ? "#F4F4F6" : "#1A1A22"};`;
    card.appendChild(h); parent.appendChild(card);
    const svg = select(card).append("svg").attr("width", W).attr("height", H);
    const model = mockModelRange(startY, endY);
    const colors = buildColorAccessor(model, {
        mode: "quantile", buckets: 5,
        ramp: dark ? VIOLET_RAMP_DARK : VIOLET_RAMP_LIGHT, noData: dark ? NO_DATA_DARK : NO_DATA_LIGHT,
    });
    renderGrid(svg.append("g") as any, model, {
        width: W, height: H, cellSize: 22, gapX: 3, gapY: 3, radius: 2,
        firstDayOfWeek: 0, colors, showMonthLabels: true, showWeekdayLabels: true,
        labelColor: dark ? "#8A8A99" : "#70707F", strongColor: dark ? "#F4F4F6" : "#1A1A22",
        // demo per-group text styles (verifies font/italic/color flow)
        monthStyle: { family: "Georgia, serif", size: 11, bold: false, italic: true, underline: false, color: "#0E7C86" },
        yearStyle: { family: "Trebuchet MS, sans-serif", size: 14, bold: true, italic: false, underline: false, color: "" },
    });
}
bandedPanel(root, 2024, 2025, 1240, 620, false);  // fullscreen-like: should fill width + center
bandedPanel(root, 2024, 2025, 960, 320, false);   // narrower container
bandedPanel(root, 2021, 2025, 960, 380, true);    // 5-year stack
headerPanel(root, false);
monthBlockPanel(root, false);
monthBlockPanel(root, true);
monthBlockPanel(root, false, true);  // multi-year: confirms the year is stamped at each January
statesPanel(root, false);
statesPanel(root, true);
}
} catch (e) {
    const el = document.getElementById("err");
    if (el) el.textContent = "CAUGHT: " + (e instanceof Error ? e.message + "\n" + e.stack : String(e));
}
