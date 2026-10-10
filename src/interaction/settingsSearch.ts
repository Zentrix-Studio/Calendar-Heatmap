"use strict";

/**
 * Settings search — a pure, DOM-free index + matcher over the gear tree (SB_CATS).
 *
 * It finds a setting by its exact name, a close (typo) name, OR a different *word*
 * for the same thing, so a user who knows Power BI's own vocabulary finds our
 * control even when we named it differently. The synonym table is grounded in real
 * Power BI formatting-pane terminology (learn.microsoft.com) plus the words people
 * actually use for a calendar — our "Rules" is Power BI's "conditional formatting /
 * fx"; our "Combine values by" is their "aggregation"; our "Small multiples" is a
 * "facet" or "trellis" elsewhere.
 *
 * Calendar Heatmap copy (HM-V2-40): carried from the Financial Chart (it indexes option
 * labels — F-025) with the trading block below replaced by calendar words.
 *
 * ⚠️ **This table is per-visual and must be ADAPTED when the file is carried.** It
 * arrived from Sankey Pro describing ribbons, nodes, stages, funnels, bezier
 * curvature and churn, and shipped that way — so "moving average", "Heikin-Ashi"
 * and "OHLC" found nothing in a candlestick visual while "churn" matched "Chart
 * title". The file's own header claimed it was unit-tested; it was at 5.7%
 * statement coverage. Both are fixed (ledger F-025).
 *
 * Certification-safe: no network, no `eval`, no external data — a deterministic
 * function over static schema text.
 */

import type { SBCategory, SBField } from "./zentrixSettingsBar";

/** One searchable control, flattened out of the category → sub → field tree. */
export interface SearchEntry {
    /** Engine key used to jump to and highlight the control (data-fkey). */
    key: string;
    label: string;
    catId: string;
    catName: string;
    subId: string;
    subName: string;
    /**
     * Extra searchable words that are NOT the display label — today, the control's
     * own OPTION labels.
     *
     * Without this the index held field labels only, so every enum VALUE was
     * invisible: the chart modes live on one field called "Chart type", and
     * searching the thing a reader of a candlestick visual is most likely to type —
     * "Heikin-Ashi", "OHLC", "candlestick" — found nothing at all (F-025). Kept
     * separate from `label` so the result still displays the control's real name.
     */
    terms?: string;
}

export type MatchType = "exact" | "starts" | "contains" | "category" | "option" | "synonym" | "fuzzy";

export interface SearchResult extends SearchEntry {
    score: number;
    matchType: MatchType;
    /** "You mean this" context — present only for non-literal (synonym/fuzzy) hits,
     *  telling the user WHY this control matched what they typed. */
    hint?: string;
}

/**
 * Concept map: `canon` = the words that actually appear in our labels; `aliases` =
 * the Power BI / everyday words a user is likely to type instead. Researched against
 * the Power BI formatting-pane vocabulary and the Sankey vocabulary in
 * PRODUCT-DEFINITION — extend it here, never inline.
 */
