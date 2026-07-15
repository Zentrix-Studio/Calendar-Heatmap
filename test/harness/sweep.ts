/*
 * Generic settings enumerator. Walks any formatting-model (cards → slices),
 * infers each slice's type, and emits one Candidate per non-default value to try.
 * Reusable across visuals; the per-visual knowledge (which cards are gated, which
 * settings can't show an effect with the base dataset) lives in CONFIG below.
 */
"use strict";

import { VisualFormattingSettingsModel } from "../../src/settings";

type Model = VisualFormattingSettingsModel;

export interface Candidate {
    cardName: string;
    sliceName: string;
    label: string;
    /** Enable any gate needed for this setting to take visible effect. */
    prereq?: (m: Model) => void;
    /** Apply the candidate value to the live model. */
    apply: (m: Model) => void;
    /** True → the rendered SVG must differ from the pre-apply render. */
    expectChange: boolean;
    /** True → this setting legitimately renders ZERO day cells (it swaps the
     *  calendar for an alternate view, e.g. the summary table), so the sweep's
     *  "cells still render" guard must not apply. */
    allowNoCells?: boolean;
}

// --- model navigation helpers ----------------------------------------------
const findCard = (m: Model, name: string): any => (m.cards as any[]).find(c => c.name === name);
const findSlice = (m: Model, card: string, slice: string): any =>
    findCard(m, card)?.slices.find((s: any) => s.name === slice);

const setToggle = (m: Model, c: string, s: string, v: boolean) => { findSlice(m, c, s).value = v; };
const setDrop = (m: Model, c: string, s: string, val: string) => {
    const sl = findSlice(m, c, s); sl.value = sl.items.find((i: any) => i.value === val) ?? sl.value;
};

type SliceKind = "dropdown" | "toggle" | "num" | "text" | "color" | "unknown";
function kindOf(slice: any): SliceKind {
    if (Array.isArray(slice.items)) return "dropdown";
    const v = slice.value;
    if (typeof v === "boolean") return "toggle";
    if (typeof v === "number") return "num";
    if (typeof v === "string") return "text";
    if (v && typeof v.value === "string") return "color";
    return "unknown";
}

// --- per-visual knowledge ---------------------------------------------------
// prereq: gate to flip on so the setting can show. smoke: true → only check
// "no throw / not blank" (effect needs a dataset/runtime context the base sweep
// doesn't provide — covered by the dedicated faceted / multi-year / interaction
// tests instead). Keyed by `card` (whole card) or `card.slice` (one slice).
const showHeader = (m: Model) => setToggle(m, "labels", "showHeader", true);
const badgesOn = (m: Model) => { setToggle(m, "badges", "peakOn", true); setToggle(m, "badges", "thresholdOn", true); };
// Z-146 — enable rule N so its sub-field candidates evaluate against an ACTIVE
// rule (defaults op >=, value 0 → matches every valued cell; cue toggles hatch/badge).
const ruleOn = (n: 1 | 2 | 3) => (m: Model) => setToggle(m, "badges", `rule${n}On`, true);
// Z-149 — a rule's pattern STYLE only draws (and so can change the SVG) when both
// the rule and its pattern toggle are on.
const rulePatternOn = (n: 1 | 2 | 3) => (m: Model) => {
    setToggle(m, "badges", `rule${n}On`, true);
    setToggle(m, "badges", `rule${n}Pattern`, true);
};

