"use strict";

// MIRROR OF @zentrix/visual-annotations (platform/packages/visual-annotations/src/editor.ts)
// -------------------------------------------------------------------------------------
// DO NOT style-edit this copy. pbiviz webpack resolves from this visual's own src/ and
// cannot take a pnpm workspace dependency, so the golden source is COPIED here. Change
// the golden source, then re-copy. If this mirror and the golden ever disagree, promote
// THIS up before syncing down.
//
// It takes a resolved `AnnotationTheme` rather than importing tokens, which is what keeps
// it dependency-free (and therefore shareable across every Zentrix visual).

/**
 * @zentrix/visual-annotations — the note editor overlay.
 *
 * Vanilla DOM. No React, no D3, no `powerbi-visuals-api`, no token imports (the
 * host passes a resolved `AnnotationTheme`) — so this drops into a cert-sandboxed
 * pbiviz build unchanged and stays on-brand in whatever theme the host resolved.
 *
 * CERTIFICATION: this file is `createElement` + `textContent`, end to end.
 * AppSource certification bans `innerHTML` (and `D3.html(...)` on user input)
 * outright, so a note's text can NEVER round-trip as an HTML string. That is why
 * `NoteStyle` is a structured model (bold / italic / size / colors) rather than
 * rich text — the note body is always inserted as a text node, never parsed as
 * markup. Microsoft's own PowerPoint annotations make the same trade.
 *
 * OPTIMISTIC EDITING: `onChange` fires on every keystroke and control change so
 * the canvas repaints immediately; `onCommit` fires when the edit is finished and
 * the store should be persisted. This is the same contract the Zentrix settings bar
 * lives by — never wait on the async `persistProperties → host → update()` round
 * trip, which is unreliable for a freshly-written property.
 */

import type { AnnotationTheme, Note, NoteMode } from "../notes/core";
import { MAX_TEXT } from "../notes/core";

const MODES: [NoteMode, string][] = [
    ["marker", "Marker"],
    ["text", "Text"],
    ["arrow", "Text + arrow"],
    ["all", "All"],
];

const HEX6 = /^#[0-9a-fA-F]{6}$/;

export interface NoteEditorCallbacks {
    /** Live edit — repaint the canvas from the working copy (not yet persisted). */
    onChange: (note: Note) => void;
    /** Edit finished — write the store through to the host. */
    onCommit: (note: Note) => void;
    onDelete: (note: Note) => void;
    onClose: () => void;
}

