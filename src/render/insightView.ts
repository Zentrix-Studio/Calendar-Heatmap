"use strict";

/**
 * Insight alternate view — the third segment of the Calendar / Table / Insight switch.
 * A full-canvas, plain-English read-out of the calendar: how much, when it peaks, how
 * steady it is, which weekday carries it, what was unusual, and how it compares with
 * last year.
 *
 * Chrome is the family's insight page 1:1 (Network Graph → Sankey Pro → Gantt): eyebrow
 * + serif headline hero, then soft cards on a page tint, each card leading with its big
 * number. A card whose number points at a specific day is CLICKABLE — it flips back to
 * the calendar and opens that day, the family's session-local "show me" gesture (never
 * a cross-filter, never a persisted setting).
 *
 * Content is deterministic: the pure insight engine (`src/insights/`) over the FULL
 * pre-cap series, plus plain arithmetic over the days the calendar draws.
 * createElement + textContent only — never innerHTML.
 */

import { DayCell, FacetedRender } from "../types";
import { accent, fontFamily, HcColors } from "../theme/zentrixTokens";
import {
    computeInsights, computeStreaks, computeWeekdayPatterns, computeAnomalies, computeComparisons,
    DEFAULT_INSIGHT_CONFIG, Polarity, Insight,
} from "../insights";
import {
    viewChrome, ViewChrome, Tone, toneColor, SERIF, VIEW_END_GUTTER, WEEKDAY_LONG,
    fmtNum, fmtPct, fmtDate, swallow,
} from "./viewChrome";

/** What clicking a card's headline number does: flip to the calendar, open that day. */
export interface InsightAction { kind: "focusDay"; time: number; }

interface Line { text: string; tone: Tone; strong?: boolean; }
interface Metric { value: string; label: string; sub?: string; tone: Tone; action?: InsightAction; }
export interface Section { title: string; metric?: Metric; lines: Line[]; }
export interface InsightPage { headline: string; subhead: string; sections: Section[]; }

export interface InsightPageOptions {
    polarity: Polarity;
    fiscalStartMonth: number;
    /** How many engine findings the "Key findings" card lists. */
    findings: number;
}

/** Tone for a change, honouring the author's "higher is good / bad" declaration. A
 *  neutral polarity never colours anything good or bad (the engine's own rule). */
function directional(delta: number, polarity: Polarity): Tone {
    if (polarity === "neutral" || delta === 0) return "neutral";
    const up = delta > 0;
    return (polarity === "good") === up ? "positive" : "negative";
}

function engineTone(i: Insight): Tone { return i.tone; }

