"use strict";

/**
 * Zentrix Design System — token snapshot for the Calendar Heatmap pbiviz build.
 *
 * THIS FILE IS HAND-MAINTAINED and is the source of record for the heatmap's
 * token snapshot. Hex values are copied by hand from the canonical tokens at
 * platform/packages/tokens/src/ (mapping below); keep them in sync when
 * canonical changes. (`scripts/sync-tokens.mjs` is DISABLED — a stale
 * Bullet-Chart copy that would emit the wrong export set; a verify-only
 * drift-checker is the intended replacement.)
 *
 * WHY a snapshot: pbiviz webpack compiles an isolated sandbox and cannot
 * resolve the pnpm workspace symlink to @zentrix/tokens at bundle time, so the
 * visual imports these static values instead of the package directly.
 * Introduced for the heatmap in Z-148 so render/interaction colors resolve
 * from tokens instead of inline hex.
 *
 * Sourced from platform/packages/tokens/src/:
 *   palettes.ts   (aurora palette — accent family)
 *   colors.ts     (themes: dark + light surface/text)
 *   semantics.ts  (Okabe–Ito CVD-safe pair)
 *   spacing.ts    (markRadius)
 *   typography.ts (font stack)
 */

// ---------------------------------------------------------------------------
// Accent family — aurora palette (canonical Zentrix brand)
// ---------------------------------------------------------------------------

/** Brand accent violet. Heatmap state rings / annotation marker default. */
export const accent = "#7C5CFF";

/** Darker state of accent (hover / selected). */
export const accentStrong = "#6344E0";

// ---------------------------------------------------------------------------
// CVD-safe semantic pair (Okabe–Ito — the canonical meaning-bearing encoding)
// Sourced from semantics.ts. These REPLACE the heatmap's legacy raw green/red
// up/down semantics (#2EA043 / #E5484D) per Z-148 (CEO-approved 2026-06-07).
// ---------------------------------------------------------------------------

/** Good / above / gain — Okabe–Ito blue. DEFAULT for any meaning-bearing color. */
export const posSafe = "#0072B2";

/** Bad / below / loss — Okabe–Ito orange. DEFAULT for any meaning-bearing color. */
export const negSafe = "#E69F00";

/** Hover/active darken of posSafe. */
export const posSafeStrong = "#005C90";

/** Hover/active darken of negSafe. */
export const negSafeStrong = "#B97E00";

// ---------------------------------------------------------------------------
// Dark-theme surface tokens (themes.dark) — panel / tooltip backgrounds
// ---------------------------------------------------------------------------

export const surfaceBase     = "#0A0A0F";
export const surfaceSubtle   = "#111118";
export const surfaceCard     = "#16161F";
export const surfaceElevated = "#1E1E2A";
export const surfaceOverlay  = "#24242F";

// ---------------------------------------------------------------------------
// Dark-theme text tokens (themes.dark.text)
// ---------------------------------------------------------------------------

export const textPrimary   = "#F4F4F6";
export const textSecondary = "#A6A6B5";
/** Tertiary / axis text — also the default for muted/secondary text. */
export const textTertiary  = "#70707F";
export const textDisabled  = "#4A4A56";
/** Muted text on dark surfaces (tooltip/panel secondary lines). */
export const textMutedDark = "#8A8A99";

// ---------------------------------------------------------------------------
// Light-theme surface + text tokens (for theme-aware renderers)
// ---------------------------------------------------------------------------

export const surfaceElevatedLight = "#FFFFFF"; // themes.light.surface.elevated
export const surfaceOverlayLight  = "#FFFFFF"; // themes.light.surface.overlay

/** Light-theme primary text (panel/tooltip foreground on light canvases). */
export const textPrimaryLight   = "#15161E"; // themes.light.text.primary
/** Light-theme muted text. */
export const textTertiaryLight  = "#8A8C9E"; // themes.light.text.tertiary

// ---------------------------------------------------------------------------
// Shared typography
// ---------------------------------------------------------------------------

/** Default UI font stack for in-visual overlays (tooltip / panel). */
export const fontFamily = "Segoe UI, -apple-system, sans-serif";

// ---------------------------------------------------------------------------
// Corner-radius mark scale (spacing.ts — markRadius)
// ---------------------------------------------------------------------------

/** Small data marks: heatmap cells, swatches. = radius.xs */
export const markRadiusCell  = 2; // px

// ---------------------------------------------------------------------------
// Theme-surface resolver — one source of truth for the in-visual overlay
// surfaces (tooltip + day-detail panel). When the host is in High Contrast
// mode, the caller passes the host's strong/background system colors via `hc`
// so the overlay honors the user's HC theme (Z-136 / Z-145 §4.4) instead of
// our themed hexes. Returns plain CSS color strings (token-sourced).
// ---------------------------------------------------------------------------

export interface SurfaceTheme {
    bg: string;
    fg: string;
    muted: string;
    strong: string;
}

/** High-contrast system colors the host exposes (background + foreground). */
export interface HcColors { background: string; foreground: string; }

/**
 * Resolve the surface palette for an in-visual overlay.
 * @param dark  themed dark mode (ignored when `hc` is provided).
 * @param hc    when set, High-Contrast system colors take precedence.
 */
export function resolveSurface(dark: boolean, hc?: HcColors | null): SurfaceTheme {
    if (hc) {
        return { bg: hc.background, fg: hc.foreground, muted: hc.foreground, strong: hc.foreground };
    }
    return dark
        ? { bg: surfaceCard, fg: textPrimary, muted: textMutedDark, strong: textPrimary }
        : { bg: surfaceOverlayLight, fg: textPrimaryLight, muted: textTertiaryLight, strong: textPrimaryLight };
}