/** Remove all children of an element. */
function clear(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

/** A <div> with inline cssText and optional textContent. */
function div(style: string, text?: string): HTMLDivElement {
    const d = document.createElement("div");
    d.style.cssText = style;
    if (text != null) d.textContent = text;
    return d;
}

export class NoteEditor {
    private el: HTMLDivElement;
    private root: HTMLElement;
    private cb: NoteEditorCallbacks;
    private note: Note | null = null;
    private theme: AnnotationTheme;
    /** True while the working copy is not yet in the store (a brand-new note). */
    private isNew = false;
    /** The note as it was when the editor opened — what Cancel puts back. */
    private original: Note | null = null;

    constructor(root: HTMLElement, theme: AnnotationTheme, cb: NoteEditorCallbacks) {
        this.root = root;
        this.theme = theme;
        this.cb = cb;
        this.el = document.createElement("div");
        this.el.setAttribute("role", "dialog");
        this.el.setAttribute("aria-label", "Edit annotation");
        this.el.tabIndex = -1;
        this.el.style.display = "none";
        // Clicks inside the editor must not reach the plot's empty-area clear.
        this.el.addEventListener("mousedown", e => e.stopPropagation());
        this.el.addEventListener("click", e => e.stopPropagation());
        this.el.addEventListener("keydown", e => {
            if (e.key === "Escape") { e.stopPropagation(); this.commitAndClose(); }
        });
        root.appendChild(this.el);
    }

    setTheme(theme: AnnotationTheme): void { this.theme = theme; }

    isOpen(): boolean { return this.note != null; }
    openNoteId(): string | null { return this.note?.id ?? null; }

    /** Open on a working copy. Cancel discards it: a new note disappears, an existing
     *  one goes back to how it was. */
    open(note: Note, title: string, isNew: boolean): void {
        this.note = { ...note, style: { ...note.style } };
        this.original = { ...note, style: { ...note.style } };
        this.isNew = isNew;
        this.render(title);
        this.layout();
        this.el.style.display = "block";
        this.el.tabIndex = 0;
        const ta = this.el.querySelector("textarea");
        if (ta instanceof HTMLTextAreaElement) ta.focus();
    }

    close(): void {
        this.note = null;
        this.el.style.display = "none";
        this.el.tabIndex = -1;
    }

    /**
     * Commit any in-progress edit, then close. Call this when the user clicks away
     * onto the canvas: `onChange` has already put the working copy in the store so
     * the canvas shows it, but nothing is PERSISTED until commit — dismissing without
     * committing would silently lose the note on the next host round-trip.
     */
    commit(): void {
        if (this.note) this.commitAndClose();
    }

    private commitAndClose(): void {
        if (this.note) this.cb.onCommit(this.note);
        this.close();
        this.cb.onClose();
    }

    /** Discard this session's edits. A new note was only ever a draft, so it goes; an
     *  existing note is put back exactly as it was — nothing is persisted either way. */
    private cancel(): void {
        const n = this.note, orig = this.original;
        this.close();
        if (n && this.isNew) this.cb.onDelete(n);
        else if (orig) this.cb.onChange(orig);
        this.cb.onClose();
    }

    /** Two-step Delete: the first click arms it ("Delete note?", drawn inverted so the
     *  armed state is unmistakable in any theme), the second deletes. Colours come from
     *  the host theme like the rest of the editor — no literals, so it stays shareable. */
    private deleteButton(): HTMLButtonElement {
        const t = this.theme;
        const b = this.textButton("Delete", () => {
            if (b.getAttribute("data-armed") !== "true") {
                b.setAttribute("data-armed", "true");
                b.textContent = "Delete note?";
                b.style.background = t.fg;
                b.style.color = t.bg;
                b.style.borderColor = t.fg;
                return;
            }
            const n = this.note!;
            this.close();
            this.cb.onDelete(n);
        });
        b.setAttribute("aria-label", "Delete this note");
        return b;
    }

    /** Push the working copy to the canvas without persisting. */
    private touch(): void {
        if (this.note) this.cb.onChange(this.note);
    }

    // -- rendering -----------------------------------------------------------

    private render(title: string): void {
        const note = this.note!;
        const t = this.theme;

        this.el.style.cssText =
            "position:absolute;z-index:1002;box-sizing:border-box;width:268px;" +
            `font-family:${t.font};box-shadow:0 8px 28px rgba(0,0,0,.28);` +
            `border-radius:12px;padding:12px 13px;background:${t.bg};color:${t.fg};` +
            `border:1px solid ${t.line};`;
        clear(this.el);

        // Header — what this note is anchored to + close.
        const header = div("display:flex;align-items:center;justify-content:space-between;gap:8px");
        header.appendChild(div(`font-size:10px;letter-spacing:.5px;color:${t.muted}`, title));
        header.appendChild(this.iconButton("✕", "Close annotation editor", () => this.commitAndClose()));
        this.el.appendChild(header);

        // Body text.
        const ta = document.createElement("textarea");
        ta.value = note.text;
        ta.rows = 3;
        ta.maxLength = MAX_TEXT;
        ta.placeholder = "Add a note…";
        ta.setAttribute("aria-label", "Annotation text");
        ta.style.cssText =
            "width:100%;box-sizing:border-box;margin-top:8px;resize:vertical;" +
            `font-family:${t.font};font-size:12px;line-height:1.4;padding:7px 8px;` +
            `border-radius:8px;border:1px solid ${t.line};background:transparent;color:${t.fg};outline:none;`;
        ta.addEventListener("focus", () => { ta.style.borderColor = t.accent; });
        ta.addEventListener("blur", () => { ta.style.borderColor = t.line; });
        ta.addEventListener("input", () => { note.text = ta.value; this.touch(); });
        this.el.appendChild(ta);

        // Display mode.
        this.el.appendChild(this.rowLabel("Show"));
        this.el.appendChild(this.modeSegments(note));

        // Text style: bold / italic / size.
        this.el.appendChild(this.rowLabel("Text"));
        const styleRow = div("display:flex;align-items:center;gap:6px;margin-top:4px");
        styleRow.appendChild(this.toggleButton("B", "Bold", !!note.style.bold, on => {
            note.style.bold = on || undefined; this.touch();
        }, "700"));
        styleRow.appendChild(this.toggleButton("I", "Italic", !!note.style.italic, on => {
            note.style.italic = on || undefined; this.touch();
        }, "400", "italic"));
        styleRow.appendChild(this.sizeStepper(note));
        this.el.appendChild(styleRow);

        // Colors. An unset color falls back to the theme, which is how an un-styled
        // note stays on-brand in both light and dark.
        this.el.appendChild(this.rowLabel("Colors"));
        const colorRow = div("display:flex;align-items:center;gap:10px;margin-top:4px;flex-wrap:wrap");
        colorRow.appendChild(this.colorField("Text", note.style.color, v => { note.style.color = v; this.touch(); }));
        colorRow.appendChild(this.colorField("Fill", note.style.bg, v => { note.style.bg = v; this.touch(); }));
        colorRow.appendChild(this.colorField("Border", note.style.border, v => { note.style.border = v; this.touch(); }));
        colorRow.appendChild(this.colorField("Arrow", note.style.arrow, v => { note.style.arrow = v; this.touch(); }));
        this.el.appendChild(colorRow);

        // Footer. Cancel always sits in the left slot and never destroys anything;
        // Delete is its own red button and asks once before removing a saved note
        // (Calendar Heatmap zentrix-qa#26: the left slot turned into an unconfirmed
        // Delete for existing notes, and a QA pass deleted a customer note with it).
        const footer = div("display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:8px");
        footer.appendChild(this.textButton("Cancel", () => this.cancel()));
        const right = div("display:flex;align-items:center;gap:8px");
        if (!this.isNew) right.appendChild(this.deleteButton());
        right.appendChild(this.primaryButton("Done", () => this.commitAndClose()));
        footer.appendChild(right);
        this.el.appendChild(footer);
    }

    private rowLabel(text: string): HTMLElement {
        return div(
            "margin-top:10px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;" +
            `color:${this.theme.muted}`, text);
    }

    private modeSegments(note: Note): HTMLElement {
        const t = this.theme;
        const wrap = div(`display:flex;margin-top:4px;border:1px solid ${t.line};border-radius:8px;overflow:hidden`);
        const buttons: HTMLButtonElement[] = [];
        const paint = () => buttons.forEach((b, i) => {
            const on = MODES[i]?.[0] === note.mode;
            b.style.background = on ? t.accent : "transparent";
            b.style.color = on ? "rgba(255,255,255,0.98)" : t.muted;
        });
        MODES.forEach(([mode, label]) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            b.style.cssText =
                "all:unset;flex:1;text-align:center;cursor:pointer;font-size:10px;" +
                "padding:6px 2px;box-sizing:border-box;";
            b.addEventListener("click", () => { note.mode = mode; paint(); this.touch(); });
            buttons.push(b);
            wrap.appendChild(b);
        });
        paint();
        return wrap;
    }

    private sizeStepper(note: Note): HTMLElement {
        const t = this.theme;
        const wrap = div(`display:flex;align-items:center;margin-left:auto;border:1px solid ${t.line};border-radius:8px`);
        const value = div(`min-width:34px;text-align:center;font-size:11px;color:${t.fg}`);
        const paint = () => { value.textContent = `${note.style.size ?? 11}px`; };
        const step = (by: number) => {
            note.style.size = Math.max(7, Math.min(32, (note.style.size ?? 11) + by));
            paint();
            this.touch();
        };
        wrap.appendChild(this.iconButton("−", "Smaller text", () => step(-1)));
        wrap.appendChild(value);
        wrap.appendChild(this.iconButton("+", "Larger text", () => step(1)));
        paint();
        return wrap;
    }

    /**
     * A color field. `<input type="color">` cannot express "unset", so a separate
     * reset (×) clears back to the theme default rather than baking a hex in.
     *
     * The swatch must open on a literal #rrggbb (the input accepts nothing else), so
     * an unset color falls back to the theme foreground — and to the brand accent if
     * even that isn't a plain hex, which it isn't under High Contrast, where the host
     * hands us system color keywords.
     */
    private colorField(
        label: string, value: string | undefined, onSet: (v: string | undefined) => void,
    ): HTMLElement {
        const t = this.theme;
        const wrap = div("display:flex;align-items:center;gap:4px");
        const input = document.createElement("input");
        input.type = "color";
        input.value = HEX6.test(value ?? "") ? value! : (HEX6.test(t.fg) ? t.fg : t.accent);
        input.setAttribute("aria-label", `${label} color`);
        input.style.cssText = "width:20px;height:20px;padding:0;border:none;background:none;cursor:pointer;border-radius:4px;";
        input.addEventListener("input", () => onSet(input.value));
        wrap.appendChild(input);
        wrap.appendChild(div(`font-size:10px;color:${t.muted}`, label));
        wrap.appendChild(this.iconButton("×", `Reset ${label.toLowerCase()} color`, () => onSet(undefined)));
        return wrap;
    }

    private toggleButton(
        glyph: string, aria: string, on: boolean, onToggle: (on: boolean) => void,
        weight = "400", style = "normal",
    ): HTMLButtonElement {
        const t = this.theme;
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = glyph;
        b.setAttribute("aria-label", aria);
        let active = on;
        const paint = () => {
            b.setAttribute("aria-pressed", String(active));
            b.style.background = active ? t.accent : "transparent";
            b.style.color = active ? "rgba(255,255,255,0.98)" : t.muted;
        };
        b.style.cssText =
            "all:unset;cursor:pointer;width:24px;height:24px;text-align:center;line-height:24px;" +
            `border:1px solid ${t.line};border-radius:6px;font-size:11px;font-weight:${weight};font-style:${style};`;
        b.addEventListener("click", () => { active = !active; paint(); onToggle(active); });
        paint();
        return b;
    }

    private iconButton(glyph: string, aria: string, onClick: () => void): HTMLButtonElement {
        const t = this.theme;
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = glyph;
        b.setAttribute("aria-label", aria);
        b.style.cssText = `all:unset;cursor:pointer;color:${t.muted};font-size:12px;line-height:1;padding:4px 6px;border-radius:4px;`;
        b.addEventListener("mouseenter", () => { b.style.color = t.fg; });
        b.addEventListener("mouseleave", () => { b.style.color = t.muted; });
        b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
        return b;
    }

    private textButton(label: string, onClick: () => void): HTMLButtonElement {
        const t = this.theme;
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText =
            `all:unset;cursor:pointer;font-size:11px;color:${t.muted};padding:5px 10px;` +
            `border:1px solid ${t.line};border-radius:7px;`;
        b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
        return b;
    }

    private primaryButton(label: string, onClick: () => void): HTMLButtonElement {
        const t = this.theme;
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.style.cssText =
            "all:unset;cursor:pointer;font-size:11px;font-weight:600;color:rgba(255,255,255,0.98);" +
            `background:${t.accent};padding:6px 14px;border-radius:7px;`;
        b.addEventListener("click", e => { e.stopPropagation(); onClick(); });
        return b;
    }

    // -- placement -----------------------------------------------------------

    /** Centred, clear of a right-docked detail panel. */
    private layout(): void {
        const w = this.root.clientWidth || this.root.getBoundingClientRect().width;
        const h = this.root.clientHeight || this.root.getBoundingClientRect().height;
        this.el.style.left = Math.max(8, Math.round(w * 0.5) - 134) + "px";
        this.el.style.top = Math.max(8, Math.round(h * 0.5) - 150) + "px";
    }
}
