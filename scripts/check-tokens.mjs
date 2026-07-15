#!/usr/bin/env node
/**
 * check-tokens.mjs — Zentrix token DRIFT CHECKER (verify-only, never writes).
 *
 * The heatmap ships a hand-maintained token snapshot at
 * src/theme/zentrixTokens.ts (pbiviz's webpack sandbox can't resolve the pnpm
 * workspace symlink at bundle time, so the visual imports static values). This
 * checker guarantees those hex values haven't drifted from the canonical
 * design system at platform/packages/tokens/src/.
 *
 *   node scripts/check-tokens.mjs          # report; exit 1 if any value drifted
 *
 * It esbuild-bundles the canonical ESM/TS source to a temp module, imports it,
 * and compares each mapped mirror export against canonical. Values with no
 * canonical source (intentional local overrides, e.g. the Power-BI-native font)
 * are listed as LOCAL and not failed. Read-only: it can never break the build.
 */

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIRROR = resolve(__dirname, "../src/theme/zentrixTokens.ts");
const CANON = resolve(__dirname, "../../../../packages/tokens/src/index.ts");

// mirror export name -> how to read the same value from canonical tokens
const MAP = {
  accent:               t => t.palettes.aurora.dark.accent,
  accentStrong:         t => t.palettes.aurora.dark.accentStrong,
  posSafe:              t => t.semantic.posSafe,
  negSafe:              t => t.semantic.negSafe,
  posSafeStrong:        t => t.semantic.posSafeStrong,
  negSafeStrong:        t => t.semantic.negSafeStrong,
  surfaceBase:          t => t.themes.dark.surface.base,
  surfaceSubtle:        t => t.themes.dark.surface.subtle,
  surfaceCard:          t => t.themes.dark.surface.card,
  surfaceElevated:      t => t.themes.dark.surface.elevated,
  surfaceOverlay:       t => t.themes.dark.surface.overlay,
  textPrimary:          t => t.themes.dark.text.primary,
  textSecondary:        t => t.themes.dark.text.secondary,
  textTertiary:         t => t.themes.dark.text.tertiary,
  textDisabled:         t => t.themes.dark.text.disabled,
  surfaceElevatedLight: t => t.themes.light.surface.elevated,
  surfaceOverlayLight:  t => t.themes.light.surface.overlay,
  textPrimaryLight:     t => t.themes.light.text.primary,
  textTertiaryLight:    t => t.themes.light.text.tertiary,
  markRadiusCell:       t => parseInt(t.markRadius.cell, 10),
};
// exports intentionally local to the visual (not sourced from canonical):
//   fontFamily    — Power-BI-native Segoe UI stack, not the brand Inter font
//   textMutedDark — no canonical `dark.text.muted` key; a heatmap-local shade
const LOCAL = new Set(["fontFamily", "textMutedDark"]);

const norm = v => (typeof v === "string" ? v.trim().toLowerCase() : v);

async function loadCanonical() {
  const esbuild = await import("esbuild");
  const tmp = mkdtempSync(join(tmpdir(), "zentrix-tokens-"));
  const out = join(tmp, "tokens.mjs");
  try {
    await esbuild.build({
      entryPoints: [CANON], bundle: true, format: "esm",
      platform: "node", outfile: out, logLevel: "silent",
    });
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parseMirror() {
  const src = readFileSync(MIRROR, "utf8");
  const out = {};
  const re = /export const (\w+)\s*=\s*("(?:[^"\\]|\\.)*"|\d+)/g;
  let m;
  while ((m = re.exec(src))) {
    let v = m[2];
    if (v.startsWith('"')) v = JSON.parse(v);
    else v = parseInt(v, 10);
    out[m[1]] = v;
  }
  return out;
}

const canon = await loadCanonical();
const mirror = parseMirror();

const drift = [];
const ok = [];
const missing = [];
for (const [name, read] of Object.entries(MAP)) {
  if (!(name in mirror)) { missing.push(`${name} (not exported by mirror)`); continue; }
  let expected;
  try { expected = read(canon); } catch { expected = undefined; }
  if (expected === undefined) { missing.push(`${name} (no value at canonical path)`); continue; }
  if (norm(expected) !== norm(mirror[name])) {
    drift.push({ name, mirror: mirror[name], canonical: expected });
  } else {
    ok.push(name);
  }
}

console.log(`[check-tokens] ${ok.length} in sync · ${drift.length} drifted · ${missing.length} unmapped · ${LOCAL.size} local`);
if (LOCAL.size) console.log(`  local (not checked): ${[...LOCAL].join(", ")}`);
if (missing.length) {
  console.log("  UNMAPPED (mapping needs attention):");
  for (const s of missing) console.log(`    - ${s}`);
}
if (drift.length) {
  console.error("  DRIFT DETECTED:");
  for (const d of drift) console.error(`    ✗ ${d.name}: mirror=${JSON.stringify(d.mirror)}  canonical=${JSON.stringify(d.canonical)}`);
  console.error("  Update src/theme/zentrixTokens.ts to match canonical, or justify the override in LOCAL.");
  process.exit(1);
}
if (missing.length) { console.error("  Unmapped entries above — resolve before trusting the check."); process.exit(2); }
console.log("[check-tokens] OK — mirror matches canonical @zentrix/tokens.");