const dayTime = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Build the page from the model. Pure (no DOM) so it is unit-testable. */
export function buildInsightPage(input: FacetedRender, o: InsightPageOptions): InsightPage {
    const combined = input.combined;
    const series = combined.series;
    const days = combined.days.filter(d => !d.noData && d.value != null) as (DayCell & { value: number })[];
    const total = days.reduce((a, d) => a + d.value, 0);
    const avg = days.length ? total / days.length : 0;
    const r0 = combined.range[0], r1 = combined.range[1];
    const subhead = `${combined.days.length} days · ${fmtDate(r0)} – ${fmtDate(r1)} · ${fmtNum(total)} total · ${fmtNum(avg)} per day with data`;

    const config = { ...DEFAULT_INSIGHT_CONFIG, polarity: o.polarity, fiscalStartMonth: o.fiscalStartMonth };
    const findings = series ? computeInsights(series, config, Math.max(1, o.findings)) : [];
    const headline = findings.length
        ? findings[0].body
        : days.length ? `${fmtNum(total)} ${combined.valueName} across ${days.length} days with data.` : "No days with data in view.";

    const sections: Section[] = [];

    // Coverage — how complete the calendar is. Leads, like the family's "Data quality".
    const span = combined.days.length;
    const gaps = span - days.length;
    let longestGap = 0, run = 0;
    for (const d of combined.days) { run = d.noData || d.value == null ? run + 1 : 0; if (run > longestGap) longestGap = run; }
    const coverage = span ? days.length / span : 0;
    sections.push({
        title: "Data coverage",
        metric: {
            value: fmtPct(coverage, false), label: "of days have data",
            sub: `${days.length} of ${span} days`,
            tone: coverage >= 0.85 ? "positive" : coverage >= 0.5 ? "neutral" : "negative",
        },
        lines: [
            gaps ? { text: `${gaps} day${gaps === 1 ? "" : "s"} without data; the longest gap runs ${longestGap} day${longestGap === 1 ? "" : "s"}.`, tone: "neutral" }
                : { text: "Every day in range has data.", tone: "positive", strong: true },
            ...(combined.totalDays > combined.days.length
                ? [{ text: `The calendar shows the last ${combined.days.length} of ${combined.totalDays} days; the findings below use all of them.`, tone: "neutral" as Tone }]
                : []),
        ],
    });

    if (findings.length) {
        sections.push({
            title: "Key findings",
            lines: findings.map((f, i) => ({ text: f.body, tone: engineTone(f), strong: i === 0 })),
        });
    }

    // Peaks — the best and the quietest day on the calendar.
    if (days.length) {
        const ranked = [...days].sort((a, b) => b.value - a.value);
        const best = ranked[0], low = ranked[ranked.length - 1];
        sections.push({
            title: "Peaks",
            metric: {
                value: fmtNum(best.value), label: `best day · ${fmtDate(best.date)}`,
                sub: avg ? `${fmtPct(best.value / avg - 1)} vs the daily average` : undefined,
                tone: directional(1, o.polarity), action: { kind: "focusDay", time: dayTime(best.date) },
            },
            lines: [
                ...ranked.slice(1, 3).map(d => ({ text: `${fmtDate(d.date)}: ${fmtNum(d.value)}`, tone: "neutral" as Tone })),
                ...(ranked.length > 1 ? [{ text: `Quietest day: ${fmtDate(low.date)} at ${fmtNum(low.value)}.`, tone: "neutral" as Tone }] : []),
            ],
        });
    }

    if (series) {
        // Streaks — consecutive active days (a day is active when its value is above 0).
        const st = computeStreaks(series, config);
        if (st.longestActive.length > 0) {
            const la = st.longestActive;
            sections.push({
                title: "Streaks",
                metric: {
                    value: String(la.length), label: `day${la.length === 1 ? "" : "s"} in a row, longest active run`,
                    sub: la.start && la.end ? `${fmtDate(la.start)} – ${fmtDate(la.end)}` : undefined,
                    tone: "neutral",
                    action: la.start ? { kind: "focusDay", time: dayTime(la.start) } : undefined,
                },
                lines: [
                    { text: `Active on ${fmtPct(st.activeDaysPct, false)} of days (${st.activeDays} of ${st.activeDays + st.inactiveDays}).`, tone: "neutral" },
                    ...(st.currentActive > 0 ? [{ text: `Current run: ${st.currentActive} active day${st.currentActive === 1 ? "" : "s"} and counting.`, tone: "positive" as Tone }] : []),
                    ...(st.longestInactive.length > 0 && st.longestInactive.start
                        ? [{ text: `Longest quiet stretch: ${st.longestInactive.length} day${st.longestInactive.length === 1 ? "" : "s"} from ${fmtDate(st.longestInactive.start)}.`, tone: "neutral" as Tone }]
                        : []),
                ],
            });
        }

        // Weekly rhythm — which weekday carries the load.
        const wk = computeWeekdayPatterns(series);
        if (wk.strongest && wk.weakest) {
            sections.push({
                title: "Weekly rhythm",
                metric: {
                    value: WEEKDAY_LONG[wk.strongest.weekday], label: "strongest weekday",
                    sub: `${fmtPct(wk.strongest.deltaPct)} vs the average day (${fmtNum(wk.strongest.mean)} vs ${fmtNum(wk.baseline)})`,
                    tone: "neutral",
                },
                lines: [
                    { text: `Weakest: ${WEEKDAY_LONG[wk.weakest.weekday]}, ${fmtPct(wk.weakest.deltaPct)} vs average.`, tone: "neutral" },
                    ...(() => {
                        const weekend = wk.byWeekday.filter(m => m.weekday === 0 || m.weekday === 6);
                        const weekday = wk.byWeekday.filter(m => m.weekday > 0 && m.weekday < 6);
                        if (!weekend.length || !weekday.length) return [];
                        const we = weekend.reduce((a, m) => a + m.mean, 0) / weekend.length;
                        const wd = weekday.reduce((a, m) => a + m.mean, 0) / weekday.length;
                        if (!wd) return [];
                        return [{ text: `Weekends average ${fmtNum(we)}, weekdays ${fmtNum(wd)} (${fmtPct(we / wd - 1)}).`, tone: "neutral" as Tone }];
                    })(),
                ],
            });
        }

        // Unusual days — robust outliers. Absent when there is nothing to say, rather
        // than a card announcing "none" (Sankey parity).
        const an = computeAnomalies(series);
        if (an.anomalies.length && an.strongest) {
            const s0 = an.strongest;
            sections.push({
                title: "Unusual days",
                metric: {
                    value: String(an.anomalies.length), label: `unusual day${an.anomalies.length === 1 ? "" : "s"}`,
                    sub: `${an.countStrong} strong · ${an.countModerate} moderate`,
                    tone: "negative", action: { kind: "focusDay", time: dayTime(s0.date) },
                },
                lines: an.anomalies.slice(0, 3).map(a => ({
                    text: `${fmtDate(a.date)}: ${fmtNum(a.value)}, far ${a.direction === "high" ? "above" : "below"} typical.`,
                    tone: directional(a.direction === "high" ? 1 : -1, o.polarity),
                })),
            });
        }

        // Vs last year — only when there is a prior year to compare against.
        const cmp = computeComparisons(series, o.fiscalStartMonth);
        if (cmp) {
            const fy = (y: number) => (cmp.fiscal ? `FY${y}` : String(y));
            sections.push({
                title: "Vs last year",
                metric: {
                    value: fmtPct(cmp.totalDeltaPct), label: `${fy(cmp.currentYear)} vs ${fy(cmp.priorYear)}${cmp.partial ? ", same period" : ""}`,
                    sub: `${fmtNum(cmp.curTotal)} now · ${fmtNum(cmp.prevTotal)} before`,
                    tone: directional(cmp.totalDeltaPct, o.polarity),
                },
                lines: [
                    { text: `Average active day: ${fmtPct(cmp.avgDeltaPct)}.`, tone: directional(cmp.avgDeltaPct, o.polarity) },
                    ...cmp.byQuarter.map(q => ({ text: `Q${q.q}: ${fmtPct(q.deltaPct)}`, tone: directional(q.deltaPct, o.polarity) })),
                ],
            });
        }
    }

    // Events from the data (HM-V2-11) — "what happened on the days that moved": the
    // average on event days against every other day with data.
    const evDays = days.filter(d => d.events?.length);
    if (evDays.length) {
        const others = days.filter(d => !d.events?.length);
        const evAvg = evDays.reduce((a, d) => a + d.value, 0) / evDays.length;
        const otAvg = others.length ? others.reduce((a, d) => a + d.value, 0) / others.length : 0;
        const top = [...evDays].sort((a, b) => b.value - a.value);
        const lift = otAvg ? evAvg / otAvg - 1 : 0;
        sections.push({
            title: "Events",
            metric: {
                value: otAvg ? fmtPct(lift) : fmtNum(evAvg), label: otAvg ? "on event days vs other days" : "average on event days",
                sub: `${evDays.length} event day${evDays.length === 1 ? "" : "s"} \u00B7 ${fmtNum(evAvg)} vs ${fmtNum(otAvg)} per day`,
                tone: directional(lift, o.polarity), action: { kind: "focusDay", time: dayTime(top[0].date) },
            },
            lines: top.slice(0, 3).map(d => ({ text: `${fmtDate(d.date)} \u00B7 ${(d.events ?? []).join(", ")}: ${fmtNum(d.value)}`, tone: "neutral" as Tone })),
        });
    }

    // Holidays (HM-V2-10) — how a holiday compares with a normal working day.
    const holDays = days.filter(d => d.holiday);
    if (holDays.length) {
        const working = days.filter(d => !d.holiday && d.date.getDay() !== 0 && d.date.getDay() !== 6);
        const hAvg = holDays.reduce((a, d) => a + d.value, 0) / holDays.length;
        const wAvg = working.length ? working.reduce((a, d) => a + d.value, 0) / working.length : 0;
        sections.push({
            title: "Holidays",
            metric: {
                value: wAvg ? fmtPct(hAvg / wAvg - 1) : fmtNum(hAvg), label: wAvg ? "on holidays vs a working day" : "average on holidays",
                sub: `${holDays.length} holiday${holDays.length === 1 ? "" : "s"} with data \u00B7 ${fmtNum(hAvg)} vs ${fmtNum(wAvg)} per day`,
                tone: "neutral",
            },
            lines: [...holDays].sort((a, b) => b.value - a.value).slice(0, 3)
                .map(d => ({ text: `${d.holiday} (${fmtDate(d.date)}): ${fmtNum(d.value)}`, tone: "neutral" as Tone })),
        });
    }

    // Month by month — over the drawn days, so it agrees with the Table's month rows.
    const months = new Map<string, { label: string; total: number; n: number }>();
    const multiYear = r0.getFullYear() !== r1.getFullYear();
    for (const d of days) {
        const k = `${d.date.getFullYear()}-${d.date.getMonth()}`;
        let m = months.get(k);
        if (!m) {
            const name = d.date.toLocaleDateString("en-US", { month: "long" });
            m = { label: multiYear ? `${name} ${d.date.getFullYear()}` : name, total: 0, n: 0 };
            months.set(k, m);
        }
        m.total += d.value; m.n++;
    }
    const ms = [...months.values()];
    if (ms.length >= 2) {
        const byTotal = [...ms].sort((a, b) => b.total - a.total);
        const top = byTotal[0], bottom = byTotal[byTotal.length - 1];
        const last = ms[ms.length - 1], prev = ms[ms.length - 2];
        sections.push({
            title: "Month by month",
            metric: {
                value: top.label, label: "biggest month",
                sub: `${fmtNum(top.total)}${total ? `, ${fmtPct(top.total / total, false)} of the total` : ""}`,
                tone: "neutral",
            },
            lines: [
                { text: `Smallest: ${bottom.label} at ${fmtNum(bottom.total)}.`, tone: "neutral" },
                ...(prev.total
                    ? [{ text: `${last.label} vs ${prev.label}: ${fmtPct(last.total / prev.total - 1)}${last.n < prev.n ? " (month still in progress)" : ""}.`, tone: directional(last.total - prev.total, o.polarity) }]
                    : []),
            ],
        });
    }

    // Groups — only with a Split-by bound.
    if (input.facets.length > 1) {
        const groups = input.facets.map(f => ({
            key: f.key,
            total: f.model.days.reduce((a, d) => a + (d.noData || d.value == null ? 0 : d.value), 0),
        })).sort((a, b) => b.total - a.total);
        const all = groups.reduce((a, g) => a + g.total, 0);
        sections.push({
            title: "Groups",
            metric: {
                value: groups[0].key, label: "largest group",
                sub: all ? `${fmtPct(groups[0].total / all, false)} of the total` : undefined, tone: "neutral",
            },
            lines: [
                ...groups.slice(1, 4).map(g => ({ text: `${g.key}: ${fmtNum(g.total)}${all ? ` (${fmtPct(g.total / all, false)})` : ""}`, tone: "neutral" as Tone })),
                ...(input.totalCategories > input.facets.length
                    ? [{ text: `${input.totalCategories - input.facets.length} more group(s) not drawn.`, tone: "neutral" as Tone }]
                    : []),
            ],
        });
    }

    return { headline, subhead, sections };
}