// `gates`: toggle slices that ARE the card's gate. Turning them on is itself the
// effect under test, so they must NOT receive the card prereq (which would
// pre-enable them and leave the candidate a no-op).
const CARD_RULES: Record<string, { prereq?: (m: Model) => void; smoke?: boolean; gates?: string[] }> = {
    header: { prereq: showHeader },
    headline: { prereq: showHeader },
    statChips: { prereq: showHeader },
    badges: { prereq: badgesOn, gates: ["peakOn", "thresholdOn", "rule1On", "rule2On", "rule3On"] },
    timeIntel: { smoke: true },        // affects insight text only — subtle
    smallMultiples: { smoke: true },   // needs a faceted dataset
    facetTitle: { smoke: true },       // needs a faceted dataset
    yearTags: { smoke: true },         // needs a multi-year dataset
    toolbar: { smoke: true },          // overlay chrome, not the SVG
    branding: { smoke: true },         // tooltip attribution, not the SVG
    accessibility: { smoke: true },    // focus ring is runtime; pattern overridden below
    dayDetail: { smoke: true },        // click-driven DOM panel (Z-145), not the SVG
    // Z-152 — NOT smoke. The sweep's DataView seeds SAMPLE_NOTES into the persisted
    // note store, so the annotation layer actually draws and each display pref has a
    // provable effect on the SVG. (Seeding beats marking the card smoke-only: with no
    // notes present every one of these settings is trivially effect-less, which would
    // be green coverage proving nothing.) `gates` — `show` IS the card's gate, so
    // turning it off is itself the effect under test.
    annotations: { gates: ["show"] },
};
const SLICE_RULES: Record<string, { prereq?: (m: Model) => void; smoke?: boolean; noCells?: boolean }> = {
    // Summary table — an alternate full-screen VIEW: enabling it removes every
    // day cell by design (the table replaces the grid). The SVG-change assertion
    // still applies (the swap is a huge visible effect); only the cell guard is
    // relaxed. Exclusivity is pinned by test/render/summaryTable.test.ts.
    "summaryTable.show": { noCells: true },
    // Data-level: consumed by Visual.update() to BUILD the model (not by render).
    // The optimistic rerender path can't show them; the host update()/rebuild path
    // does. Covered by the dedicated buildFacetedModel test instead.
    "dataDisplay.firstDayOfWeek": { smoke: true },
    "dataDisplay.aggregation": { smoke: true },
    // Gradient length only applies to a CONTINUOUS palette; default is 5 buckets.
    "legend.gradientLength": { prereq: m => setDrop(m, "colors", "bucketCount", "0") },
    "colors.startColor": { prereq: m => setDrop(m, "colors", "paletteMode", "mono") },
    "colors.endColor": { prereq: m => setDrop(m, "colors", "paletteMode", "duotone") },
    "colors.splitLow": { prereq: m => setDrop(m, "colors", "paletteMode", "split") },
    "colors.splitMid": { prereq: m => setDrop(m, "colors", "paletteMode", "split") },
    "colors.splitHigh": { prereq: m => setDrop(m, "colors", "paletteMode", "split") },
    // patternOnThreshold: decoupled from badgesOn (Z-105b) — now has its own threshold.
    // Default threshold is 0, so toggling it ON immediately hatches all valued cells.
    "accessibility.patternOnThreshold": { smoke: false },
    // patternThresholdValue only produces a visible change when patternOnThreshold is on.
    "accessibility.patternThresholdValue": { prereq: m => setToggle(m, "accessibility", "patternOnThreshold", true), smoke: false },

    // Z-146 rule slots. The CUE fields (pattern; color is a `color` kind handled
    // separately below) need their rule ON to draw — prereq enables it and the
    // default op>=/value0 matches every cell, so the cue is visible. The metadata
    // fields (name/operator/value/value2/compareTo/badge) don't, on their own,
    // change the SVG with no cue set → smoke. (Engine correctness is covered by
    // the dedicated test/render/rules.test.ts.)
    "badges.rule1Pattern": { prereq: ruleOn(1), smoke: false },
    "badges.rule2Pattern": { prereq: ruleOn(2), smoke: false },
    "badges.rule3Pattern": { prereq: ruleOn(3), smoke: false },
    // Z-149 — per-rule pattern style. Needs the rule + its pattern toggle on so the
    // style change (different <pattern> def / url() fill) shows in the SVG.
    "badges.rule1PatternStyle": { prereq: rulePatternOn(1), smoke: false },
    "badges.rule2PatternStyle": { prereq: rulePatternOn(2), smoke: false },
    "badges.rule3PatternStyle": { prereq: rulePatternOn(3), smoke: false },
    "badges.rule1Color": { prereq: ruleOn(1), smoke: false },
    "badges.rule2Color": { prereq: ruleOn(2), smoke: false },
    "badges.rule3Color": { prereq: ruleOn(3), smoke: false },
    "badges.rule1Name": { smoke: true }, "badges.rule2Name": { smoke: true }, "badges.rule3Name": { smoke: true },
    "badges.rule1Operator": { smoke: true }, "badges.rule2Operator": { smoke: true }, "badges.rule3Operator": { smoke: true },
    "badges.rule1Value": { smoke: true }, "badges.rule2Value": { smoke: true }, "badges.rule3Value": { smoke: true },
    "badges.rule1Value2": { smoke: true }, "badges.rule2Value2": { smoke: true }, "badges.rule3Value2": { smoke: true },
    "badges.rule1CompareTo": { smoke: true }, "badges.rule2CompareTo": { smoke: true }, "badges.rule3CompareTo": { smoke: true },
    "badges.rule1Badge": { prereq: ruleOn(1), smoke: true }, "badges.rule2Badge": { prereq: ruleOn(2), smoke: true }, "badges.rule3Badge": { prereq: ruleOn(3), smoke: true },

    // Z-152 annotations. The marker ICON only draws in Icon mode (the default marker
    // is a number), so the icon candidate needs that prereq to show any effect.
    "annotations.markerIcon": { prereq: m => setDrop(m, "annotations", "markerStyle", "icon"), smoke: false },
    // defaultMode governs what a NEWLY-created note shows. Existing notes carry their
    // own mode in the store, so changing it cannot repaint anything already on screen.
    "annotations.defaultMode": { smoke: true },
};

