"use strict";

/**
 * Summary-table alternate view — the Table segment of the Calendar / Table / Insight
 * switch. Same look, parts and gestures as the family's table (Network Graph →
 * Sankey Pro `summaryTable.ts`):
 *   • a collapsible stat-card row with big serif numerals (collapse state persists
 *     through the `tableState` blob, like the Sankey's),
 *   • a toolbar strip with a live "N of M shown" count and a search box,
 *   • a sortable table — sticky header, sort arrows, zebra rows, monospace numerals,
 *     the value column drawn as a proportional bar.
 *
 * The calendar-specific part is the ROW GRAIN: the same days can be read by month,
 * by weekday, one row per day, or (Split-by bound) by group. The grain is session
 * UI state held by the visual, so a re-render keeps it.
 *
 * Replaces the calendar entirely while shown (ledger ST-A: calendar XOR table).
 * Built with createElement + textContent — never innerHTML.
 */

import { DayCell, FacetedRender } from "../types";
import { accent, fontFamily, HcColors, surfaceElevatedLight } from "../theme/zentrixTokens";
import { computeStreaks, DEFAULT_INSIGHT_CONFIG } from "../insights";
import { WEEKDAY } from "../interaction/dayData";
import {
    viewChrome, ViewChrome, SERIF, MONO, VIEW_END_GUTTER, WEEKDAY_LONG, fmtNum, fmtPct, fmtDate, icon, SEARCH_ICON, swallow,
} from "./viewChrome";

export type TableGrain = "group" | "month" | "weekday" | "day";

const GRAIN_LABEL: Record<TableGrain, string> = { group: "Group", month: "Month", weekday: "Weekday", day: "Day" };

export interface SummaryTableOptions {
    dark: boolean;
    hc: HcColors | null;
    /** Display name of the value field — titles the table. */
    valueName: string;
    /** Display name of the Split-by field (group grain); undefined = not faceted. */
    categoryName?: string;
    /** Weekday the calendar's week starts on (0 = Sun) — orders the weekday grain. */
    firstDayOfWeek: number;
    /** Session row grain; clamped to what the data supports. */
    grain?: TableGrain;
    onGrainChange?: (g: TableGrain) => void;
    /** Durable: the stat-card row starts collapsed (persisted via `tableState`). */
    statsCollapsed?: boolean;
    onStatsChange?: (collapsed: boolean) => void;
}

interface Column {
    label: string;
    numeric: boolean;
    value: (i: number) => string;
    sortKey: (i: number) => number | string;
    bar?: (i: number) => number;
    strong?: boolean;
}

export interface AggRow { label: string; order: number; days: DayCell[]; }
export interface AggStats { total: number; avg: number | null; max: number | null; min: number | null; n: number; best: Date | null; }

/** Shared with the export (interaction/exportData.ts), so a file says what the Table says. */
export function statsOf(days: DayCell[]): AggStats {
    let total = 0, max = -Infinity, min = Infinity, n = 0, best: Date | null = null;
    for (const d of days) {
        if (d.value == null || d.noData) continue;
        total += d.value;
        if (d.value > max) { max = d.value; best = d.date; }
        if (d.value < min) min = d.value;
        n++;
    }
    return n ? { total, avg: total / n, max, min, n, best } : { total: 0, avg: null, max: null, min: null, n: 0, best: null };
}

/** The grains this data can be read at. Group only exists with a Split-by bound. */
export function grainsFor(input: FacetedRender): TableGrain[] {
    return input.facets.length > 1 ? ["group", "month", "weekday", "day"] : ["month", "weekday", "day"];
}

/** Aggregate rows for a non-day grain. `order` is the natural (chronological) order. */
export function aggregateRows(input: FacetedRender, grain: Exclude<TableGrain, "day">, firstDayOfWeek = 0): AggRow[] {
    if (grain === "group") {
        return input.facets.map((f, i) => ({ label: f.key, order: i, days: f.model.days }));
    }
    const days = input.combined.days;
    if (grain === "weekday") {
        const rows: AggRow[] = [];
        for (let k = 0; k < 7; k++) {
            const wd = (firstDayOfWeek + k) % 7;
            rows.push({ label: WEEKDAY_LONG[wd], order: k, days: days.filter(d => d.date.getDay() === wd) });
        }
        return rows;
    }
    const combined = input.combined;
    const multiYear = combined.range[0].getFullYear() !== combined.range[1].getFullYear();
    const byMonth = new Map<string, AggRow>();
    for (const d of days) {
        const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        let row = byMonth.get(key);
        if (!row) {
            const month = d.date.toLocaleDateString("en-US", { month: "short" });
            row = { label: multiYear ? `${month} ${d.date.getFullYear()}` : month, order: byMonth.size, days: [] };
            byMonth.set(key, row); // days are chronological → insertion order is row order
        }
        row.days.push(d);
    }
    return [...byMonth.values()];
}

