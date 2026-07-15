/*
 * AppSource listing screenshot harness — composes the five 1366×768 carousel
 * images from the REAL shipping Visual (via the vizHUB playground adapter) and
 * the real sample CSVs. One hash per slot:
 *
 *   #hero      Slot 1 — full year, violet ramp, KPI header, today ring
 *   #scale     Slot 2 — quantile vs linear, same data
 *   #insights  Slot 3 — insight card + rich tooltip (tooltip opened by driver)
 *   #interact  Slot 4 — small multiples, selection, day-detail, settings bar
 *   #a11y      Slot 5 — keyboard focus ring / dark + colorblind + hatch
 *
 * Interactions (hover / click / keyboard) are driven by Playwright in
 * screenshot-appsource.js through the window.__* helpers exported below; the
 * driver then calls window.__annotate() to lay the callout bubbles over
 * whatever the real DOM produced.
 *
 * Build: npx esbuild harness/appsource.ts --bundle --outfile=harness/appsource.js
 *        --loader:.less=text --loader:.csv=text
 */
import { mount, MountPayload } from "./playgroundAdapter";
// Real sample data shipped with the product folder.
// @ts-ignore — esbuild text loader
import ticketsCsv from "../../assets/sample-data/sample-tickets-daily.csv";
// @ts-ignore — esbuild text loader
import regionsCsv from "../../assets/sample-data/zentrix-heatmap-sample.csv";

const W = 1366, H = 768;
const FONT = `"Segoe UI",-apple-system,BlinkMacSystemFont,sans-serif`;
const ACCENT = "#7C5CFF";
const TEXT = "#1A1A22", MUTED = "#70707F";
const TEXT_D = "#F4F4F6", MUTED_D = "#8A8A99";

// ── CSV ──────────────────────────────────────────────────────────────────────
interface Row { [k: string]: string }
function parseCsv(text: string): Row[] {
    const lines = text.trim().split(/\r?\n/);
    const head = lines[0].split(",");
    return lines.slice(1).map((l) => {
        const parts = l.split(",");
        const r: Row = {};
        head.forEach((h, i) => (r[h] = parts[i] ?? ""));
        return r;
    });
}
const tickets = parseCsv(ticketsCsv as unknown as string);   // Date, Tickets Resolved, SLA Breaches (2024–2025)
const regions = parseCsv(regionsCsv as unknown as string);   // Date, Region, TicketsResolved, TargetTickets, … (2025)

const isoLocal = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── Shell / chrome ───────────────────────────────────────────────────────────
function shell(): HTMLElement {
    document.body.style.cssText = "margin:0;padding:0;";
    const sh = document.createElement("div");
    sh.id = "shot";
    sh.style.cssText = [
        `width:${W}px`, `height:${H}px`, "box-sizing:border-box", "overflow:hidden",
        "position:relative", "padding:34px 48px 30px",
        "background:linear-gradient(135deg,#F4F3FB 0%,#E8E5F6 100%)",
        `font-family:${FONT}`,
        "display:flex", "flex-direction:column",
    ].join(";");
    document.getElementById("root")!.appendChild(sh);
    return sh;
}

function heading(sh: HTMLElement, title: string, sub?: string): void {
    const eye = document.createElement("div");
    eye.textContent = "ZENTRIX CALENDAR HEATMAP";
    eye.style.cssText = `font-size:11px;letter-spacing:.14em;color:${MUTED};font-weight:600;margin-bottom:4px;`;
    const t = document.createElement("div");
    t.textContent = title;
    t.style.cssText = `font-size:23px;font-weight:700;color:${TEXT};line-height:1.15;`;
    sh.appendChild(eye); sh.appendChild(t);
    if (sub) {
        const s = document.createElement("div");
        s.textContent = sub;
        s.style.cssText = `font-size:13px;color:${MUTED};margin-top:3px;`;
        sh.appendChild(s);
    }
}

