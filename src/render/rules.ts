"use strict";

import { DayCell } from "../types";
import { PatternStyle } from "./patterns";
import { posSafe, negSafe } from "../theme/zentrixTokens";

/**
 * rules.ts (Z-146) — a small, business-friendly rules engine that GENERALIZES
 * the shipped single emoji threshold into N rules ("good day / bad day / target
 * breach"). It builds ON the existing badges plumbing (drawBadge in states.ts)
 * — it does not replace it. The legacy single threshold is expressed as Rule 1's
 * default shape, so pre-existing reports render identically (back-compat — §4).
 *
 * Colors default to the CVD-safe Okabe-Ito pair from the token mirror (Z-148);
 * users may override via a ColorPicker. No raw hex literals here (hex-ban).
 */

export type RuleOperator = ">=" | ">" | "<=" | "<" | "==" | "between";
export type RuleCompareTo = "value" | "target";

export interface Rule {
    /** Human label, surfaced in tooltip/panel when a day matches. */
    name: string;
    operator: RuleOperator;
    /** Threshold (or low bound for "between"). */
    value: number;
    /** High bound, only used for "between". */
    value2?: number;
    /** Compare the day's value against a constant OR its bound Target. */
    compareTo: RuleCompareTo;
    /** Emoji badge on matching cells (optional). */
    badge?: string;
    /** Cell color cue on matching cells (token-sourced default; optional). */
    color?: string;
    /** CVD hatch on matching cells (folds into the existing pattern path). */
    patternOn?: boolean;
    /** Which Core-5 pattern style to draw when `patternOn` (Z-149). Defaults to
     *  `diagonal` (the legacy hatch) when unset — back-compat for saved rules. */
    patternStyle?: PatternStyle;
}

/** Token-sourced semantic defaults — exported so settings/UI defaults stay token-clean. */
export const RULE_GOOD_COLOR = posSafe; // over / good
export const RULE_BAD_COLOR = negSafe;  // under / breach / bad

/** The number on the left of the comparison for a day under a given rule. */
function lhs(d: DayCell, rule: Rule): number | null {
    if (rule.compareTo === "target") {
        // Compare value against the bound Target; null when either is missing.
        if (d.value == null || d.target == null || !isFinite(d.target)) return null;
        return d.value - d.target; // matched against `value` interpreted as a delta from target
    }
    return d.value;
}

/** Does this day satisfy this rule? No-op rules (no cue) still "match" for naming purposes. */
export function ruleMatches(d: DayCell, rule: Rule): boolean {
    if (d.noData) return false;
    const x = lhs(d, rule);
    if (x == null) return false;
    switch (rule.operator) {
        case ">=": return x >= rule.value;
        case ">": return x > rule.value;
        case "<=": return x <= rule.value;
        case "<": return x < rule.value;
        case "==": return x === rule.value;
        case "between": {
            const hi = rule.value2 ?? rule.value;
            const lo = Math.min(rule.value, hi);
            const up = Math.max(rule.value, hi);
            return x >= lo && x <= up;
        }
        default: return false;
    }
}

export interface RuleHit {
    /** The first matched rule (in order) that carries a color cue. */
    colorRule: Rule | null;
    /** The first matched rule (in order) with its CVD hatch on. */
    patternRule: Rule | null;
    /** The first rule (in order) with a badge. */
    badgeRule: Rule | null;
    /** Every matched rule, in order (for naming in tooltip/panel). */
    matched: Rule[];
}

/**
 * Evaluate rules for a day, top-to-bottom. Each CUE CHANNEL resolves independently,
 * first-match-wins: color, hatch, and badge each go to the first matched rule that
 * asks for that channel. A higher rule therefore still overrides a lower one for the
 * SAME cue ("target breach" beats "bad day" on color), but it no longer swallows a
 * cue it never asked for — previously a single `cueRule` (first rule with color OR
 * pattern) meant rule 2's "CVD hatch" toggle silently drew nothing whenever rule 1
 * matched with a color, i.e. the switch was dead. One badge per cell is unchanged.
 */
export function evaluateRules(d: DayCell, rules: Rule[]): RuleHit {
    let colorRule: Rule | null = null;
    let patternRule: Rule | null = null;
    let badgeRule: Rule | null = null;
    const matched: Rule[] = [];
    for (const r of rules) {
        if (!ruleMatches(d, r)) continue;
        matched.push(r);
        if (!colorRule && r.color) colorRule = r;
        if (!patternRule && r.patternOn) patternRule = r;
        if (!badgeRule && r.badge) badgeRule = r;
    }
    return { colorRule, patternRule, badgeRule, matched };
}

/** Name of the first matched rule for a day, or null — for tooltip/panel surfacing. */
export function matchedRuleName(d: DayCell, rules: Rule[]): string | null {
    const hit = evaluateRules(d, rules);
    return hit.matched.length ? hit.matched[0].name : null;
}
