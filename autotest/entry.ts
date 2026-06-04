/*
 * Browser entry for automated visual testing. Mounts the REAL Visual class
 * (the same one Power BI instantiates) with the existing mock host + mock
 * DataView, into a real DOM that a headless browser actually lays out. This is
 * what lets us assert on real geometry (clipping/overflow) and screenshot —
 * things jsdom unit tests cannot do.
 *
 * Build: esbuild autotest/entry.ts --bundle --format=iife --loader:.less=empty
 *        --outfile=autotest/bundle.js
 */
import { Visual } from "../src/visual";
import { createMockHost } from "../test/harness/mockHost";
import { buildDataView } from "../test/harness/mockDataView";
import { enumerateCandidates } from "../test/harness/sweep";

interface MountOpts {
    dv?: Record<string, unknown>;
    host?: Record<string, unknown>;
    viewport?: { width: number; height: number };
    /** Mutate the live formatting model before the (re)render, e.g. flip a setting. */
    settings?: Record<string, unknown>;
}

(window as unknown as { __zentrixMount: (o: MountOpts) => string | null }).__zentrixMount = (opts: MountOpts) => {
    const dv = opts.dv ?? {};
    const host = opts.host ?? {};
    const viewport = opts.viewport ?? { width: 1200, height: 600 };

    const root = document.getElementById("root")!;
    root.replaceChildren();
    const el = document.createElement("div");
    el.id = "host";
    el.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;position:relative;overflow:visible;background:#fff;`;
    root.appendChild(el);

    const h = createMockHost(host as never);
    const v = new Visual({ element: el, host: h } as never);

    // Optional: flip formatting-model values, then re-render (mirrors the unit sweep).
    if (opts.settings) {
        v.update({ dataViews: [buildDataView(dv as never)], viewport, type: 2 } as never);
        const model = (v as unknown as { formattingSettings: Record<string, never> }).formattingSettings;
        for (const path of Object.keys(opts.settings)) {
            const segs = path.split(".");
            let cur: Record<string, never> = model;
            for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
            (cur[segs[segs.length - 1]] as unknown as { value: unknown }).value = (opts.settings as Record<string, unknown>)[path];
        }
        (v as unknown as { rerenderFromSettings: () => void }).rerenderFromSettings();
    } else {
        v.update({ dataViews: [buildDataView(dv as never)], viewport, type: 2 } as never);
    }

    return (h as unknown as { __lastFailure?: string }).__lastFailure ?? null;
};

/* ---- settings-sweep API: drive every enumerated setting in a real browser ---- */
const CANDIDATES = enumerateCandidates();

(window as unknown as { __listCandidates: () => unknown }).__listCandidates = () =>
    CANDIDATES.map((c, i) => ({ index: i, label: c.label, cardName: c.cardName, sliceName: c.sliceName, expectChange: c.expectChange }));

/**
 * Mount a fresh visual, apply candidate[index]'s prereq + value via the live
 * formatting model + optimistic rerender (the same path the in-visual settings
 * overlay uses), and report whether the SVG actually changed. The DOM is left
 * mounted so the driver can then call __inspectSweep() for real geometry.
 */
(window as unknown as { __runCandidate: (i: number, dv?: unknown, vp?: unknown) => unknown }).__runCandidate = (index: number, dvOpts?: unknown, viewport?: unknown) => {
    const dv = (dvOpts as Record<string, unknown>) ?? { year: 2025, withTarget: true, withTooltip: true };
    const vp = (viewport as { width: number; height: number }) ?? { width: 1500, height: 600 };

    const root = document.getElementById("root")!;
    root.replaceChildren();
    const el = document.createElement("div");
    el.id = "host";
    el.style.cssText = `width:${vp.width}px;height:${vp.height}px;position:relative;overflow:visible;background:#fff;`;
    root.appendChild(el);

    const h = createMockHost({} as never);
    const v = new Visual({ element: el, host: h } as never);
    v.update({ dataViews: [buildDataView(dv as never)], viewport: vp, type: 2 } as never);

    const model = (v as unknown as { formattingSettings: never }).formattingSettings;
    const c = CANDIDATES[index];
    const svgHtml = () => (document.querySelector("svg.zentrix-heatmap") as SVGElement | null)?.outerHTML ?? "";

    if (c.prereq) { c.prereq(model); (v as unknown as { rerenderFromSettings: () => void }).rerenderFromSettings(); }
    const before = svgHtml();
    let threw: string | null = null;
    try {
        c.apply(model);
        (v as unknown as { rerenderFromSettings: () => void }).rerenderFromSettings();
    } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    const after = svgHtml();

    return {
        label: c.label,
        tookEffect: before !== after,
        threw,
        failure: (h as unknown as { __lastFailure?: string }).__lastFailure ?? null,
    };
};