interface CardOpts { w?: number; h?: number; dark?: boolean; grow?: boolean; mt?: number; label?: string }
function card(parent: HTMLElement, o: CardOpts = {}): HTMLElement {
    const c = document.createElement("div");
    c.style.cssText = [
        o.w ? `width:${o.w}px` : "width:100%",
        o.h ? `height:${o.h}px` : "",
        o.grow ? "flex:1 1 auto" : "flex:0 0 auto",
        "box-sizing:border-box", `margin-top:${o.mt ?? 14}px`,
        "border-radius:14px", "padding:14px 18px",
        `background:${o.dark ? "#0F0F16" : "#FFFFFF"}`,
        "box-shadow:0 2px 10px rgba(26,26,60,.10)",
        "position:relative", "overflow:hidden",
        "display:flex", "flex-direction:column",
    ].filter(Boolean).join(";");
    parent.appendChild(c);
    if (o.label) {
        const l = document.createElement("div");
        l.textContent = o.label;
        l.style.cssText = `font-size:12px;font-weight:600;color:${o.dark ? MUTED_D : MUTED};margin-bottom:6px;`;
        c.appendChild(l);
    }
    return c;
}

/** Visual container inside a card; returns the element the adapter mounts into. */
function stage(c: HTMLElement, w: number, h: number, center = false): HTMLElement {
    const el = document.createElement("div");
    el.style.cssText = `width:${w}px;height:${h}px;position:relative;flex:0 0 auto;` +
        (center ? "margin:auto 0;" : "");
    c.appendChild(el);
    return el;
}

// ── Callouts ─────────────────────────────────────────────────────────────────
let overlay: SVGSVGElement | null = null;
function ensureOverlay(sh: HTMLElement): SVGSVGElement {
    if (overlay) return overlay;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:4000;overflow:visible;";
    sh.appendChild(svg);
    overlay = svg;
    return svg;
}

interface Pt { x: number; y: number }
/**
 * Anchor point on the bounding box of the idx-th VISIBLE element matching `sel`
 * (fractions 0–1). Skips zero-size matches — the visual mounts a 0×0 defs svg
 * before the real one.
 */
function anchor(sel: string, fx = 0.5, fy = 0.5, root: ParentNode = document, idx = 0): Pt | null {
    const els = Array.from(root.querySelectorAll(sel)).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
    });
    const el = els[idx] ?? null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}

/** Bounding rect of the visual's floating overlay div with the given z-index
 *  (tooltip = 1000, day-detail panel = 1001). Styles are set via cssText, so
 *  attribute selectors don't work — match on the style object instead. */
function overlayRect(z: string): DOMRect | null {
    for (const d of Array.from(document.querySelectorAll("div"))) {
        const el = d as HTMLElement;
        if (el.style.zIndex === z && el.style.display !== "none") {
            const r = el.getBoundingClientRect();
            if (r.width > 0) return r;
        }
    }
    return null;
}

