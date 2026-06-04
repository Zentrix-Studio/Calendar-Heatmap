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
}

export function createMockHost(opts: MockHostOptions = {}): MockHost {
    const dark = !!opts.dark;

    let idSeq = 0;
    const builder: any = {
        withCategory: () => builder,
        withMeasure: () => builder,
        withSeries: () => builder,
        withTable: () => builder,
        withMatrixNode: () => builder,
        createSelectionId: () => {
            const key = `sel-${idSeq++}`;
            return { equals: (o: any) => o && o.__key === key, getKey: () => key, __key: key };
        },
    };

    const selectionManager: any = {
        select: () => Promise.resolve([]),
        clear: () => Promise.resolve(),
        getSelectionIds: () => [],
        hasSelection: () => false,
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