function ruleFor(card: string, slice: string, kind: SliceKind) {
    const c = CARD_RULES[card] ?? {};
    const s = SLICE_RULES[`${card}.${slice}`] ?? {};
    const isGate = kind === "toggle" && (c.gates ?? []).includes(slice);
    return {
        prereq: s.prereq ?? (isGate ? undefined : c.prereq),
        smoke: s.smoke !== undefined ? s.smoke : !!c.smoke,
        allowNoCells: !!s.noCells,
    };
}

// --- candidate value generation --------------------------------------------
function numCandidates(slice: any): number[] {
    const d = slice.value as number;
    const set = new Set<number>([d + 1, Math.max(1, Math.round(d * 2)), d === 0 ? 2 : 0]);
    set.delete(d);
    return [...set].slice(0, 2);
}

/** Build the full candidate list by introspecting a probe model. */
export function enumerateCandidates(): Candidate[] {
    const out: Candidate[] = [];
    const probe = new VisualFormattingSettingsModel();

    for (const card of probe.cards as any[]) {
        for (const slice of card.slices as any[]) {
            const cardName = card.name as string;
            const sliceName = slice.name as string;
            const { prereq, smoke, allowNoCells } = ruleFor(cardName, sliceName, kindOf(slice));
            const expectChange = !smoke;
            const add = (label: string, apply: (m: Model) => void) =>
                out.push({ cardName, sliceName, label: `${cardName}.${sliceName} → ${label}`, prereq, apply, expectChange, allowNoCells });

            switch (kindOf(slice)) {
                case "dropdown":
                    for (const it of slice.items as any[]) {
                        if (it.value === slice.value.value) continue;
                        add(String(it.displayName ?? it.value), m => setDrop(m, cardName, sliceName, it.value));
                    }
                    break;
                case "toggle":
                    add(String(!slice.value), m => { findSlice(m, cardName, sliceName).value = !slice.value; });
                    break;
                case "num":
                    for (const n of numCandidates(slice))
                        add(String(n), m => { findSlice(m, cardName, sliceName).value = n; });
                    break;
                case "color":
                    add("#E5484D", m => { findSlice(m, cardName, sliceName).value = { value: "#E5484D" }; });
                    break;
                case "text":
                    add('"ZTEST"', m => { findSlice(m, cardName, sliceName).value = "ZTEST"; });
                    break;
                default:
                    break;
            }
        }
    }
    return out;
}
