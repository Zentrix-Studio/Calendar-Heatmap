/*
 * Minimal IVisualHost stand-in — just the members the Zentrix visual touches.
 * Reusable across visuals: most formatting-model visuals need exactly this set.
 *
 * `__lastFailure` captures whatever the visual reports via
 * eventService.renderingFailed, so the sweep can detect a swallowed throw
 * (Visual.update wraps its body in try/catch and reports here).
 */
"use strict";

import powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;

export interface MockHost extends IVisualHost {
    __lastFailure?: string;
}

export interface MockHostOptions {
    dark?: boolean;
    highContrast?: boolean;
    /** When set, PremiumGate sees a "supported env, no active plan" → insights lock. */
    lockPremium?: boolean;
    /**
     * Playground cross-filter hook. The visual builds selection ids via
     * createSelectionIdBuilder().withCategory(col, index); on click it calls
     * selectionManager.select(id). We capture each id's source row index and report
     * the current selection (or null on clear) so the canvas can cross-filter peers.
     */
    onSelect?: (indices: number[] | null) => void;
}

export function createMockHost(opts: MockHostOptions = {}): MockHost {
    const dark = !!opts.dark;

    let idSeq = 0;
    let lastIndex = -1;
    const builder: any = {
        withCategory: (_col: any, index: number) => { lastIndex = index; return builder; },
        withMeasure: () => builder,
        withSeries: () => builder,
        withTable: (_t: any, index: number) => { lastIndex = index; return builder; },
        withMatrixNode: () => builder,
        createSelectionId: () => {
            const key = `sel-${idSeq++}`;
            const index = lastIndex;
            return { equals: (o: any) => o && o.__key === key, getKey: () => key, __key: key, __index: index };
        },
    };

    let selected: any[] = [];
    const report = () => {
        if (!opts.onSelect) return;
        opts.onSelect(selected.length ? selected.map((s) => s.__index).filter((i: number) => i >= 0) : null);
    };
    const selectionManager: any = {
        select: (idOrIds: any, multi?: boolean) => {
            const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
            selected = multi ? [...selected, ...ids] : ids;
            report();
            return Promise.resolve(selected);
        },
        clear: () => {
            selected = [];
            report();
            return Promise.resolve();
        },
        getSelectionIds: () => selected,
        hasSelection: () => selected.length > 0,
        registerOnSelectCallback: () => undefined,
        showContextMenu: () => Promise.resolve(),
        applySelectionFilter: () => undefined,
    };

    // PremiumGate reads host.licenseManager.getAvailableServicePlans(). Omitting it
    // → fail-open ACTIVE (dev default). Provide a locking one when asked.
    const licenseManager = opts.lockPremium
        ? { getAvailableServicePlans: () => Promise.resolve({ isLicenseUnsupportedEnv: false, plans: [] }) }
        : undefined;

    const host: MockHost = {
        createSelectionIdBuilder: () => builder,
        createSelectionManager: () => selectionManager,
        colorPalette: {
            isHighContrast: !!opts.highContrast,
            background: { value: dark ? "#0F0F16" : "#FFFFFF" },
            foreground: { value: dark ? "#F4F4F6" : "#1A1A22" },
            foregroundSelected: { value: "#7C5CFF" },
            hyperlink: { value: "#7C5CFF" },
        } as any,
        eventService: {
            renderingStarted: () => undefined,
            renderingFinished: () => undefined,
            renderingFailed: (_o: any, reason?: string) => { host.__lastFailure = reason || "unknown"; },
        } as any,
        tooltipService: { enabled: () => false, show: () => undefined, hide: () => undefined, move: () => undefined } as any,
        persistProperties: () => undefined,
        licenseManager: licenseManager as any,
        locale: "en-US",
        instanceId: "mock-instance",
        launchUrl: () => undefined,
        refreshHostData: () => undefined,
        applyJsonFilter: () => undefined,
        fetchMoreData: () => true,
        displayWarningIcon: () => undefined,
        telemetry: { trace: () => undefined } as any,
        hostCapabilities: { allowInteractions: true } as any,
        switchFocusModeState: () => undefined,
        createLocalizationManager: () => ({ getDisplayName: (k: string) => k }) as any,
        storageService: { get: () => Promise.reject(), set: () => Promise.resolve(), remove: () => Promise.resolve() } as any,
        eventService2: undefined,
        colorPalette2: undefined,
    } as unknown as MockHost;

    return host;
}
