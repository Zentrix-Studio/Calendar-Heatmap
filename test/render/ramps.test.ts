"use strict";

/**
 * Colorblind-safety (CVD) check for the ramp presets - spec acceptance #8
 * ("colorblind-safe palette passes a CVD simulator"). Pure: imports the d3-free
 * ramp constants from src/render/ramps so it runs in the normal Jest runtime.
 *
 * Two guarantees are asserted:
 *  1. LUMINANCE MONOTONICITY - each ramp's perceived lightness (CIE L*) is
 *     strictly monotonic across stops, and stays monotonic after simulating
 *     protan / deutan / tritan vision. A luminance-ordered ramp is readable
 *     under ANY color vision, because lightness perception is largely intact.
 *  2. ADJACENT SEPARATION - for the dedicated colorblind ramp, neighbouring
 *     stops stay well above the just-noticeable difference (CIE76 dE ~ 2.3)
 *     under every simulation, so steps never visually merge.
 */

import { COLORBLIND_RAMP, VIRIDIS_RAMP, VIOLET_RAMP_LIGHT, VIOLET_RAMP_DARK, rampForPreset } from "../../src/render/ramps";

type RGB = [number, number, number];

function hexToRgb(h: string): RGB {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Classic CVD simulation matrices (applied to sRGB), severity = full dichromacy.
const CVD: Record<string, number[][]> = {
    normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    protan: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
    deutan: [[0.625, 0.375, 0], [0.70, 0.30, 0], [0, 0.30, 0.70]],
    tritan: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};

function simulate(rgb: RGB, m: number[][]): RGB {
    const out = m.map(row => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]);
    return out.map(c => Math.max(0, Math.min(255, c))) as RGB;
}

function srgbToLinear(c: number): number {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

function rgbToLab([r, g, b]: RGB): [number, number, number] {
    const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
    // linear sRGB -> XYZ (D65)
    let X = R * 0.4124 + G * 0.3576 + B * 0.1805;
    let Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    let Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
    // normalize to D65 white
    X /= 0.95047; Y /= 1.0; Z /= 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const lightness = (hex: string, m: number[][]) => rgbToLab(simulate(hexToRgb(hex), m))[0];

function deltaE76(a: [number, number, number], b: [number, number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Strictly monotonic (either direction) with a minimum step gap. */
function assertMonotonicL(ramp: string[], m: number[][], minGap: number): void {
    const ls = ramp.map(h => lightness(h, m));
    const increasing = ls[ls.length - 1] > ls[0];
    for (let i = 1; i < ls.length; i++) {
        const d = ls[i] - ls[i - 1];
        if (increasing) expect(d).toBeGreaterThanOrEqual(minGap);
        else expect(-d).toBeGreaterThanOrEqual(minGap);
    }
}

describe("ramp CVD safety", () => {
    const seqRamps: Record<string, string[]> = {
        colorblind: COLORBLIND_RAMP, viridis: VIRIDIS_RAMP,
        violetLight: VIOLET_RAMP_LIGHT, violetDark: VIOLET_RAMP_DARK,
    };

    for (const [name, ramp] of Object.entries(seqRamps)) {
        for (const sim of Object.keys(CVD)) {
            it(`${name} stays luminance-monotonic under ${sim} vision`, () => {
                // The dedicated colorblind ramp must keep a strong lightness step
                // under every CVD type. The optional ramps (viridis/violet) must at
                // minimum never INVERT lightness order - viridis legitimately
                // compresses (not reverses) in the blue-green region under tritan.
                const minGap = name === "colorblind" ? 4 : sim === "normal" ? 4 : 0.5;
                assertMonotonicL(ramp, CVD[sim], minGap);
            });
        }
    }

    it("colorblind ramp keeps adjacent stops well-separated under every CVD type", () => {
        for (const sim of Object.keys(CVD)) {
            const labs = COLORBLIND_RAMP.map(h => rgbToLab(simulate(hexToRgb(h), CVD[sim])));
            for (let i = 1; i < labs.length; i++) {
                // ~3x the JND (2.3) - neighbouring buckets can never visually merge.
                expect(deltaE76(labs[i], labs[i - 1])).toBeGreaterThanOrEqual(7);
            }
        }
    });

    it("every ramp preset resolves to 5 valid hex stops in both themes", () => {
        const presets = ["violet", "ocean", "forest", "magma", "viridis", "colorblind"] as const;
        for (const p of presets) {
            for (const dark of [false, true]) {
                const stops = rampForPreset(p, dark);
                expect(stops.length).toBeGreaterThanOrEqual(5);
                for (const s of stops) expect(s).toMatch(/^#[0-9A-Fa-f]{6}$/);
            }
        }
    });
});