interface CalloutOpts { dark?: boolean; maxW?: number; anchorSide?: "left" | "right" | "top" | "bottom" }
/** Bubble at (bx,by) with a leader line to `target` + a dot on the target. */
function callout(sh: HTMLElement, target: Pt | null, bx: number, by: number, text: string, o: CalloutOpts = {}): void {
    if (!target) return;
    const svg = ensureOverlay(sh);
    const b = document.createElement("div");
    b.textContent = text;
    b.style.cssText = [
        "position:absolute", `left:${bx}px`, `top:${by}px`,
        `max-width:${o.maxW ?? 240}px`,
        "padding:7px 11px", "border-radius:9px", "box-sizing:border-box",
        `background:${o.dark ? "rgba(28,28,38,.97)" : "rgba(255,255,255,.97)"}`,
        `border:1px solid ${o.dark ? "#33334a" : "#E2E0F0"}`,
        `border-left:3px solid ${ACCENT}`,
        "box-shadow:0 3px 12px rgba(26,26,60,.16)",
        `font:600 12.5px/1.35 ${FONT}`, `color:${o.dark ? TEXT_D : TEXT}`,
        "z-index:4001",
    ].join(";");
    sh.appendChild(b);
    // leader line: from nearest bubble edge to the target point
    const br = b.getBoundingClientRect();
    const side = o.anchorSide ?? (target.x < br.left ? "left" : target.x > br.right ? "right"
        : target.y < br.top ? "top" : "bottom");
    const sx = side === "left" ? br.left : side === "right" ? br.right : br.left + br.width / 2;
    const sy = side === "top" ? br.top : side === "bottom" ? br.bottom : br.top + br.height / 2;
    const mx = (sx + target.x) / 2, my = (sy + target.y) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // gentle quadratic curve
    const bend = side === "left" || side === "right" ? `${mx},${sy}` : `${sx},${my}`;
    path.setAttribute("d", `M${sx},${sy} Q${bend} ${target.x},${target.y}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", ACCENT);
    path.setAttribute("stroke-width", "1.6");
    path.setAttribute("opacity", "0.9");
    svg.appendChild(path);
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(target.x));
    dot.setAttribute("cy", String(target.y));
    dot.setAttribute("r", "3.5");
    dot.setAttribute("fill", ACCENT);
    dot.setAttribute("stroke", o.dark ? "#0F0F16" : "#FFFFFF");
    dot.setAttribute("stroke-width", "1.5");
    svg.appendChild(dot);
}

/** Center of the day cell for a local ISO date (idx = which match, for facets). */
function cellPoint(iso: string, idx = 0, root: ParentNode = document): Pt | null {
    const rects = Array.from(root.querySelectorAll("rect.cell"));
    const hits = rects.filter((r) => {
        const d = (r as unknown as { __data__?: { date?: Date } }).__data__;
        return d?.date instanceof Date && isoLocal(d.date) === iso;
    });
    const el = hits[idx] ?? hits[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// ── Data shaping ─────────────────────────────────────────────────────────────
/** Trailing-12-months window ending today, built by shifting the CSV +1 year. */
function trailingYear(): { dates: string[]; values: number[] } {
    const today = new Date();
    const start = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1);
    const dates: string[] = [], values: number[] = [];
    for (const r of tickets) {
        const src = new Date(r["Date"] + "T00:00:00");
        const shifted = new Date(src.getFullYear() + 1, src.getMonth(), src.getDate());
        if (shifted >= start && shifted <= today) {
            dates.push(isoLocal(shifted));
            values.push(Number(r["Tickets Resolved"]));
        }
    }
    // guarantee "today" exists so the today-ring shows
    if (dates[dates.length - 1] !== isoLocal(today)) {
        dates.push(isoLocal(today));
        values.push(212);
    }
    return { dates, values };
}

function year2025(): { dates: string[]; values: number[]; sla: number[] } {
    const rows = tickets.filter((r) => r["Date"].startsWith("2025"));
    return {
        dates: rows.map((r) => r["Date"]),
        values: rows.map((r) => Number(r["Tickets Resolved"])),
        sla: rows.map((r) => Number(r["SLA Breaches"])),
    };
}

function bothYears(): { dates: string[]; values: number[]; sla: number[] } {
    return {
        dates: tickets.map((r) => r["Date"]),
        values: tickets.map((r) => Number(r["Tickets Resolved"])),
        sla: tickets.map((r) => Number(r["SLA Breaches"])),
    };
}

function regionData(): { dates: string[]; values: number[]; target: number[]; category: string[] } {
    return {
        dates: regions.map((r) => r["Date"]),
        values: regions.map((r) => Number(r["TicketsResolved"])),
        target: regions.map((r) => Number(r["TargetTickets"])),
        category: regions.map((r) => r["Region"]),
    };
}

/** p-quantile of an array (for the hatch threshold). */
function quantile(vals: number[], p: number): number {
    const s = [...vals].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

// window hooks the Playwright driver uses
declare global {
    interface Window {
        __annotate?: () => void;
        __hoverTarget?: () => Pt | null;
        __clickTarget?: () => Pt | null;
        __focusCell?: () => void;
        __cellPoint?: (iso: string, idx?: number) => Pt | null;
    }
}
window.__cellPoint = (iso, idx) => cellPoint(iso, idx ?? 0);

// ── Slot 1 — hero ────────────────────────────────────────────────────────────
function slotHero(): void {
    const sh = shell();
    heading(sh, "A full year at a glance",
        "One cell per day, color = the day's value — peaks, quiet spells and streaks readable without a single filter.");
    const c = card(sh, { grow: true, mt: 18 });
    const st = stage(c, 1240, 570);
    const d = trailingYear();
    mount(st, {
        dates: d.dates, values: d.values, valueName: "Tickets Resolved",
        viewport: { width: 1240, height: 570 },
        format: {
            labels: { showHeader: true },
            header: { titleText: "Support throughput" },
            toolbar: { show: false },
        },
    });
    window.__annotate = () => {
        callout(sh, anchor("g.kpi-header", 0.9, -0.25), 690, 96, "Total + peak day at a glance", { anchorSide: "right" });
        callout(sh, cellPoint(isoLocal(new Date())), 1040, 615, "Today, always marked", { anchorSide: "right" });
        callout(sh, anchor("g.legend", 0.25, 0.5), 640, 612, "Quantile scaling — skewed data stays legible", { anchorSide: "left", maxW: 330 });
    };
}

// ── Slot 2 — quantile vs linear ──────────────────────────────────────────────
function slotScale(): void {
    const sh = shell();
    heading(sh, "Quantile vs linear — same data, different truth");
    const d = year2025();
    const mk = (label: string, scaleMode: string, buckets: string) => {
        const c = card(sh, { grow: true, label });
        const st = stage(c, 1226, 232, true);
        mount(st, {
            dates: d.dates, values: d.values, valueName: "Tickets Resolved",
            viewport: { width: 1226, height: 232 },
            format: {
                colors: { scaleMode, bucketCount: buckets },
                legend: { show: false },
                insights: { show: false },
                toolbar: { show: false },
            },
        });
        return st;
    };
    const top = mk("Linear scale", "linear", "0");
    const bot = mk("Quantile scale · 5 buckets  (the default)", "quantile", "5");
    window.__annotate = () => {
        callout(sh, anchor("svg", 0.62, 0.5, top), 990, 285,
            "Linear: one spike compresses most days to the pale end", { anchorSide: "top", maxW: 290 });
        callout(sh, anchor("svg", 0.22, 0.45, bot), 120, 368,
            "Quantile: every week reads — the distribution spreads across all buckets", { anchorSide: "bottom", maxW: 330 });
    };
}

// ── Slot 3 — insights + tooltip ──────────────────────────────────────────────
function slotInsights(): void {
    const sh = shell();
    heading(sh, "Insights surface automatically",
        "Streaks · weekday rhythm · anomalies · fiscal-aware year-over-year");
    const c = card(sh, { grow: true, mt: 16 });
    const st = stage(c, 1240, 580);
    const d = bothYears();
    mount(st, {
        dates: d.dates, values: d.values, valueName: "Tickets Resolved",
        target: d.values.map(() => 250),
        tooltips: [{ name: "SLA Breaches", values: d.sla }],
        viewport: { width: 1240, height: 580 },
        format: { toolbar: { show: false } },
    });
    // hover target: biggest late-2025 spike whose previous day has data, so the
    // tooltip shows its day-over-day delta row and lands right-of-center
    const valueByDate = new Map(tickets.map((r) => [r["Date"], Number(r["Tickets Resolved"])]));
    const prevDay = (isoStr: string) => {
        const t = new Date(isoStr + "T00:00:00");
        return isoLocal(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
    };
    const rows2025 = tickets.filter((r) =>
        r["Date"] >= "2025-08-01" && r["Date"] <= "2025-11-10" && (valueByDate.get(prevDay(r["Date"])) ?? 0) >= 100);
    const spike = rows2025.reduce((a, b) =>
        Number(b["Tickets Resolved"]) > Number(a["Tickets Resolved"]) ? b : a);
    window.__hoverTarget = () => cellPoint(spike["Date"]);
    window.__annotate = () => {
        callout(sh, anchor("g.insights-card", 0.04, 0.02), 520, 612,
            "Deterministic engine — runs in the sandbox. No external calls, no AI black box.",
            { anchorSide: "left", maxW: 330 });
        const tt = overlayRect("1000");
        callout(sh, tt ? { x: tt.left, y: tt.top + 34 } : cellPoint(spike["Date"]),
            tt ? tt.left - 300 : 400, tt ? tt.top + 6 : 130,
            "Rich tooltip — value, day-over-day delta, target variance", { anchorSide: "right", maxW: 250 });
    };
}

// ── Slot 4 — interactivity + small multiples ─────────────────────────────────
function slotInteract(): void {
    const sh = shell();
    heading(sh, "Every interaction Power BI expects",
        "Cross-filtering, multi-select, a persistent day-detail panel and an in-visual settings bar.");
    const c = card(sh, { grow: true, mt: 16 });
    const st = stage(c, 1240, 588);
    const d = regionData();
    mount(st, {
        dates: d.dates, values: d.values, target: d.target, category: d.category,
        valueName: "Tickets Resolved",
        viewport: { width: 1240, height: 588 },
        format: { insights: { show: false } },
    });
    // click target: a visible spring day in the FIRST facet
    window.__clickTarget = () => cellPoint("2025-04-15", 0);
    window.__annotate = () => {
        callout(sh, cellPoint("2025-04-15", 0), 96, 148,
            "Click to cross-filter the whole report — the rest dims, ctrl-click multi-selects",
            { anchorSide: "bottom", maxW: 260 });
        callout(sh, anchor("text.facet-title", 0, -0.6, document, 1), 170, 272,
            "Split by any column — small multiples share one scale", { anchorSide: "bottom", maxW: 250 });
        const panel = overlayRect("1001");
        callout(sh, panel ? { x: panel.left, y: panel.top + 44 } : null,
            panel ? panel.left - 292 : 780, panel ? panel.top + 16 : 220,
            "Day-detail panel — click a day to investigate it", { anchorSide: "right", maxW: 240 });
        callout(sh, anchor(".zsb-bar", 0.5, 0) ?? anchor(".zsb-gear", 0.5, 0), 700, 588,
            "In-visual settings bar — no digging through the Format pane", { anchorSide: "bottom", maxW: 260 });
    };
}

// ── Slot 5 — accessibility ───────────────────────────────────────────────────
function slotA11y(): void {
    const sh = shell();
    heading(sh, "Accessible by design — and yours to style");
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:16px;flex:1 1 auto;margin-top:2px;";
    sh.appendChild(row);
    const d = year2025();

    const left = card(row, { w: 627, grow: false, label: "Keyboard navigation — month blocks, light" });
    left.style.flex = "0 0 627px";
    const lst = stage(left, 590, 560);
    mount(lst, {
        dates: d.dates, values: d.values, valueName: "Tickets Resolved",
        viewport: { width: 590, height: 560 },
        format: {
            dataDisplay: { layout: "month" },
            legend: { show: false },
            insights: { show: false },
            toolbar: { show: false },
        },
    });

    const right = card(row, { w: 627, grow: false, dark: true, label: "Dark theme · colorblind-safe ramp · threshold hatch" });
    right.style.flex = "0 0 627px";
    const rst = stage(right, 590, 560);
    const thr = quantile(d.values, 0.85);
    mount(rst, {
        dates: d.dates, values: d.values, valueName: "Tickets Resolved",
        dark: true,
        viewport: { width: 590, height: 560 },
        format: {
            dataDisplay: { layout: "month" },
            colors: { ramp: "colorblind" },
            accessibility: { patternOnThreshold: true, patternThresholdValue: thr, patternStyle: "diagonal" },
            legend: { show: false },
            insights: { show: false },
            toolbar: { show: false },
        },
    });
    // a hatched cell in the dark panel's BOTTOM row (Sep–Oct), so the leader stays short
    const hatched = tickets.filter((r) => Number(r["Tickets Resolved"]) > thr)
        .map((r) => r["Date"]).find((d) => d >= "2025-09-01" && d <= "2025-10-31") ?? "2025-09-15";

    window.__focusCell = () => {
        // focus a September day (bottom-left block) so the callout leader is short;
        // the roving-tabindex focus handler syncs the index from the focus event
        const rects = Array.from(lst.querySelectorAll("rect.cell"));
        const el = rects.find((r) => {
            const dd = (r as unknown as { __data__?: { date?: Date } }).__data__;
            return dd?.date instanceof Date && isoLocal(dd.date) === "2025-09-09";
        }) as (SVGElement & { focus?: () => void }) | undefined;
        (el ?? (lst.querySelector('rect.cell[tabindex="0"]') as SVGElement))?.focus?.();
    };
    window.__annotate = () => {
        const focused = lst.querySelector("rect.cell:focus");
        const fpt = focused ? (() => { const r = focused.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null;
        callout(sh, fpt ?? anchor("rect.cell", 0.5, 0.5, lst), 250, 706,
            "Full keyboard navigation + ARIA on every day", { anchorSide: "top", maxW: 240 });
        callout(sh, cellPoint("2025-12-10", 1), 1080, 706,
            "CVD-verified palette (protan / deutan / tritan)", { anchorSide: "top", maxW: 250, dark: true });
        callout(sh, cellPoint(hatched, 1), 715, 690,
            "Non-color threshold cue — a hatch, not just a hue", { anchorSide: "top", maxW: 235, dark: true });
    };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
const which = (location.hash || "#hero").slice(1);
try {
    ({
        hero: slotHero,
        scale: slotScale,
        insights: slotInsights,
        interact: slotInteract,
        a11y: slotA11y,
    } as Record<string, () => void>)[which]?.();
} catch (e) {
    const el = document.getElementById("err");
    if (el) el.textContent = "CAUGHT: " + (e instanceof Error ? e.message + "\n" + e.stack : String(e));
}