const CONCEPTS: { canon: string[]; aliases: string[] }[] = [
    { canon: ["rule", "rules"], aliases: ["conditional formatting", "conditional format", "conditional", "fx", "threshold", "thresholds", "format by rule", "format rule"] },
    { canon: ["opacity", "transparent", "dimmed"], aliases: ["transparency", "alpha", "fade", "see through", "translucent", "ghost"] },
    { canon: ["colour", "color", "palette"], aliases: ["data colors", "data colours", "data color", "data colour", "fill colour", "fill color", "sentiment", "recolour", "recolor", "theme colours", "theme colors"] },
    { canon: ["label", "labels", "title", "titles"], aliases: ["data labels", "data label", "callout", "callout value", "value label", "text label", "name tag", "caption", "heading"] },
    { canon: ["border"], aliases: ["outline", "stroke", "frame", "ring", "visual border"] },
    { canon: ["pattern", "patterns"], aliases: ["texture", "hatch", "hatching", "stripe", "stripes", "fill pattern", "accessibility pattern"] },
    { canon: ["legend"], aliases: ["key", "colour key", "color key", "swatch key"] },
    { canon: ["gradient"], aliases: ["color scale", "colour scale", "colorscale", "continuous", "sequential", "heat", "ramp", "blend"] },
    { canon: ["width", "thickness", "spacing"], aliases: ["weight", "stroke width", "line width", "thick", "boldness", "gap", "padding", "margin"] },
    { canon: ["font", "text size"], aliases: ["font family", "font size", "typography", "typeface", "point size"] },
    { canon: ["background", "backdrop"], aliases: ["canvas colour", "canvas color", "plot background", "fill background"] },
    { canon: ["tooltip", "tooltips"], aliases: ["hover", "popup", "pop up", "infotip", "hover card", "mouseover"] },
    { canon: ["zoom", "pan", "fill space"], aliases: ["zoom slider", "scroll", "magnify", "pan and zoom", "fit", "fit to view"] },
    { canon: ["ranking", "rank", "top n", "show"], aliases: ["topn", "top-n", "bottom n", "leaderboard", "limit", "cap", "truncate", "filter"] },
    { canon: ["other"], aliases: ["remainder", "rest", "bucket", "grouped", "misc", "everything else"] },
    // ── This visual's own vocabulary (Calendar Heatmap) — every canon word appears in
    //    a label or option in settingsSchema.ts; the aliases are what people call it. ──
    { canon: ["calendar", "year", "months", "hours"], aliases: ["layout", "contribution graph", "github", "month blocks", "hour of day", "time of day", "weekday grid", "punch card"] },
    { canon: ["combine values by"], aliases: ["aggregation", "aggregate", "summarize", "summarise", "total", "sum", "mean", "count", "minimum", "maximum"] },
    { canon: ["week starts on"], aliases: ["first day of week", "week start", "start of week", "sunday", "monday"] },
    { canon: ["fiscal"], aliases: ["financial year", "fy", "fiscal calendar", "tax year", "april start", "july start"] },
    { canon: ["small multiples", "columns", "shared colour scale"], aliases: ["facet", "facets", "trellis", "split by", "panels", "per category", "one calendar per"] },
    { canon: ["max cell size", "row gap", "column gap", "corner radius"], aliases: ["cell size", "square size", "density", "compact", "spacing", "rounded", "round corners", "tile size"] },
    { canon: ["dim other days", "dim strength"], aliases: ["selection", "selected", "highlight", "cross filter", "cross-filter", "cross highlight", "fade others"] },
    { canon: ["scale", "colour steps", "quantile"], aliases: ["buckets", "bins", "binning", "classes", "discrete", "steps", "percentile", "linear", "logarithmic"] },
    { canon: ["weekend", "weekends", "holidays"], aliases: ["non-working", "non working", "working days", "business days", "public holiday", "bank holiday", "days off"] },
    { canon: ["events", "event type key"], aliases: ["milestone", "milestones", "incident", "release", "outage", "happenings", "event marker"] },
    { canon: ["day detail", "top contributor"], aliases: ["drill", "details", "click panel", "breakdown", "side panel", "day panel"] },
    { canon: ["week numbers"], aliases: ["iso week", "week number", "week no", "wk"] },
    { canon: ["values in cells"], aliases: ["cell labels", "numbers in cells", "show values", "value in cell"] },
    { canon: ["mark peak", "mark threshold", "badge"], aliases: ["best day", "max day", "highest day", "emoji", "flag high", "star"] },
    { canon: ["focus ring", "pattern on threshold"], aliases: ["keyboard", "accessibility", "a11y", "screen reader", "colour blind", "color blind", "cvd"] },
    { canon: ["variance", "comparison", "compare"], aliases: ["delta", "difference", "change", "vs", "versus", "budget", "actual", "target", "scenario", "prior", "last month"] },
    { canon: ["drop-off", "drop off"], aliases: ["churn", "attrition", "leakage", "loss", "abandon", "abandonment", "fall out", "fallout"] },
    { canon: ["insight", "insights", "diagnostics", "integrity"], aliases: ["analysis", "analytics", "narrative", "summary", "explain", "story", "data quality", "audit", "reconcile", "balance", "imbalance"] },
    { canon: ["display units", "decimals", "accounting"], aliases: ["number format", "format", "thousands", "millions", "billions", "abbreviate", "precision", "decimal places", "currency", "negative"] },
    { canon: ["summary table", "table"], aliases: ["grid", "data table", "show as table", "tabular", "matrix"] },
    { canon: ["shadow", "halo"], aliases: ["drop shadow", "glow", "depth", "elevation"] },
    { canon: ["export", "download"], aliases: ["save", "csv", "excel", "xlsx", "pdf", "png", "image export", "snapshot", "print", "share"] },
    { canon: ["note", "notes", "annotation", "annotations"], aliases: ["comment", "comments", "sticky", "sticky note", "callout note", "markup", "memo"] },
];

/** Flatten SB_CATS into a searchable entry per control (with an engine key). */
/** A control's option labels, flattened into one searchable string. An option is a
 *  plain string, a `[value, label]` pair, or a `{ value, label }` config. */
function optionTerms(f: SBField): string | undefined {
    const options = (f as unknown as { options?: unknown[] }).options;
    if (!Array.isArray(options) || !options.length) return undefined;
    const words: string[] = [];
    for (const o of options) {
        if (typeof o === "string") words.push(o);
        else if (Array.isArray(o) && o.length > 1) words.push(String(o[1]));
        else if (o && typeof o === "object") {
            const label = (o as { label?: unknown }).label;
            if (typeof label === "string") words.push(label);
        }
    }
    return words.length ? words.join(" ") : undefined;
}