/** Render the Table view into `host`. Clears prior content. */
export function renderSummaryTable(host: HTMLElement, input: FacetedRender, opts: SummaryTableOptions): void {
    host.textContent = "";
    host.style.display = "block";
    const c: ViewChrome = viewChrome(opts.dark, opts.hc);
    const fg = c.surface.fg, muted = c.surface.muted;
    const barColor = c.hc ? fg : accent;
    const combined = input.combined;
    const grains = grainsFor(input);
    let grain: TableGrain = opts.grain && grains.includes(opts.grain) ? opts.grain : grains[0];

    const wrap = document.createElement("div");
    wrap.className = "zx-summary-view";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", `${combined.valueName} summary table`);
    wrap.style.cssText = `position:absolute;inset:0;overflow:auto;background:${c.pageBg};color:${fg};font:13px ${fontFamily};`
        + `padding:18px 18px ${VIEW_END_GUTTER}px;scroll-padding-block:18px ${VIEW_END_GUTTER}px;box-sizing:border-box`;
    swallow(wrap);

    // --- stat cards (over the days actually drawn — the same set the rows use) ---
    const all = statsOf(combined.days);
    const totalDays = combined.days.length;
    const cards = document.createElement("div");
    cards.className = "zx-sum-cards";
    cards.style.cssText = "display:flex;gap:14px;margin-bottom:18px;flex-wrap:wrap";
    const statCard = (title: string, big: string, sub: string): void => {
        const card = document.createElement("div");
        card.className = "zx-sum-card";
        card.style.cssText = `flex:1 1 130px;min-width:130px;background:${c.cardBg};border-radius:12px;padding:16px 20px;box-shadow:${c.shadow};border:1px solid ${c.border}`;
        const t = document.createElement("div"); t.textContent = title;
        t.style.cssText = `font:13px ${fontFamily};color:${fg};opacity:0.85;margin-bottom:8px;white-space:nowrap`;
        const b = document.createElement("div"); b.textContent = big;
        b.style.cssText = `font:600 30px ${SERIF};color:${fg};letter-spacing:0.5px;margin-bottom:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
        const s2 = document.createElement("div"); s2.textContent = sub;
        s2.style.cssText = `font:12px ${fontFamily};color:${muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`;
        card.appendChild(t); card.appendChild(b); card.appendChild(s2);
        cards.appendChild(card);
    };
    statCard("Total", fmtNum(all.total), combined.valueName);
    statCard("Daily average", fmtNum(all.avg), "per day with data");
    statCard("Best day", fmtNum(all.max), all.best ? fmtDate(all.best) : "no data");
    statCard("Days with data", String(all.n), totalDays ? `of ${totalDays} days (${fmtPct(all.n / totalDays, false)})` : "no days");
    if (combined.series) {
        const st = computeStreaks(combined.series, DEFAULT_INSIGHT_CONFIG);
        const span = st.longestActive;
        statCard("Longest streak", `${span.length} ${span.length === 1 ? "day" : "days"}`,
            span.start && span.end ? `${fmtDate(span.start)} – ${fmtDate(span.end)}` : "no active days");
    }
    if (input.facets.length > 1) {
        const sums = input.facets.map(f => ({ key: f.key, total: statsOf(f.model.days).total }));
        const top = sums.reduce((a, b) => (b.total > a.total ? b : a), sums[0]);
        statCard("Groups", String(input.facets.length), `largest: ${top.key}`);
    }

    // Minimise control (family parity): a slim chevron line collapses the cards.
    let statsCollapsed = Boolean(opts.statsCollapsed);
    const statsToggle = document.createElement("button");
    statsToggle.type = "button";
    statsToggle.className = "zx-sum-stats-toggle";
    statsToggle.setAttribute("aria-label", "Toggle summary cards");
    statsToggle.style.cssText = "display:inline-flex;align-items:center;gap:7px;margin-bottom:10px;padding:4px 8px;"
        + `border:none;background:transparent;color:${muted};cursor:pointer;font:600 12px ${fontFamily};letter-spacing:.03em`;
    const applyStats = (): void => {
        cards.style.display = statsCollapsed ? "none" : "flex";
        statsToggle.textContent = `${statsCollapsed ? "▸" : "▾"}  Summary`;
        statsToggle.setAttribute("aria-expanded", String(!statsCollapsed));
    };
    statsToggle.onclick = () => {
        statsCollapsed = !statsCollapsed;
        applyStats();
        opts.onStatsChange?.(statsCollapsed);
    };
    applyStats();
    wrap.appendChild(statsToggle);
    wrap.appendChild(cards);

    // --- toolbar strip: title · count · grain switch · search ---
    const strip = document.createElement("div");
    strip.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap";
    const title = document.createElement("span");
    title.style.cssText = `font:700 17px ${SERIF};white-space:nowrap`;
    strip.appendChild(title);
    const countEl = document.createElement("span");
    countEl.className = "zx-sum-count";
    countEl.style.cssText = `font:12px ${MONO};color:${muted};white-space:nowrap`;
    strip.appendChild(countEl);
    const spacer = document.createElement("span"); spacer.style.cssText = "flex:1 1 auto"; strip.appendChild(spacer);

    const seg = document.createElement("span");
    seg.setAttribute("role", "tablist");
    seg.setAttribute("aria-label", "Rows");
    seg.style.cssText = `display:inline-flex;gap:2px;padding:2px;border-radius:9px;border:1px solid ${c.border};background:${c.cardBg}`;
    const segBtns: Partial<Record<TableGrain, HTMLButtonElement>> = {};
    for (const g of grains) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.grain = g;
        b.setAttribute("role", "tab");
        b.textContent = GRAIN_LABEL[g];
        b.title = g === "day" ? "One row per day" : `One row per ${GRAIN_LABEL[g].toLowerCase()}`;
        b.style.cssText = `height:26px;padding:0 10px;border:none;border-radius:7px;cursor:pointer;font:600 12px ${fontFamily}`;
        b.onclick = () => {
            if (grain === g) return;
            grain = g;
            opts.onGrainChange?.(g);
            buildTable();
        };
        segBtns[g] = b;
        seg.appendChild(b);
    }
    strip.appendChild(seg);

    const searchWrap = document.createElement("span");
    searchWrap.style.cssText = "position:relative;display:inline-flex;align-items:center";
    const searchIco = icon(SEARCH_ICON);
    searchIco.style.cssText = `position:absolute;left:10px;pointer-events:none;color:${muted}`;
    const search = document.createElement("input");
    search.type = "text";
    search.className = "zx-sum-search";
    search.setAttribute("aria-label", "Search rows");
    search.style.cssText = `width:180px;height:32px;padding:0 10px 0 32px;border-radius:9px;border:1px solid ${c.border};background:${c.cardBg};color:${fg};font:400 12px ${fontFamily};outline:none;box-sizing:border-box`;
    let query = "";
    search.oninput = () => { query = search.value.trim().toLowerCase(); renderBody(); };
    searchWrap.appendChild(searchIco); searchWrap.appendChild(search);
    strip.appendChild(searchWrap);
    wrap.appendChild(strip);

    // --- table ---
    const tableCard = document.createElement("div");
    tableCard.style.cssText = `background:${c.cardBg};border-radius:12px;border:1px solid ${c.border};box-shadow:${c.shadow};overflow:hidden`;
    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%";
    const thead = document.createElement("thead");
    const tbody = document.createElement("tbody");
    table.appendChild(thead); table.appendChild(tbody);
    tableCard.appendChild(table);
    wrap.appendChild(tableCard);
    host.appendChild(wrap);

    const thBase = `padding:11px 14px;position:sticky;top:0;background:${c.cardBg};border-bottom:2px solid ${c.border};font:700 11px ${fontFamily};letter-spacing:0.8px;text-transform:uppercase;color:${muted};user-select:none;white-space:nowrap;z-index:2`;

    let columns: Column[] = [];
    let labels: string[] = [];
    let n = 0;
    let sortCol = 0, sortDesc = false;
    let headerCells: HTMLTableCellElement[] = [];

    /** (Re)build the column set for the current grain, then the body. */
    function buildTable(): void {
        for (const g of grains) {
            const b = segBtns[g]!;
            const on = g === grain;
            b.style.background = on ? (c.hc ? fg : accent) : "transparent";
            b.style.color = on ? (c.hc ? c.surface.bg : surfaceElevatedLight) : fg;
            b.setAttribute("aria-selected", String(on));
        }
        if (grain === "day") {
            const days = combined.days.filter(d => !d.noData && d.value != null);
            const mean = all.avg ?? 0;
            const maxV = days.reduce((m, d) => Math.max(m, d.value as number), 0) || 1;
            const hasTarget = !!combined.targetName;
            n = days.length;
            // Search also matches holiday and event names ("launch", "christmas").
            labels = days.map(d => [fmtDate(d.date), WEEKDAY_LONG[d.date.getDay()], d.holiday ?? "", ...(d.events ?? [])].join(" ").toLowerCase());
            columns = [
                { label: "Date", numeric: false, strong: true, value: i => fmtDate(days[i].date), sortKey: i => days[i].date.getTime() },
                { label: "Weekday", numeric: false, value: i => WEEKDAY[days[i].date.getDay()], sortKey: i => (days[i].date.getDay() - opts.firstDayOfWeek + 7) % 7 },
                { label: combined.valueName, numeric: true, value: i => fmtNum(days[i].value), sortKey: i => days[i].value as number, bar: i => (days[i].value as number) / maxV },
                { label: "vs average", numeric: true, value: i => (mean ? fmtPct((days[i].value as number) / mean - 1) : "–"), sortKey: i => (days[i].value as number) - mean },
            ];
            if (hasTarget) {
                columns.push(
                    { label: combined.targetName!, numeric: true, value: i => fmtNum(days[i].target), sortKey: i => days[i].target ?? -Infinity },
                    { label: "vs target", numeric: true, value: i => {
                        const t = days[i].target;
                        return t ? fmtPct((days[i].value as number) / t - 1) : "–";
                    }, sortKey: i => { const t = days[i].target; return t ? (days[i].value as number) / t : -Infinity; } },
                );
            }
            if (combined.holidayName) {
                columns.push({ label: combined.holidayName, numeric: false, value: i => days[i].holiday ?? "", sortKey: i => days[i].holiday ?? "" });
            }
            if (combined.eventName) {
                columns.push({ label: combined.eventName, numeric: false, value: i => (days[i].events ?? []).join(" \u00B7 "), sortKey: i => (days[i].events ?? []).join(" ") });
            }
            sortCol = 0; sortDesc = false; // chronological
            title.textContent = "Days";
        } else {
            const rows = aggregateRows(input, grain, opts.firstDayOfWeek);
            const stats = rows.map(r => statsOf(r.days));
            const grand = stats.reduce((a, s) => a + s.total, 0);
            const maxT = stats.reduce((m, s) => Math.max(m, s.total), 0) || 1;
            n = rows.length;
            labels = rows.map(r => r.label.toLowerCase());
            const labelName = grain === "group" ? (opts.categoryName || "Group") : GRAIN_LABEL[grain];
            columns = [
                { label: labelName, numeric: false, strong: true, value: i => rows[i].label, sortKey: i => (grain === "group" ? rows[i].label : rows[i].order) },
                { label: "Total", numeric: true, value: i => fmtNum(stats[i].total), sortKey: i => stats[i].total, bar: i => stats[i].total / maxT },
                { label: "Avg / day", numeric: true, value: i => fmtNum(stats[i].avg), sortKey: i => stats[i].avg ?? -Infinity },
                { label: "Best day", numeric: true, value: i => fmtNum(stats[i].max), sortKey: i => stats[i].max ?? -Infinity },
                { label: "Lowest", numeric: true, value: i => fmtNum(stats[i].min), sortKey: i => stats[i].min ?? -Infinity },
                { label: "Days", numeric: true, value: i => (stats[i].n ? String(stats[i].n) : "–"), sortKey: i => stats[i].n },
                { label: "% of total", numeric: true, value: i => (grand ? fmtPct(stats[i].total / grand, false) : "–"), sortKey: i => stats[i].total },
            ];
            // Months and weekdays read in calendar order; groups rank by total (the
            // family default: value, descending).
            if (grain === "group") { sortCol = 1; sortDesc = true; } else { sortCol = 0; sortDesc = false; }
            title.textContent = grain === "group" ? `By ${labelName}` : `By ${GRAIN_LABEL[grain].toLowerCase()}`;
        }
        search.placeholder = grain === "day" ? "Search dates…" : `Search ${grain === "group" ? "groups" : grain + "s"}…`;

        // Header row.
        while (thead.firstChild) thead.removeChild(thead.firstChild);
        const hr = document.createElement("tr");
        const rankTh = document.createElement("th"); rankTh.textContent = "#";
        rankTh.style.cssText = `${thBase};text-align:left;width:1%`;
        hr.appendChild(rankTh);
        headerCells = [];
        columns.forEach((col, ci) => {
            const th = document.createElement("th");
            th.style.cssText = `${thBase};text-align:${col.numeric ? "right" : "left"};cursor:pointer`;
            th.title = "Click to sort";
            th.setAttribute("scope", "col");
            th.onclick = () => {
                if (sortCol === ci) sortDesc = !sortDesc; else { sortCol = ci; sortDesc = col.numeric; }
                renderBody();
            };
            hr.appendChild(th); headerCells.push(th);
        });
        thead.appendChild(hr);
        table.setAttribute("aria-label", title.textContent || "Summary");
        renderBody();
    }

    function barCell(td: HTMLTableCellElement, frac: number, value: string): void {
        const box = document.createElement("span");
        box.style.cssText = "display:inline-flex;align-items:center;gap:10px;justify-content:flex-end";
        const track = document.createElement("span");
        track.style.cssText = `display:inline-block;width:86px;height:6px;border-radius:3px;background:${c.track};overflow:hidden;flex:0 0 auto`;
        const fill = document.createElement("span");
        const pct = Math.max(0, Math.min(1, frac)) * 100;
        fill.style.cssText = `display:block;height:100%;border-radius:3px;background:${barColor};width:${Math.round(pct * 10) / 10}%`;
        track.appendChild(fill);
        const num = document.createElement("span"); num.textContent = value;
        num.style.cssText = `font:600 12.5px ${MONO};min-width:44px;text-align:right`;
        box.appendChild(track); box.appendChild(num); td.appendChild(box);
    }

    function renderBody(): void {
        columns.forEach((col, ci) => {
            headerCells[ci].textContent = col.label + (ci === sortCol ? (sortDesc ? " ▼" : " ▲") : "");
            headerCells[ci].style.color = ci === sortCol ? (c.hc ? fg : accent) : muted;
            headerCells[ci].setAttribute("aria-sort", ci === sortCol ? (sortDesc ? "descending" : "ascending") : "none");
        });
        const col = columns[sortCol];
        const order = Array.from({ length: n }, (_, i) => i)
            .filter(i => query === "" || labels[i].indexOf(query) !== -1)
            .sort((a, b) => {
                const ka = col.sortKey(a), kb = col.sortKey(b);
                const cmp = typeof ka === "number" && typeof kb === "number" ? ka - kb : String(ka).localeCompare(String(kb));
                return sortDesc ? -cmp : cmp;
            });
        countEl.textContent = `${order.length} of ${n} shown`;
        while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
        if (order.length === 0) {
            const tr = document.createElement("tr"); const td = document.createElement("td");
            td.colSpan = columns.length + 1;
            td.textContent = n ? "No rows match your search." : "No days with data.";
            td.style.cssText = `padding:18px 14px;text-align:center;font:12px ${fontFamily};color:${muted}`;
            tr.appendChild(td); tbody.appendChild(tr); return;
        }
        const tdBase = `padding:9px 14px;border-bottom:1px solid ${c.border};white-space:nowrap`;
        order.forEach((i, row) => {
            const tr = document.createElement("tr");
            tr.className = "zx-sum-row";
            tr.style.background = row % 2 ? c.zebra : "transparent";
            const rankTd = document.createElement("td"); rankTd.textContent = String(row + 1);
            rankTd.style.cssText = `${tdBase};text-align:left;font:12px ${MONO};color:${muted}`;
            tr.appendChild(rankTd);
            for (const cdef of columns) {
                const td = document.createElement("td");
                td.style.cssText = `${tdBase};text-align:${cdef.numeric ? "right" : "left"}`;
                const v = cdef.value(i);
                if (cdef.bar) barCell(td, cdef.bar(i), v);
                else { td.textContent = v; td.style.font = `${cdef.strong ? "700 " : ""}12.5px ${MONO}`; if (cdef.strong) td.title = v; }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        });
    }

    buildTable();
}
