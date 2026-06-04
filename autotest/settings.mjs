/*
 * Settings sweep in a REAL browser. Reuses the same enumerateCandidates() the
 * jsdom unit sweep uses, but drives every setting through headless Chromium and
 * checks each one:
 *   1. took effect      — the rendered SVG actually changed (when expected)
 *   2. render integrity — no renderingFailed, cells render, no NaN/undefined/
 *                         Infinity, nothing clipped above the top edge, no overflow
 *   3. correctness      — for the visually-meaningful settings (layout, colour,
 *                         text size, text colour, bold/italic, legend, cell shape)
 *                         the right attribute actually changed to the right value.
 *
 * Run:  node autotest/settings.mjs   (expects autotest/bundle.js built)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
mkdirSync(OUT, { recursive: true });
const BUNDLE = readFileSync(join(__dirname, "bundle.js"), "utf8");

/* inspector: reads the attributes applyText() sets, plus cell geometry/fills */
function inspectorSrc() {
    return `window.__inspectSweep = function () {
    const host = document.getElementById('host');
    const svg = host && host.querySelector('svg.zentrix-heatmap');
    if (!svg) return { hasSvg: false };
    const sr = svg.getBoundingClientRect();
    const cells = Array.from(svg.querySelectorAll('rect.cell'));
    const texts = Array.from(svg.querySelectorAll('text'));
    let minTop = Infinity; const overflow = [];
    for (const t of texts) {
      const r = t.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const top = r.top - sr.top, left = r.left - sr.left, right = r.right - sr.left, bottom = r.bottom - sr.top;
      minTop = Math.min(minTop, top);
      if (top < -0.6 || left < -0.6 || right > sr.width + 0.6 || bottom > sr.height + 0.6) overflow.push((t.textContent || '').slice(0, 18));
    }
    const svgStr = new XMLSerializer().serializeToString(svg);
    const badTokens = ['NaN', 'undefined', 'Infinity'].filter(t => svgStr.includes(t));
    const c0 = cells[0];
    const cell0 = c0 ? { w: c0.getAttribute('width'), rx: c0.getAttribute('rx'), fill: c0.getAttribute('fill'), x: c0.getAttribute('x') } : null;
    const fillSet = new Set(cells.map(c => (c.getAttribute('fill') || '').toLowerCase()));
    const textAttr = texts.map(t => ({
      t: (t.textContent || '').slice(0, 14),
      size: t.getAttribute('font-size'),
      weight: t.getAttribute('font-weight'),
      style: t.getAttribute('font-style'),
      deco: t.getAttribute('text-decoration'),
      family: (t.getAttribute('font-family') || '').split(',')[0].replace(/['"]/g, ''),
      fill: (t.getAttribute('fill') || '').toLowerCase(),
    }));
    const allText = texts.map(t => t.textContent);
    return {
      hasSvg: true, cells: cells.length, texts: texts.length,
      minTop: +minTop.toFixed(1), overflow, badTokens,
      cell0, fillCount: fillSet.size,
      textAttr, allText,
      hasLegend: allText.some(s => s === 'Less' || s === 'More'),
      emojiCount: allText.filter(s => s && /[\\u{1F000}-\\u{1FAFF}\\u2600-\\u27BF\\u26A0]/u.test(s)).length,
    };
  };`;
}