/** Plain-words affordance line under a clickable metric. */
const ACTION_HINT = "Show on the calendar";

export interface InsightViewOptions extends InsightPageOptions {
    dark: boolean;
    hc: HcColors | null;
    /** Absent → the cards are plain read-only (no click affordance). */
    onAction?: (a: InsightAction) => void;
}

/** Render the Insight view into `host`. Clears prior content. */
export function renderInsightView(host: HTMLElement, input: FacetedRender, opts: InsightViewOptions): InsightPage {
    host.textContent = "";
    host.style.display = "block";
    const c: ViewChrome = viewChrome(opts.dark, opts.hc);
    const fg = c.surface.fg, muted = c.surface.muted;
    const page = buildInsightPage(input, opts);

    const wrap = document.createElement("div");
    wrap.className = "zx-insight-view";
    wrap.setAttribute("role", "region");
    // The label IS the read-out: a screen reader hears the same sentence a sighted
    // reader gets from the hero, not the bare word "Insight".
    wrap.setAttribute("aria-label", `Calendar insight. ${page.headline}`);
    wrap.style.cssText = `position:absolute;inset:0;overflow:auto;background:${c.pageBg};color:${fg};font:13px ${fontFamily};`
        + `padding:22px 22px ${VIEW_END_GUTTER}px;scroll-padding-block:22px ${VIEW_END_GUTTER}px;box-sizing:border-box`;
    swallow(wrap);

    const SHELL = "max-width:1400px;margin:0 auto";
    const hero = document.createElement("div");
    hero.style.cssText = `${SHELL};margin-bottom:20px`;
    const eyebrow = document.createElement("div"); eyebrow.textContent = "CALENDAR INSIGHT";
    eyebrow.style.cssText = `font:700 11px ${fontFamily};letter-spacing:1.8px;color:${c.hc ? fg : accent};margin-bottom:10px`;
    const h = document.createElement("div"); h.className = "zx-insight-headline"; h.textContent = page.headline;
    h.style.cssText = `font:600 24px/1.35 ${SERIF};color:${fg};letter-spacing:0.2px;max-width:900px`;
    const sh = document.createElement("div"); sh.textContent = page.subhead;
    sh.style.cssText = `font:400 13px ${fontFamily};color:${muted};margin-top:8px;letter-spacing:0.3px`;
    hero.appendChild(eyebrow); hero.appendChild(h); hero.appendChild(sh);
    wrap.appendChild(hero);

    const grid = document.createElement("div");
    grid.style.cssText = `${SHELL};display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))`;
    wrap.appendChild(grid);

    for (const sec of page.sections) {
        const card = document.createElement("div");
        card.className = "zx-insight-card";
        card.dataset.title = sec.title;
        card.style.cssText = `background:${c.cardBg};border:1px solid ${c.border};border-radius:12px;box-shadow:${c.shadow};padding:16px 18px`;
        const title = document.createElement("div"); title.textContent = sec.title.toUpperCase();
        title.style.cssText = `font:700 10px ${fontFamily};letter-spacing:1.4px;color:${muted};margin-bottom:12px`;
        card.appendChild(title);

        if (sec.metric) {
            const m = sec.metric;
            const mWrap = document.createElement("div"); mWrap.style.cssText = "margin-bottom:12px";
            const value = document.createElement("div"); value.textContent = m.value;
            value.style.cssText = `font:700 34px/1.05 ${fontFamily};color:${toneColor(m.tone, c)};letter-spacing:-0.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
            const label = document.createElement("div"); label.textContent = m.label;
            label.style.cssText = `font:600 12px/1.35 ${fontFamily};color:${fg};opacity:0.85;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
            label.title = m.label;
            mWrap.appendChild(value); mWrap.appendChild(label);
            if (m.sub) {
                const sub = document.createElement("div"); sub.textContent = m.sub;
                sub.style.cssText = `font:400 11px ${fontFamily};color:${muted};margin-top:3px`;
                mWrap.appendChild(sub);
            }
            const action = m.action;
            if (action && opts.onAction) {
                // The family's clickable-card pattern: an accessible button with a hover
                // tint (dropped in HC), a focus ring, Enter/Space, and an accent cue.
                const onAction = opts.onAction;
                mWrap.className = "zx-insight-action";
                mWrap.style.cssText += ";cursor:pointer;border-radius:10px;padding:8px 10px;margin:-8px -10px 4px -10px;transition:background 120ms ease";
                mWrap.setAttribute("role", "button");
                mWrap.setAttribute("tabindex", "0");
                mWrap.setAttribute("aria-label", `${m.value} ${m.label}. ${ACTION_HINT}.`);
                const cue = document.createElement("div");
                cue.textContent = `${ACTION_HINT} ›`;
                cue.style.cssText = `font:600 11px ${fontFamily};color:${c.hc ? fg : accent};margin-top:7px`;
                mWrap.appendChild(cue);
                const fire = (): void => onAction(action);
                mWrap.addEventListener("click", fire);
                mWrap.addEventListener("keydown", (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fire(); }
                });
                mWrap.addEventListener("mouseenter", () => { mWrap.style.background = c.hover; });
                mWrap.addEventListener("mouseleave", () => { mWrap.style.background = "transparent"; });
                mWrap.addEventListener("focus", () => { mWrap.style.outline = `2px solid ${c.hc ? fg : accent}`; mWrap.style.outlineOffset = "1px"; });
                mWrap.addEventListener("blur", () => { mWrap.style.outline = "none"; });
            }
            card.appendChild(mWrap);
        }

        for (const line of sec.lines) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:flex-start;gap:10px;margin-bottom:9px";
            const dot = document.createElement("span"); dot.setAttribute("aria-hidden", "true");
            dot.style.cssText = `flex:0 0 auto;width:8px;height:8px;border-radius:50%;margin-top:6px;background:${toneColor(line.tone, c)}`;
            const text = document.createElement("div"); text.textContent = line.text;
            text.style.cssText = `font:${line.strong ? "600 " : ""}14px/1.5 ${fontFamily};color:${fg}` + (line.strong ? "" : ";opacity:0.9");
            row.appendChild(dot); row.appendChild(text); card.appendChild(row);
        }
        grid.appendChild(card);
    }
    host.appendChild(wrap);
    return page;
}
