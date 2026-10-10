"use strict";

/**
 * Auto disappear (HM-V2-41) — fades the on-canvas chrome while the cursor is outside
 * the visual: the settings gear (`.zsb-anchor`), the Calendar / Table / Insight switch
 * (`.zx-view-toggle`) and the quick-action bar (`.zx-actions`).
 *
 * Opacity + pointer-events only, never `display`: each overlay keeps its own show/hide
 * rules (gear in Reading view, bar on small tiles, pill without alternate views) and the
 * calendar does not re-lay out when the chrome fades.
 *
 * Never hides while the chrome is in use — the settings panel or the export menu open
 * (`isPinned`), or keyboard focus inside the visual (`:focus-within`, so a keyboard user
 * can always reach the gear) — and never on a device with no hover (touch), where a
 * hidden control could not be brought back.
 */

const CSS = `
.zx-autohide .zsb-anchor, .zx-autohide .zx-view-toggle, .zx-autohide .zx-actions {
    transition: opacity .18s ease;
}
.zx-autohide.zx-chrome-away:not(:focus-within) .zsb-anchor,
.zx-autohide.zx-chrome-away:not(:focus-within) .zx-view-toggle,
.zx-autohide.zx-chrome-away:not(:focus-within) .zx-actions {
    opacity: 0; pointer-events: none;
}
@media (hover: none) {
    .zx-autohide.zx-chrome-away .zsb-anchor, .zx-autohide.zx-chrome-away .zx-view-toggle,
    .zx-autohide.zx-chrome-away .zx-actions { opacity: 1; pointer-events: auto; }
}
@media (prefers-reduced-motion: reduce) {
    .zx-autohide .zsb-anchor, .zx-autohide .zx-view-toggle, .zx-autohide .zx-actions { transition: none; }
}`;

export class ChromeAutoHide {
    private enabled = true;
    /** Last known pointer position relative to the visual. Starts outside: on load the
     *  chrome stays away until the cursor first enters (Power BI renders us in our own
     *  iframe, so a pointer already inside fires `mouseenter` on its first move). */
    private inside = false;

    constructor(private root: HTMLElement, private isPinned: () => boolean) {
        const doc = root.ownerDocument;
        if (!doc.getElementById("zx-autohide-css")) {
            const style = doc.createElement("style");
            style.id = "zx-autohide-css";
            style.textContent = CSS;
            (doc.head ?? doc.documentElement).appendChild(style);
        }
        root.classList.add("zx-autohide");
        root.addEventListener("mouseenter", () => { this.inside = true; this.sync(); });
        root.addEventListener("mousemove", () => { if (!this.inside) { this.inside = true; this.sync(); } });
        root.addEventListener("mouseleave", () => { this.inside = false; this.sync(); });
        // A tap on a touch screen counts as "here" — belt and braces next to the
        // (hover: none) rule, for hybrid devices that report hover.
        root.addEventListener("pointerdown", () => { this.inside = true; this.sync(); });
        this.sync();
    }

    /** Toolbar › Auto disappear. Off keeps the chrome on screen at all times. */
    setEnabled(on: boolean): void {
        if (on === this.enabled) return;
        this.enabled = on;
        this.sync();
    }

    /** Re-evaluate — call when the pinned state may have changed (panel opened/closed). */
    sync(): void {
        const away = this.enabled && !this.inside && !this.isPinned();
        this.root.classList.toggle("zx-chrome-away", away);
    }

    /** True while the chrome is faded out (for tests and the harness). */
    isAway(): boolean { return this.root.classList.contains("zx-chrome-away"); }
}