/* targeted correctness for the user-named categories; returns array of failures */
function targeted(label, info) {
    const f = [];
    const has = (pred) => info.textAttr.some(pred);
    let m;
    if ((m = label.match(/\.fontSize → (\d+)/))) {
        if (!has((s) => s.size === `${m[1]}px`)) f.push(`font-size ${m[1]}px not present on any text`);
    }
    if (/\.bold → true$/.test(label) && !has((s) => s.weight === "700")) f.push("bold (font-weight 700) not applied");
    if (/\.italic → true$/.test(label) && !has((s) => s.style === "italic")) f.push("italic not applied");
    if (/\.underline → true$/.test(label) && !has((s) => s.deco === "underline")) f.push("underline not applied");
    if (/\.color → #E5484D$/.test(label) && !has((s) => s.fill === "#e5484d")) f.push("text colour #E5484D not applied to any text");
    if (/^colors\.(ramp|paletteMode|scaleMode|bucketCount)/.test(label) && info.cell0 && info.fillCount < 2)
        f.push(`palette produced <2 distinct cell colours (fillCount=${info.fillCount})`);
    if (/colors\.startColor → #E5484D$/.test(label) && info.fillCount < 2) f.push("mono start colour produced a flat scale");
    if (/legend\.show → false$/.test(label) && info.hasLegend) f.push("legend text still present after Show legend = false");
    if (/cells\.cornerRadius → /.test(label) && info.cell0 && (info.cell0.rx === null)) f.push("corner radius not reflected in cell rx");
    if (/dataDisplay\.layout → Month blocks$/.test(label) && info.cells <= 0) f.push("month-block layout rendered no cells");
    return f;
}

/* which candidates to screenshot for visual evidence */
const SHOT = /dataDisplay\.layout → Month|colors\.ramp → (Ocean|Magma|Viridis|Colorblind)|colors\.paletteMode → (Mono|Duotone|Split)|colors\.scaleMode → (Linear|Log)|headline\.color|monthRail\.fontSize|header\.align → Center|legend\.position → Top|badges\.peakOn|headline\.fontSize → 30|statChips\.fontSize → 28|statChips\.fontFamily → Cascadia/;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
await page.addScriptTag({ content: BUNDLE });
await page.addScriptTag({ content: inspectorSrc() });

const candidates = await page.evaluate(() => window.__listCandidates());
console.log(`Enumerated ${candidates.length} setting candidates. Sweeping in real Chromium...\n`);

// Some cards only render text in a specific dataset context: facet titles need a
// Split-by (faceted) dataset; year tags need multi-year data. Feed each the data
// that actually exercises it, otherwise "no text to style" reads as a false bug.
function dvFor(card) {
    if (card === "facetTitle" || card === "smallMultiples") return { year: 2025, categories: ["Alpha", "Beta", "Gamma"], withTarget: true };
    if (card === "yearTags") return { years: [2024, 2025], withTarget: true };
    return { year: 2025, withTarget: true, withTooltip: true };
}

const rows = [];
let shots = 0;
for (const c of candidates) {
    const run = await page.evaluate(({ i, dv }) => window.__runCandidate(i, dv), { i: c.index, dv: dvFor(c.cardName) });
    await page.waitForTimeout(6);
    const info = await page.evaluate(() => window.__inspectSweep());

    const fails = [];
    if (run.threw) fails.push(`THREW: ${run.threw}`);
    if (run.failure) fails.push(`renderingFailed: ${run.failure}`);
    if (!info.hasSvg) fails.push("no svg rendered");
    else {
        if (info.cells <= 0) fails.push("no cells rendered");
        if (info.badTokens.length) fails.push(`NaN/undefined/Infinity in SVG: ${info.badTokens.join(",")}`);
        if (info.minTop < -0.6) fails.push(`clipped above top edge (minTop=${info.minTop})`);
        if (info.overflow.length) fails.push(`${info.overflow.length} text overflow: ${info.overflow.join("|").slice(0, 60)}`);
    }
    if (c.expectChange && !run.tookEffect) fails.push("NO EFFECT — SVG identical after applying");
    fails.push(...targeted(c.label, info));

    rows.push({ label: c.label, card: c.cardName, expectChange: c.expectChange, tookEffect: run.tookEffect, fails });

    if (SHOT.test(c.label) && shots < 24) {
        const safe = c.label.replace(/[^a-z0-9]+/gi, "_").slice(0, 48);
        await page.locator("#host").screenshot({ path: join(OUT, `set_${safe}.png`) }).catch(() => {});
        shots++;
    }
}

await browser.close();

/* ---- report ---- */
const bad = rows.filter((r) => r.fails.length);
const byCard = {};
for (const r of rows) {
    byCard[r.card] = byCard[r.card] || { total: 0, fail: 0 };
    byCard[r.card].total++;
    if (r.fails.length) byCard[r.card].fail++;
}
writeFileSync(join(OUT, "settings-report.json"), JSON.stringify({ total: rows.length, failed: bad.length, pageErrors, byCard, bad }, null, 2));

console.log("Per-card results (fail / total):");
for (const [card, v] of Object.entries(byCard)) console.log(`  ${v.fail ? "✗" : "✓"} ${card.padEnd(16)} ${v.fail}/${v.total}`);
console.log(`\nTotal candidates: ${rows.length}   passed: ${rows.length - bad.length}   FAILED: ${bad.length}`);
if (pageErrors.length) console.log(`Page errors: ${pageErrors.length}\n  ${pageErrors.join("\n  ")}`);
if (bad.length) {
    console.log("\nFailures:");
    for (const r of bad) console.log(`  ✗ ${r.label}\n      → ${r.fails.join("; ")}`);
} else {
    console.log("\nEvery setting took effect and rendered correctly. ✓");
}
console.log(`\nScreenshots: ${shots} curated (set_*.png) in autotest/out/`);
process.exit(0);
