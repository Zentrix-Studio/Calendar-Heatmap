"use strict";

import type powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { VisualFormattingSettingsModel } from "../settings";
import { ZentrixSettingsBar } from "./zentrixSettingsBar";
import { SB_CATS, SB_FONTS, SB_PALETTES, SB_PRESETS, SB_EMOJI, makeCfg, applyLocal, readLocal } from "./settingsSchema";

type Model = VisualFormattingSettingsModel;

/** Shallow-clone a slice value so the live model can't share a default object
 *  reference with the throwaway defaults model (which would alias future edits). */
function clone<T>(v: T): T {
    if (v && typeof v === "object") return { ...(v as object) } as T;
    return v;
}

/** Serialize a slice's value into the shape persistProperties expects, by the
 *  same kind-inference the settings sweep uses. Returns undefined for kinds we
 *  can't persist (composite/unknown) so they are skipped, not corrupted. */
function persistValue(slice: { value: unknown; items?: unknown[] }): powerbi.DataViewPropertyValue | undefined {
    const v = slice.value as { value?: unknown } | boolean | number | string | null;
    if (Array.isArray(slice.items)) return String((v as { value: unknown }).value);   // dropdown → item value
    if (typeof v === "boolean" || typeof v === "number" || typeof v === "string") return v;
    if (v && typeof v.value === "string") return { solid: { color: v.value } } as unknown as powerbi.DataViewPropertyValue; // color
    return undefined;
}

/**
 * In-visual settings overlay. Thin host wrapper around the reusable Zentrix
 * Settings Bar: wires the live formatting model + persistProperties to the bar
 * and forwards theme / position / visibility from the visual's update loop.
 * Public API (constructor, update, setCorner, forceOpen) is unchanged so
 * visual.ts and the preview harness keep working as-is.
 */
export class SettingsOverlay {
    private bar: ZentrixSettingsBar;
    private settings!: Model;
    private pref = "auto";
    /** Optimistic edits not yet confirmed by a host round-trip — replayed onto every
     *  freshly-populated model so a stale update() can't revert the canvas. */
    private pending = new Map<string, unknown>();

    constructor(root: HTMLElement, private host: IVisualHost, private onChange?: () => void) {
        const persist = (object: string, prop: string, value: powerbi.DataViewPropertyValue) =>
            this.host.persistProperties({ merge: [{ objectName: object, selector: null, properties: { [prop]: value } }] } as powerbi.VisualObjectInstancesToPersist);
        // On every edit: record it as pending (so the next host update() can't clobber it)
        // and repaint immediately from the optimistically-updated model.
        const cfg = makeCfg(() => this.settings, persist, (key, value) => {
            this.pending.set(key, value);
            this.onChange?.();
        }, () => this.reset());
        this.bar = new ZentrixSettingsBar(root, {
            cfg, cats: SB_CATS, fonts: SB_FONTS, palettes: SB_PALETTES, presets: SB_PRESETS, emoji: SB_EMOJI,
            corner: "bl", dark: false, closeOnAway: true,
        });
    }

    update(s: Model, dark: boolean, forceHidden = false): void {
        // Reconcile pending optimistic edits against the freshly-populated model.
        // If the host has confirmed an edit (round-tripped through the dataView),
        // drop it; otherwise re-apply it so this repopulate doesn't revert it.
        for (const [key, val] of this.pending) {
            if (String(readLocal(s, key)) === String(val)) this.pending.delete(key); // host confirmed
            else applyLocal(s, key, val);                                            // not yet → keep showing it
        }
        this.settings = s;
        this.applyTheme(dark);
        this.bar.setVisible(s.toolbar.show.value && !forceHidden);
        this.bar.setCloseOnAway(s.toolbar.closeOnClickAway.value);
        this.pref = (s.toolbar.position.value.value as string) || "auto";
        if (this.pref !== "auto") this.bar.setCorner(this.pref);
        // Controls update their own DOM optimistically; we deliberately do not
        // rebuild the open popover here (persistProperties fires update() on
        // every change, and a mid-interaction rebuild would flicker / drop focus).
    }