export function buildSearchIndex(cats: SBCategory[]): SearchEntry[] {
    const out: SearchEntry[] = [];
    for (const cat of cats) {
        for (const sub of cat.subs || []) {
            const subName = sub.name || "";
            // A menu/swatch sub IS itself one control (its own key).
            if ((sub.kind === "menu" || sub.kind === "swatch") && sub.key) {
                out.push({ key: sub.key, label: subName || sub.key, catId: cat.id, catName: cat.name, subId: sub.id, subName });
                continue;
            }
            for (const f of sub.fields || []) {
                const key = f.key ?? (f.keys && f.keys[0]);
                const label = f.label;
                // Skip structural rows (dividers/headings/notes) and keyless controls.
                if (!key || !label || f.control === "divider" || f.control === "heading" || f.control === "note") continue;
                out.push({
                    key, label, catId: cat.id, catName: cat.name, subId: sub.id, subName,
                    terms: optionTerms(f),
                });
            }
        }
    }
    return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Bounded Levenshtein — good enough for single-word typo tolerance. */
function editDistance(a: string, b: string): number {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[b.length];
}

/** Is `needle` present in `haystack` as a whole word or phrase, rather than as a
 *  bare substring? Both are already normalised to lowercase, space-separated words. */
function containsWord(haystack: string, needle: string): boolean {
    if (haystack === needle) return true;
    if (needle.length > haystack.length) return false;
    let from = 0;
    for (;;) {
        const i = haystack.indexOf(needle, from);
        if (i < 0) return false;
        const startsWord = i === 0 || haystack[i - 1] === " ";
        const endsWord = i + needle.length === haystack.length || haystack[i + needle.length] === " ";
        if (startsWord && endsWord) return true;
        from = i + 1;
    }
}

/** Which alias phrase(s) the query invokes, and the canon tokens they map to. */
function conceptsForQuery(q: string): { alias: string; canon: string[] }[] {
    const hits: { alias: string; canon: string[] }[] = [];
    for (const c of CONCEPTS) {
        for (const alias of c.aliases) {
            // Either phrase may contain the other, but only on WORD boundaries. A bare
            // substring test made every alias a trap for any longer word spelled around
            // it: the 3-letter alias "key" matched "sankey", "monkey" and "turkey", all
            // of which were answered with the Legend controls (F-025).
            if (q.length >= 2 && (q === alias || containsWord(q, alias) || containsWord(alias, q))) {
                hits.push({ alias, canon: c.canon });
                break;
            }
        }
    }
    return hits;
}

/**
 * Rank the index against `query`. exact/starts/contains beat synonym, which beats a
 * fuzzy (typo) match. Category-name matches rank below own-label matches.
 */
export function searchSettings(index: SearchEntry[], query: string, limit = 25): SearchResult[] {
    const q = norm(query);
    if (q.length < 2) return [];
    const conceptHits = conceptsForQuery(q);
    const results: SearchResult[] = [];

    for (const e of index) {
        const label = norm(e.label);
        const cat = norm(e.catName);
        const subn = norm(e.subName);
        let best: { score: number; matchType: MatchType; hint?: string } | null = null;

        if (label === q) best = { score: 100, matchType: "exact" };
        else if (label.startsWith(q)) best = { score: 88, matchType: "starts" };
        else if (label.includes(q)) best = { score: 74, matchType: "contains" };
        else if (subn.includes(q) || cat.includes(q)) best = { score: 58, matchType: "category" };
        else if (e.terms && norm(e.terms).includes(q)) {
            // One of this control's OPTIONS is what the user typed. Below the
            // control's own name, above a synonym — and the hint names the option,
            // because "Chart type" alone does not explain why it matched "Heikin".
            const hit = (e.terms.split(/\s{2,}|·/).find((t) => norm(t).includes(q)) ?? "").trim();
            best = { score: 62, matchType: "option", hint: hit ? `Option: ${hit}` : "One of its options" };
        }

        if (!best && conceptHits.length) {
            // Synonym: the query is a Power BI / everyday alias whose concept word
            // appears in this control's own text.
            const hay = `${label} ${subn} ${cat}`;
            for (const ch of conceptHits) {
                if (ch.canon.some((tok) => hay.includes(tok))) {
                    best = { score: 52, matchType: "synonym", hint: `Also called “${ch.alias}”` };
                    break;
                }
            }
        }

        if (!best) {
            // Fuzzy: a single label word within edit distance of the query (typo).
            const maxD = q.length <= 4 ? 1 : 2;
            for (const w of label.split(" ")) {
                if (w.length >= 3 && editDistance(w, q) <= maxD) {
                    best = { score: 38, matchType: "fuzzy", hint: "Did you mean this?" };
                    break;
                }
            }
        }

        if (best) results.push({ ...e, ...best });
    }

    results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return results.slice(0, limit);
}

/** Why a searched control is currently unavailable (hidden by data/mode, or dimmed
 *  by an unmet prerequisite), or undefined when it's fully active. Pure — the bar
 *  passes in a live `get`. */
export function gateReason(f: SBField | undefined, get: (k: string) => unknown): string | undefined {
    if (!f) return undefined;
    if (f.visibleIf && !f.visibleIf(get)) return "Not available with the current data or mode";
    if (f.dimIf && f.dimIf(get)) return (f.disabledReasonFn ? f.disabledReasonFn(get) : undefined) ?? f.disabledReason ?? "Currently unavailable";
    return undefined;
}
