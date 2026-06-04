"use strict";

import { Selection } from "d3";

/** A resolved text style for one text group. */
export interface TextStyle {
    family: string;
    size: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    /** Empty string = "auto" → use the theme fallback color. */
    color: string;
}

/** Modern default stack. */
export const DEFAULT_FAMILY = "Segoe UI, system-ui, -apple-system, sans-serif";

export function defaultText(size: number, color = ""): TextStyle {
    return { family: DEFAULT_FAMILY, size, bold: false, italic: false, underline: false, color };
}

/** Apply a text style to a d3 text selection; `fallbackColor` is used when color is "auto". */
export function applyText<T extends d3Text>(sel: T, st: TextStyle, fallbackColor: string): T {
    return sel
        .attr("font-family", st.family || DEFAULT_FAMILY)
        .attr("font-size", `${st.size}px`)
        .attr("font-weight", st.bold ? "700" : "400")
        .attr("font-style", st.italic ? "italic" : "normal")
        .attr("text-decoration", st.underline ? "underline" : null)
        .attr("fill", st.color || fallbackColor) as T;
}

// Loosely typed d3 text selection (works for both visual and harness call sites).
type d3Text = Selection<SVGTextElement, any, any, any>;
