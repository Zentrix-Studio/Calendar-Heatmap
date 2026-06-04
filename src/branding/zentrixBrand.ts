"use strict";

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ZENTRIX BRAND LAYER  —  isolated, non-destructive, removable
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A self-contained visual-identity layer ("Intelligence around time" —
 * orbit + center + grid). It carries ZERO dependencies on the rest of the
 * visual and the rest of the visual never imports anything from it except at a
 * few one-line call sites tagged `ZENTRIX-BRAND` (greppable).
 *
 * TEST FEATURE — addition & removal contract:
 *   • Default ON for every visual (free tier shows the attribution).
 *   • A Format-pane toggle ("Zentrix branding" → Show branding) lets a premium
 *     user turn it off. Nothing else in the visual reads that toggle.
 *   • To remove the layer COMPLETELY, with no effect on existing styling:
 *       1. delete this `src/branding/` folder,
 *       2. delete the `ZENTRIX-BRAND` tagged lines in tooltip.ts / visual.ts,
 *       3. delete the BrandingCard in settings.ts + the "branding" object in
 *          capabilities.json.
 *     No pre-existing token, color, layout or behavior depends on this file.
 *
 * This pass implements standard #1 (tooltip attribution). The remaining
 * surfaces (background watermark, insight card, legend, hover ring, cell
 * highlight) drop in here later through the same `data-zentrix-brand` pattern
 * so they stay equally isolated.
 */

/** Master kill-switch for the whole layer, independent of the Format toggle.
 *  Flip to `false` to disable all branding in code without touching settings. */
export const BRAND_ENABLED = true;

/** Marker attribute stamped on every element this layer injects — so branding
 *  nodes are always findable and never collide with the visual's own DOM. */
export const BRAND_ATTR = "data-zentrix-brand";

/**
 * Zentrix design tokens. Shared source of truth for future branded surfaces so
 * every Zentrix visual reads identically. Nothing here overrides the visual's
 * existing tokens — it sits alongside them.
 */
export const ZENTRIX_TOKENS = {
    radius: 12,            // px — card/surface corner radius
    accent: "#7C5CFF",     // brand violet (matches the visual's existing accent)
    /** Insight tones — qualitative signal language. */
    tone: {
        stable: "#3B82F6",     // blue   — stable
        attention: "#F59E0B",  // amber  — attention
        anomaly: "#EF4444",    // red    — anomaly
    },
    /** Wordmark text used across surfaces. */
    wordmark: "Zentrix",
} as const;

/** Muted, theme-aware neutral gray for understated attribution text. */
function mutedNeutral(dark: boolean): string {
    return dark ? "#A6A6B5" : "#70707F";
}

/**
 * Standard #1 — Tooltip attribution.
 *
 * Appends a subtle "Zentrix" wordmark to the bottom-right of the tooltip:
 * 10px, regular weight, muted neutral gray, ~0.55 opacity, no border/background.
 * Branding stays secondary to the data — understated by design.
 *
 * Idempotent: a prior attribution node (if any) is removed first, so repeated
 * tooltip renders never stack duplicates. Purely additive — it does not touch
 * the tooltip's existing layout, padding, or content.
 */
export function appendTooltipBrand(tooltipEl: HTMLElement, dark: boolean): void {
    if (!BRAND_ENABLED) return;
    const prev = tooltipEl.querySelector(`[${BRAND_ATTR}="tooltip"]`);
    if (prev) prev.remove();

    const brand = document.createElement("div");
    brand.setAttribute(BRAND_ATTR, "tooltip");
    brand.textContent = ZENTRIX_TOKENS.wordmark;
    brand.style.cssText =
        "margin-top:8px;text-align:right;" +
        "font-size:10px;font-weight:400;letter-spacing:.2px;line-height:1;" +
        `color:${mutedNeutral(dark)};opacity:.55;` +
        "pointer-events:none;user-select:none;";
    tooltipEl.appendChild(brand);
}
