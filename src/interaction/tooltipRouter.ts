"use strict";

import type powerbi from "powerbi-visuals-api";
type ITooltipService = powerbi.extensibility.ITooltipService;
type VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
type ISelectionId = powerbi.visuals.ISelectionId;

import { DayCell } from "../types";
import { dateLabel, formatNum, tipText } from "./dayData";

/** Overlays › Tooltip style — the family's one vocabulary (SETTINGS-TAXONOMY.md). */
export type TooltipStyle = "card" | "report" | "off";

/** The two things a hover can hand the router: how to paint the Zentrix card, and
 *  the plain rows the host tooltip shows instead. Rows are built lazily, so the card
 *  path never pays for them. */
export interface HoverContent {
    card(x: number, y: number): void;
    items(): VisualTooltipDataItem[];
    identities?: ISelectionId[];
}

/**
 * Routes every hover in the visual to the right tooltip (HM-V2-20).
 *
 * - `card`   — the branded Zentrix overlay (the pre-port behaviour, unchanged).
 * - `report` — Power BI's own tooltip service: follows the report theme and, because
 *              the selection identity is passed, supports report-page tooltips.
 * - `off`    — nothing. The hover ring still shows which day the pointer is on.
 *
 * Callers hide through here too, so switching style mid-hover never strands the
 * other tooltip on screen.
 */
export class TooltipRouter {
    private style: TooltipStyle = "card";

    constructor(
        private readonly card: { hide(): void; move(x: number, y: number): void },
        private readonly service: ITooltipService | undefined,
    ) {}

    setStyle(style: TooltipStyle): void {
        if (style === this.style) return;
        this.hide();
        this.style = style;
    }

    current(): TooltipStyle { return this.style; }

    show(e: { clientX: number; clientY: number }, content: HoverContent): void {
        if (this.style === "off") return;
        if (this.style === "card") { content.card(e.clientX, e.clientY); return; }
        if (!this.service || !this.service.enabled()) return;
        this.service.show({
            coordinates: [e.clientX, e.clientY], isTouchEvent: false,
            dataItems: content.items(), identities: content.identities ?? [],
        });
    }

    move(e: { clientX: number; clientY: number }, content?: HoverContent): void {
        if (this.style === "off") return;
        if (this.style === "card") { this.card.move(e.clientX, e.clientY); return; }
        if (!this.service || !this.service.enabled() || !content) return;
        this.service.move({
            coordinates: [e.clientX, e.clientY], isTouchEvent: false,
            dataItems: content.items(), identities: content.identities ?? [],
        });
    }

    hide(): void {
        this.card.hide();
        if (this.style === "report" && this.service) this.service.hide({ immediately: true, isTouchEvent: false });
    }
}

/** The rows the host tooltip shows for one day — the same facts the Zentrix card
 *  leads with, as plain name/value pairs (the host draws its own layout). */
export function dayTooltipItems(d: DayCell, metric: string, targetName?: string): VisualTooltipDataItem[] {
    const items: VisualTooltipDataItem[] = [
        { displayName: "Date", value: dateLabel(d.date) },
        { displayName: metric, value: d.value == null ? "No data" : formatNum(d.value) },
    ];
    if (d.target != null) items.push({ displayName: targetName || "Target", value: formatNum(d.target) });
    if (d.holiday) items.push({ displayName: "Holiday", value: d.holiday });
    if (d.events?.length) items.push({ displayName: d.events.length === 1 ? "Event" : "Events", value: d.events.join("; ") });
    for (const t of d.tooltips ?? []) items.push({ displayName: t.name, value: tipText(t) });
    return items;
}