    /** Theme the bar from the host: Power BI high contrast wins over light/dark.
     *  In HC we hand the bar the host's HC roles so its chrome matches the rest of
     *  the visual; otherwise we fall back to the auto-detected light/dark theme. */
    private applyTheme(dark: boolean): void {
        const palette = this.host.colorPalette;
        if (palette.isHighContrast) {
            const v = (c?: { value?: string }) => c && c.value;
            this.bar.setHighContrast(true, {
                foreground: v(palette.foreground),
                background: v(palette.background),
                foregroundSelected: v(palette.foregroundSelected),
                hyperlink: v(palette.hyperlink),
            });
        } else {
            this.bar.setHighContrast(false);
            this.bar.setTheme(dark);
        }
    }

    /**
     * Reset every visual property to its model default (Z-137 §4). Power BI owns
     * the persisted formatting, so we remove each object's properties — the model
     * then falls back to the declared defaults on the next populate. We ALSO copy
     * the defaults onto the live model and clear pending optimistic edits, so the
     * canvas reverts immediately without waiting for the host round-trip.
     */
    private reset(): void {
        if (!this.settings) return;
        // `removeObject` wipes each object's persisted properties entirely, so the
        // model falls back to its declared defaults on the next populate. (A plain
        // `remove` with empty properties{} would be a no-op.)
        const removeObject = (this.settings.cards as { name: string }[]).map(c => ({
            objectName: c.name, selector: null, properties: {},
        }));
        this.host.persistProperties({ removeObject } as unknown as powerbi.VisualObjectInstancesToPersist);

        // UAT-1 (2026-07-15): Power BI Desktop silently ignores the removeObject op,
        // so the revert above never reached the report — the next host render brought
        // every pre-reset setting back. The merge path is the one persistence route
        // proven to work in every host (all normal edits use it), so ALSO persist each
        // slice's default value explicitly. Where removeObject IS honored this merge
        // lands after it and the net state is identical (defaults). Iterates cards
        // only — the notesStore blob is not a card, so annotations survive Reset.
        const defaults = new VisualFormattingSettingsModel();
        const merge: { objectName: string; selector: null; properties: Record<string, powerbi.DataViewPropertyValue> }[] = [];
        for (const card of defaults.cards as { name: string; slices?: { name: string; value: unknown; items?: unknown[] }[] }[]) {
            const properties: Record<string, powerbi.DataViewPropertyValue> = {};
            for (const slice of card.slices ?? []) {
                const v = persistValue(slice);
                if (v !== undefined) properties[slice.name] = v;
            }
            if (Object.keys(properties).length) merge.push({ objectName: card.name, selector: null, properties });
        }
        this.host.persistProperties({ merge } as unknown as powerbi.VisualObjectInstancesToPersist);

        // Optimistic local revert: copy each slice's default value from a fresh model.
        const liveCards = this.settings.cards as { slices?: { value: unknown; name: string }[] }[];
        const defCards = defaults.cards as { slices?: { value: unknown; name: string }[] }[];
        liveCards.forEach((card, ci) => {
            const defSlices = defCards[ci]?.slices ?? [];
            (card.slices ?? []).forEach((slice, si) => {
                const d = defSlices[si];
                if (d && d.name === slice.name) slice.value = clone(d.value);
            });
        });
        this.pending.clear();
        this.onChange?.();
    }

    /** Called by the visual after layout when position = Auto. No-op otherwise. */
    setCorner(corner: string): void {
        if (this.pref === "auto") this.bar.setCorner(corner);
    }

    /** Harness helper — open the bar and (optionally) the sub-group `active`. */
    forceOpen(active?: string): void {
        this.bar.forceOpen(active);
    }

    /** True while the in-visual settings bar is open (issue #7 — suppress hover cards). */
    isOpen(): boolean {
        return this.bar.isOpen();
    }
}
