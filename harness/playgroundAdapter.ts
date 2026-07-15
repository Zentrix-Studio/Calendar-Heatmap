/*
 * vizHUB playground adapter — runs the REAL Zentrix Calendar Heatmap visual
 * outside Power BI, driven by user-uploaded data.
 *
 * This is the production host-shim spike (vizHUB/PLAN.md §2): it reuses the exact
 * `Visual` class shipped to AppSource plus the test `createMockHost`, and builds a
 * genuine categorical DataView from arrays the browser parsed from the user's CSV.
 * So the playground renders the same engine Power BI does — not a stand-in.
 *
 * Build (run from the visual project root):
 *   npx esbuild harness/playgroundAdapter.ts --bundle --format=iife \
 *     --outfile=<vizHUB>/public/visuals/calendar-heatmap.bundle.js --loader:.less=text
 */
import powerbi from "powerbi-visuals-api";
import { Visual } from "../src/visual";
import { createMockHost } from "../test/harness/mockHost";
import type { Note } from "../src/notes/core";

type DataView = powerbi.DataView;

/** Role-tagged metadata column, matching the shape Power BI hands the visual. */
function col(displayName: string, role: string, isDate = false): any {
  return {
    displayName,
    roles: { [role]: true },
    type: isDate ? { dateTime: true } : { numeric: !isNaN(0) },
    queryName: `q.${displayName}`,
  };
}

export interface MountPayload {
  /** ISO date strings (one per row). */
  dates: string[];
  /** Numeric values aligned to `dates`. */
  values: (number | null)[];
  /** Optional target measure aligned to `dates`. */
  target?: (number | null)[];
  /** Optional split-by category aligned to `dates`. */
  category?: string[];
  /**
   * Author-written annotations (Z-152). NOT a data role — these arrive the way the
   * host delivers them, as the persisted `notesStore.data` blob. Pass `Note[]` and
   * the adapter serializes it.
   */
  notes?: Note[];
  /** Optional extra measures/fields shown in each cell's tooltip. */
  tooltips?: { name: string; values: (string | number | null)[] }[];
  valueName?: string;
  /** Sparse Format-pane overrides: objectName -> propName -> value. */
  format?: Record<string, Record<string, unknown>>;
  viewport?: { width: number; height: number };
  dark?: boolean;
  /** Report theme = high contrast → the visual adapts via colorPalette.isHighContrast. */
  highContrast?: boolean;
  /** Cross-filter hook — fired with the clicked rows' indices (or null on clear). */
  onSelect?: (indices: number[] | null) => void;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Map the playground's sparse Format-pane overrides into the `objects` bag Power BI
 * hands the visual. Hex strings become fill objects ({ solid: { color } }); other
 * values pass through. Untouched props are absent, so the visual keeps its defaults.
 */
function buildObjects(format?: Record<string, Record<string, unknown>>): any {
  if (!format || !Object.keys(format).length) return undefined;
  const out: any = {};
  for (const [objName, props] of Object.entries(format)) {
    const bag: any = {};
    for (const [prop, value] of Object.entries(props)) {
      if (value === undefined || value === "") continue;
      bag[prop] = typeof value === "string" && HEX.test(value) ? { solid: { color: value } } : value;
    }
    if (Object.keys(bag).length) out[objName] = bag;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Build a categorical DataView from parsed user columns. */
function buildDataView(p: MountPayload): DataView {
  const dates = p.dates.map((d) => new Date(d));

  const dateCol = col("Date", "date", true);
  const valueCol = col(p.valueName ?? "Value", "value");

  const categories: any[] = [{ source: dateCol, values: dates }];
  const values: any[] = [{ source: valueCol, values: p.values }];
  const metaColumns: any[] = [dateCol, valueCol];

  if (p.category && p.category.length) {
    const catCol = col("Split by", "category");
    categories.push({ source: catCol, values: p.category });
    metaColumns.push(catCol);
  }
  if (p.target && p.target.some((t) => t != null)) {
    const tCol = col("Target", "target");
    values.push({ source: tCol, values: p.target });
    metaColumns.push(tCol);
  }
  for (const tip of p.tooltips ?? []) {
    const tipCol = col(tip.name, "tooltips");
    values.push({ source: tipCol, values: tip.values });
    metaColumns.push(tipCol);
  }

  // Annotations ride in on `metadata.objects`, not as a column — same channel the
  // real host uses to hand back what persistProperties wrote.
  const objects = buildObjects(p.format) ?? (p.notes?.length ? {} : undefined);
  if (p.notes?.length && objects) {
    objects.notesStore = { ...(objects.notesStore ?? {}), data: JSON.stringify({ v: 1, items: p.notes }) };
  }

  return {
    metadata: { columns: metaColumns, objects },
    categorical: { categories, values },
  } as unknown as DataView;
}

// Per-element instance + host, so multiple heatmap tiles can live on one canvas.
// `ref.current` holds the live payload so the host's onSelect wrapper always reaches
// the current cross-filter handler. `dark`/`hc` track the theme the host was built
// with — colorPalette is fixed at host creation, so a theme change must rebuild it.
interface ElState {
  instance: Visual;
  ref: { current: MountPayload };
  dark: boolean;
  hc: boolean;
}
const mounted = new WeakMap<HTMLElement, ElState>();

/** Render the visual into `element` with the given payload. Reuses per-element state. */
function mount(element: HTMLElement, payload: MountPayload): { rows: number } {
  const dataView = buildDataView(payload);
  const viewport = payload.viewport ?? {
    width: element.clientWidth || 960,
    height: element.clientHeight || 320,
  };

  let state = mounted.get(element);
  const themeChanged = !!state && (state.dark !== !!payload.dark || state.hc !== !!payload.highContrast);
  if (!state || themeChanged) {
    // First mount, or theme changed → rebuild host (new colorPalette) + instance.
    // Clearing the element also prevents the constructor's <svg> from stacking.
    element.replaceChildren();
    const ref = state?.ref ?? { current: payload };
    ref.current = payload;
    const host = createMockHost({
      dark: payload.dark,
      highContrast: payload.highContrast,
      onSelect: (indices) => ref.current.onSelect?.(indices),
    });
    const instance = new Visual({ element, host } as any);
    state = { instance, ref, dark: !!payload.dark, hc: !!payload.highContrast };
    mounted.set(element, state);
  }
  state.ref.current = payload;

  state.instance.update({
    dataViews: [dataView],
    viewport,
    // VisualUpdateType: Data | Resize | ViewMode | Style — be generous so the
    // visual takes the full rebuild path on every playground change.
    type: 0x3f,
  } as any);

  return { rows: payload.dates.length };
}

declare global {
  interface Window {
    ZentrixCalendarHeatmap?: { mount: typeof mount };
  }
}

if (typeof window !== "undefined") {
  window.ZentrixCalendarHeatmap = { mount };
}

export { mount };
