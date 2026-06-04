"use strict";

import { CellSel } from "../render/grid";
import { CalendarModel, DayCell } from "../types";

/** ARIA label for one cell — date + value (or "no data"). */
export function ariaLabel(d: DayCell, valueName: string): string {
    const date = d.date.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
    });
    return d.noData || d.value == null ? `${date}: no data` : `${date}: ${valueName} ${d.value}`;
}

export interface KeyboardParams {
    cells: CellSel;
    model: CalendarModel;
    valueName: string;
    /** Activate (select) a day; multi when Ctrl/Cmd held. */
    onActivate: (d: DayCell, multi: boolean) => void;
    onClear: () => void;
    /** Draw the focus ring for a day, or clear it when null. */
    drawFocus: (d: DayCell | null) => void;
}

/**
 * Keyboard navigation + ARIA (spec §6). Roving tabindex over the cells:
 *   ↑/↓ = previous/next day, ←/→ = same weekday across weeks,
 *   Enter/Space = select (Ctrl/Cmd = add), Esc = clear, Home/End = first/last.
 */
export function bindKeyboard(p: KeyboardParams): void {
    const days = p.model.days;
    const nodes = p.cells.nodes();
    // Key by facet so ←/→ (same weekday across weeks) stays within one panel.
    const indexByColRow = new Map<string, number>();
    days.forEach((d, i) => indexByColRow.set(`${d.facetIndex ?? 0},${d.col},${d.row}`, i));

    let cur = 0;

    p.cells
        .attr("role", "gridcell")
        .attr("tabindex", (_d, i) => (i === 0 ? 0 : -1))
        .attr("aria-label", d => ariaLabel(d, p.valueName));

    const focusIndex = (i: number): void => {
        if (i < 0 || i >= nodes.length) return;
        nodes[cur].setAttribute("tabindex", "-1");
        cur = i;
        const el = nodes[i] as SVGElement & { focus?: () => void };
        el.setAttribute("tabindex", "0");
        if (typeof el.focus === "function") el.focus();
        p.drawFocus(days[i]);
    };

    const sameRow = (d: DayCell, dCol: number): number | undefined =>
        indexByColRow.get(`${d.facetIndex ?? 0},${d.col + dCol},${d.row}`);

    p.cells.on("keydown", (event: KeyboardEvent, d: DayCell) => {
        let target: number | undefined;
        switch (event.key) {
            case "ArrowDown": target = cur + 1; break;
            case "ArrowUp": target = cur - 1; break;
            case "ArrowRight": target = sameRow(d, 1); break;
            case "ArrowLeft": target = sameRow(d, -1); break;
            case "Home": target = 0; break;
            case "End": target = nodes.length - 1; break;
            case "Enter":
            case " ":
                event.preventDefault();
                p.onActivate(d, event.ctrlKey || event.metaKey);
                return;
            case "Escape":
                p.onClear();
                p.drawFocus(null);
                return;
            default:
                return;
        }
        if (target !== undefined && target >= 0 && target < nodes.length) {
            event.preventDefault();
            focusIndex(target);
        }
    });

    // Keep the roving index in sync if focus arrives via Tab/click.
    p.cells.on("focus", (event: FocusEvent, d: DayCell) => {
        const i = nodes.indexOf(event.currentTarget as SVGRectElement);
        if (i >= 0) { cur = i; p.drawFocus(d); }
    });
}
