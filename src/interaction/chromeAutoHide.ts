"use strict";

/**
 * Auto disappear (HM-V2-41) — the on-canvas chrome shows only while the pointer is
 * inside the visual: the settings gear (`.zsb-anchor`), the Calendar / Table / Insight
 * switch (`.zx-view-toggle`) and the quick-action bar (`.zx-actions`). This is the
 * founder rule `gr-hover-only-chrome`, zentrix-qa QA-STANDARD §21 (issue #36).
 *
 * §21 step by step:
 *  1. pointer outside → hidden; enters → shown; leaves → hidden, no click needed.
 *  2. an open panel or menu CLOSES when the pointer leaves (`onLeave`), then hides. The
 *     gear's close commits a half-typed field first, so nothing committed is lost.
 *  5. keyboard focus inside the visual shows it (`:focus-within`, WCAG 2.1.1).
 *  6. touch: a tap on the visual shows it; a tap elsewhere in the report takes focus
 *     away from this frame (`window` blur), which hides it.
 *
 * Opacity + pointer-events only, never `display`: each overlay keeps its own show/hide
 * rules (gear in Reading view, bar on small tiles, pill without alternate views) and the
 * calendar does not re-lay out when the chrome fades.
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
@media (prefers-reduced-motion: reduce) {
    .zx-autohide .zsb-anchor, .zx-autohide .zx-view-toggle, .zx-autohide .zx-actions { transition: none; }
}`;

export class ChromeAutoHide {
    private enabled = true;
    /** Last known pointer position relative to the visual. Starts outside: on load the
     *  chrome stays away until the pointer first enters (Power BI renders us in our own
     *  iframe, so a pointer already inside fires `mousemove` on its first move). */
    private inside = false;

    /** @param onLeave closes whatever the chrome has open (settings panel, export menu)
     *  when the pointer leaves — only called while Auto disappear is on. */
    constructor(private root: HTMLElement, private onLeave: () => void) {
        const doc = root.ownerDocument;
        if (!doc.getElementById("zx-autohide-css")) {
            const style = doc.createElement("style");
            style.id = "zx-autohide-css";
            style.textContent = CSS;
            (doc.head ?? doc.documentElement).appendChild(style);
        }
        root.classList.add("zx-autohide");
        const here = () => { if (!this.inside) { this.inside = true; this.sync(); } };
        const gone = () => {
            if (!this.inside) return;
            this.inside = false;
            if (this.enabled) this.onLeave();
            this.sync();
        };
        root.addEventListener("mouseenter", here);
        root.addEventListener("mousemove", here);
        root.addEventListener("pointerdown", here);   // a tap on a touch screen
        root.addEventListener("mouseleave", gone);
        // A tap / click elsewhere in the report blurs this frame. The window outlives any
        // one visual, so its listener holds the instance only weakly — a strong closure
        // kept every discarded visual alive (the settings sweep ran out of heap).
        const self = new WeakRef(this);
        const win = doc.defaultView;
        const onBlur = (): void => {
            const me = self.deref();
            if (!me) { win?.removeEventListener("blur", onBlur); return; }
            me.pointerGone();
        };
        win?.addEventListener("blur", onBlur);
        this.pointerGone = gone;
        this.sync();
    }

    /** Set in the constructor; the window's blur listener reaches it through a WeakRef. */
    private pointerGone: () => void = () => { /* replaced in the constructor */ };

    /** Toolbar › Auto disappear. Off keeps the chrome on screen at all times. */
    setEnabled(on: boolean): void {
        if (on === this.enabled) return;
        this.enabled = on;
        this.sync();
    }

    /** Re-evaluate the faded state (called on every host update). */
    sync(): void {
        this.root.classList.toggle("zx-chrome-away", this.enabled && !this.inside);
    }

    /** True while the chrome is faded out (for tests and the harness). */
    isAway(): boolean { return this.root.classList.contains("zx-chrome-away"); }
}
