"use strict";

import powerbi from "powerbi-visuals-api";
type IVisualHost = powerbi.extensibility.visual.IVisualHost;

/**
 * Premium licence gate for the diagnostic insight engine (free core + premium
 * gate, per the Phase-8 monetization decision).
 *
 * The Power BI licensing API is async (`getAvailableServicePlans` returns a
 * Promise) while the render loop is synchronous, so this resolves the plan once
 * and exposes a sync `active` flag; when it lands it calls `onResolved()` to
 * repaint. The exact result/plan TS types vary across `powerbi-visuals-api`
 * versions, so the manager is accessed through a small structural shape rather
 * than named imports - the runtime methods are the real host ones.
 *
 * Fail-safe / demo-friendly:
 *   - Unsupported env (Desktop dev, embedding, older hosts) or any API error
 *     -> ACTIVE, so the feature is demoable and the visual never crashes.
 *   - Supported env with at least one Active/Purchased plan -> ACTIVE.
 *   - Supported env, no plans returned (v1: no Partner Center plan configured) -> ACTIVE.
 *   - Supported env, plan(s) present but none active -> LOCKED.
 *
 * v1 FREE-FIRST: the gate is intentionally fail-open. `plans.length === 0` means no
 * Partner Center paid plan has been configured — the correct behaviour for a free
 * visual is ACTIVE, not LOCKED. Only lock once a plan is actually provisioned and
 * a plan entry with a non-active state is returned by the host.
 *
 * NOTE (post-v1): when a paid plan is configured in Partner Center and verified
 * end-to-end in Service, set LOCK_ON_NO_PLAN = true to enforce the gate.
 */

interface ServicePlanLike { state?: string; status?: string; spState?: string; }
interface LicenseInfoLike { isLicenseUnsupportedEnv?: boolean; plans?: ServicePlanLike[]; servicePlans?: ServicePlanLike[]; }
interface LicenseManagerLike {
    getAvailableServicePlans?: () => Promise<LicenseInfoLike>;
    notifyFeatureBlocked?: (messages?: unknown) => Promise<unknown>;
}

const ACTIVE_STATES = new Set(["Active", "Purchased"]);

/**
 * v1 FREE-FIRST flag. When false (current), no-plans → ACTIVE (fail-open).
 * Flip to true only after a Partner Center paid plan is configured and
 * end-to-end verified in Power BI Service.
 */
const LOCK_ON_NO_PLAN = false;

export class PremiumGate {
    /** Optimistic until the async check resolves, so the first paint isn't a flash of "locked". */
    active = true;
    private requested = false;

    constructor(private host: IVisualHost, private onResolved: () => void) {}

    /** Kick the plan check once (idempotent); repaint via onResolved when it lands. */
    refresh(): void {
        if (this.requested) return;
        this.requested = true;
        const lm = this.manager();
        if (!lm || typeof lm.getAvailableServicePlans !== "function") return;
        lm.getAvailableServicePlans()
            .then(res => {
                const next = this.resolve(res);
                if (next !== this.active) { this.active = next; this.onResolved(); }
            })
            .catch(() => { /* keep optimistic ACTIVE on error */ });
    }

    private manager(): LicenseManagerLike | undefined {
        const host = this.host as unknown as { licenseManager?: LicenseManagerLike };
        return host.licenseManager;
    }

    private resolve(res: LicenseInfoLike | undefined): boolean {
        if (!res || res.isLicenseUnsupportedEnv) return true;           // dev / embed / unsupported -> allow
        const plans = res.servicePlans ?? res.plans ?? [];
        if (plans.length === 0) return !LOCK_ON_NO_PLAN;                // no plan configured: fail-open for v1
        return plans.some(p => ACTIVE_STATES.has(p.state ?? p.status ?? p.spState ?? ""));
    }

    /** Surface the host's standard upsell when a gated feature is used. Best-effort. */
    notifyBlocked(): void {
        const lm = this.manager();
        if (lm && typeof lm.notifyFeatureBlocked === "function") {
            try { lm.notifyFeatureBlocked()?.catch?.(() => { /* ignore */ }); } catch { /* ignore */ }
        }
    }
}
