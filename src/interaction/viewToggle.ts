"use strict";

import { accent, fontFamily, resolveSurface, surfaceElevatedLight, HcColors } from "../theme/zentrixTokens";

export type ViewMode = "visual" | "table";

/**
 * Floating Visual ⇄ Summary-table switch (bottom-right). Shown only while the
 * Summary table option (Elements → Summary table) is on; clicking a segment
 * swaps which view fills the canvas.
 *
 * Deliberately SESSION-LOCAL: the flip calls back into the visual and repaints
 * from cached inputs (rerenderFromSettings) without persisting anything, so it
 * works for report READERS too — persistProperties would be author-only and
 * wouldn't survive in Reading view anyway. The persisted default is the
 * `summaryTable.show` setting: on = the table is the first thing shown.
 */
export class ViewToggle {
    private root: HTMLDivElement;
    private btnVisual: HTMLButtonElement;
    private btnTable: HTMLButtonElement;
    private mode: ViewMode = "table";
    private dark = false;
    private hc: HcColors | null = null;

    constructor(parent: HTMLElement, private onSwitch: (mode: ViewMode) => void) {
        this.root = document.createElement("div");
        this.root.className = "zx-view-toggle";
        const rs = this.root.style;
        rs.position = "absolute";
        rs.right = "10px";
        rs.bottom = "10px";
        rs.display = "none";
        rs.zIndex = "12";
        rs.borderRadius = "999px";
        rs.padding = "2px";
        rs.boxShadow = "0 2px 8px rgba(0,0,0,0.18)";
        rs.userSelect = "none";
        this.root.setAttribute("role", "group");
        this.root.setAttribute("aria-label", "Switch between the visual and the summary table");

        this.btnVisual = this.makeButton("Visual", "visual");
        this.btnTable = this.makeButton("Table", "table");
        this.root.appendChild(this.btnVisual);
        this.root.appendChild(this.btnTable);
        parent.appendChild(this.root);
    }

    private makeButton(label: string, mode: ViewMode): HTMLButtonElement {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        const bs = b.style;
        bs.font = `600 11px ${fontFamily}`;
        bs.border = "none";
        bs.borderRadius = "999px";
        bs.padding = "4px 10px";
        bs.cursor = "pointer";
        bs.background = "transparent";
        b.addEventListener("click", (e) => {
            e.stopPropagation();
            if (this.mode === mode) return; // already showing this view
            this.mode = mode;
            this.paint();
            this.onSwitch(mode);
        });
        return b;
    }

    /** Show the switch reflecting the current view + theme. */
    show(mode: ViewMode, dark: boolean, hc?: HcColors | null): void {
        this.mode = mode;
        this.dark = dark;
        this.hc = hc ?? null;
        this.root.style.display = "flex";
        this.paint();
    }

    hide(): void {
        this.root.style.display = "none";
    }

    private paint(): void {
        const s = resolveSurface(this.dark, this.hc);
        this.root.style.background = s.bg;
        this.root.style.border = `1px solid ${this.hc ? s.fg : (this.dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)")}`;
        const activeBg = this.hc ? s.fg : accent;
        const activeFg = this.hc ? s.bg : surfaceElevatedLight; // white-on-accent (token-sourced)
        for (const [btn, mode] of [[this.btnVisual, "visual"], [this.btnTable, "table"]] as const) {
            const active = this.mode === mode;
            btn.style.background = active ? activeBg : "transparent";
            btn.style.color = active ? activeFg : s.muted;
            btn.setAttribute("aria-pressed", String(active));
        }
    }
}
