"use strict";

import type powerbi from "powerbi-visuals-api";
type ISelectionManager = powerbi.extensibility.ISelectionManager;
type ISelectionId = powerbi.visuals.ISelectionId;

import { Selection } from "d3";
import { CellSel } from "../render/grid";
import { DayCell } from "../types";
import { applyCrossHighlight } from "../render/states";

/** Predicate: is this day currently selected? */
export type IsSelected = (d: DayCell) => boolean;

/**
 * Wire click (select), Ctrl/Cmd-click (multi-select), and right-click (context
 * menu) on the cells. Cross-filtering flows through the selection manager;
 * `onChange` lets the visual re-apply the cross-highlight after each change.
 */
export function bindSelection(
    cells: CellSel,
    selectionManager: ISelectionManager,
    onChange: () => void
): void {
    cells
        .style("cursor", d => (d.selectionId ? "pointer" : "default"))
        .on("click", (event: MouseEvent, d: DayCell) => {
            event.stopPropagation();
            if (!d.selectionId) return;
            const multi = event.ctrlKey || event.metaKey;
            selectionManager.select(d.selectionId, multi).then(onChange);
        })
        .on("contextmenu", (event: MouseEvent, d: DayCell) => {
            event.preventDefault();
            event.stopPropagation();
            selectionManager.showContextMenu(
                d.selectionId ?? ({} as ISelectionId),
                { x: event.clientX, y: event.clientY });
        });
}

/**
 * Native right-click menu on the empty canvas (empty-selection context menu).
 * Mirrors the per-cell menu so right-clicking the background still yields the
 * host's menu instead of the browser's. No drill actions live in our tooltip
 * (AppSource rule) — the menu is entirely host-provided.
 */
export function bindBackgroundContextMenu(
    svg: Selection<SVGSVGElement, unknown, null, undefined>,
    selectionManager: ISelectionManager,
): void {
    svg.on("contextmenu", (event: MouseEvent) => {
        event.preventDefault();
        selectionManager.showContextMenu({} as ISelectionId, { x: event.clientX, y: event.clientY });
    });
}

/**
 * Power BI's own context menu on EVERY region the visual draws (zentrix-qa#13) — ported
 * from the Pie·Donut·Sunburst's `bindCanvasContextMenu`. Certification policy 1180.2.5
 * fails a visual that opens nothing on right-click (the Financial Chart was rejected for
 * it). The day cells and the SVG background already had menus; the Table and Insight
 * views, the view pill, the gear, the quick-action bar, the day panel and the landing
 * page are HTML siblings of the SVG and had none.
 *
 * Bound on the visual ROOT so every region — including ones added later — is covered by
 * construction. Two exemptions: `defaultPrevented` (a cell or the SVG already opened its
 * own menu for this right-click), and text fields, which keep the browser's menu so paste
 * still works in the Table search and the note editor.
 * Ref: https://learn.microsoft.com/en-us/power-bi/developer/visuals/context-menu
 */
export function bindCanvasContextMenu(root: HTMLElement, manager: ISelectionManager): void {
    root.addEventListener("contextmenu", (event: MouseEvent) => {
        if (event.defaultPrevented || isEditable(event.target)) return;
        event.preventDefault();
        try {
            manager.showContextMenu({} as ISelectionId, { x: event.clientX, y: event.clientY });
        } catch { /* a menu failure must never break the visual */ }
    });
}

function isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || typeof el.closest !== "function") return false;
    return el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']") != null;
}

/**
 * Re-derive selection state and apply the cross-highlight dim. `restored` is the set a
 * report bookmark handed back through `registerOnSelectCallback` (zentrix-qa#1): on a
 * cold open the manager's own `getSelectionIds()` is empty, so a bookmark could never
 * re-mark its day. It wins until the user's next selection gesture clears it.
 */
export function syncSelectionState(
    cells: CellSel, selectionManager: ISelectionManager, dimOpacity?: number, restored?: ISelectionId[] | null,
): IsSelected {
    const ids = restored ?? (selectionManager.getSelectionIds() as ISelectionId[]);
    const anySelected = ids.length > 0;
    const isSelected: IsSelected = (d) =>
        !!d.selectionId && ids.some(id => id.equals(d.selectionId!));
    applyCrossHighlight(cells, isSelected, anySelected, dimOpacity);
    return isSelected;
}
