"use strict";

import type powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { VisualFormattingSettingsModel } from "../settings";
import { ZentrixSettingsBar } from "./zentrixSettingsBar";
import { SB_CATS, SB_FONTS, SB_PALETTES, SB_PRESETS, SB_EMOJI, makeCfg, applyLocal, readLocal } from "./settingsSchema";

type Model = VisualFormattingSettingsModel;

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
        });
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
        this.bar.setTheme(dark);
        this.bar.setVisible(s.toolbar.show.value && !forceHidden);
        this.bar.setCloseOnAway(s.toolbar.closeOnClickAway.value);
        this.pref = (s.toolbar.position.value.value as string) || "auto";
        if (this.pref !== "auto") this.bar.setCorner(this.pref);
        // Controls update their own DOM optimistically; we deliberately do not
        // rebuild the open popover here (persistProperties fires update() on
        // every change, and a mid-interaction rebuild would flicker / drop focus).
    }

    /** Called by the visual after layout when position = Auto. No-op otherwise. */
    setCorner(corner: string): void {
        if (this.pref === "auto") this.bar.setCorner(corner);
    }

    /** Harness helper — open the bar and (optionally) the sub-group `active`. */
    forceOpen(active?: string): void {
        this.bar.forceOpen(active);
    }
}
