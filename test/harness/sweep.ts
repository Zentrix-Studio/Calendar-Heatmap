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

// `gates`: toggle slices that ARE the card's gate. Turning them on is itself the
// effect under test, so they must NOT receive the card prereq (which would
// pre-enable them and leave the candidate a no-op).
const CARD_RULES: Record<string, { prereq?: (m: Model) => void; smoke?: boolean; gates?: string[] }> = {
    header: { prereq: showHeader },
    headline: { prereq: showHeader },
    statChips: { prereq: showHeader },
    badges: { prereq: badgesOn, gates: ["peakOn", "thresholdOn"] },
    timeIntel: { smoke: true },        // affects insight text only — subtle
    smallMultiples: { smoke: true },   // needs a faceted dataset
    facetTitle: { smoke: true },       // needs a faceted dataset
    yearTags: { smoke: true },         // needs a multi-year dataset
    toolbar: { smoke: true },          // overlay chrome, not the SVG
    branding: { smoke: true },         // tooltip attribution, not the SVG
    accessibility: { smoke: true },    // focus ring is runtime; pattern overridden below
};
const SLICE_RULES: Record<string, { prereq?: (m: Model) => void; smoke?: boolean }> = {
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
};

function ruleFor(card: string, slice: string, kind: SliceKind) {
    const c = CARD_RULES[card] ?? {};
    const s = SLICE_RULES[`${card}.${slice}`] ?? {};
    const isGate = kind === "toggle" && (c.gates ?? []).includes(slice);
    return {
        prereq: s.prereq ?? (isGate ? undefined : c.prereq),
        smoke: s.smoke !== undefined ? s.smoke : !!c.smoke,
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
            const { prereq, smoke } = ruleFor(cardName, sliceName, kindOf(slice));
            const expectChange = !smoke;
            const add = (label: string, apply: (m: Model) => void) =>
                out.push({ cardName, sliceName, label: `${cardName}.${sliceName} → ${label}`, prereq, apply, expectChange });

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
