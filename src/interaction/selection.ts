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

/** Re-derive selection state from the manager and apply the cross-highlight dim. */
export function syncSelectionState(cells: CellSel, selectionManager: ISelectionManager): IsSelected {
    const ids = selectionManager.getSelectionIds() as ISelectionId[];
    const anySelected = ids.length > 0;
    const isSelected: IsSelected = (d) =>
        !!d.selectionId && ids.some(id => id.equals(d.selectionId!));
    applyCrossHighlight(cells, isSelected, anySelected);
    return isSelected;
}
