/*
 * Automated visual test driver. Renders the REAL Visual in headless Chromium
 * (real SVG layout + text metrics) and asserts on actual geometry — catching
 * clipping/overflow/NaN/render bugs that jsdom unit tests cannot see. Also
 * exercises hover (tooltip) and keyboard, across light/dark/HC and many
 * viewports, and writes screenshots for visual evidence.
 *
 * Run:  node autotest/run.mjs   (expects autotest/bundle.js already built)
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "out");
mkdirSync(OUT, { recursive: true });
const BUNDLE = readFileSync(join(__dirname, "bundle.js"), "utf8");

/* ---- in-page inspector: measures REAL geometry of the mounted visual ---- */
function inspectorSrc() {
    return `window.__inspect = function () {
    const host = document.getElementById('host');
    const svg = host && host.querySelector('svg.zentrix-heatmap');
    if (!svg) return { hasSvg: false };
    const sr = svg.getBoundingClientRect();
    const texts = Array.from(svg.querySelectorAll('text'));
    let minTop = Infinity, minLeft = Infinity, maxRight = -Infinity, maxBottom = -Infinity;
    const overflow = [];
    for (const t of texts) {
      const r = t.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const top = r.top - sr.top, left = r.left - sr.left, right = r.right - sr.left, bottom = r.bottom - sr.top;
      minTop = Math.min(minTop, top); minLeft = Math.min(minLeft, left);
      maxRight = Math.max(maxRight, right); maxBottom = Math.max(maxBottom, bottom);
      if (top < -0.6 || left < -0.6 || right > sr.width + 0.6 || bottom > sr.height + 0.6)
        overflow.push({ text: (t.textContent || '').slice(0, 40), top: +top.toFixed(1), left: +left.toFixed(1), right: +right.toFixed(1), bottom: +bottom.toFixed(1) });
    }
    const svgStr = new XMLSerializer().serializeToString(svg);
    const badTokens = ['NaN', 'undefined', 'Infinity'].filter(tok => svgStr.includes(tok));
    const allText = texts.map(t => t.textContent);
    return {
      hasSvg: true,
      svgW: +sr.width.toFixed(1), svgH: +sr.height.toFixed(1),
      cells: svg.querySelectorAll('rect.cell').length,
      rects: svg.querySelectorAll('rect').length,
      texts: texts.length,
      minTop: +minTop.toFixed(1), minLeft: +minLeft.toFixed(1),
      maxRight: +maxRight.toFixed(1), maxBottom: +maxBottom.toFixed(1),
      overflow,
      badTokens,
      pipeText: allText.find(s => s && s.includes('|')) || null,
      hasYear2024: allText.some(s => s && s.includes('2024')),
      hasYear2025: allText.some(s => s && s.includes('2025')),
      allText,
    };
  };`;
}

const scenarios = [
    { name: "baseline-2025", mount: { dv: { year: 2025 }, viewport: { width: 1200, height: 600 } } },
    { name: "multiyear-2024-2025", mount: { dv: { years: [2024, 2025] }, viewport: { width: 1200, height: 600 } } },
    { name: "target-and-tooltip", mount: { dv: { year: 2025, withTarget: true, withTooltip: true }, viewport: { width: 1200, height: 600 } } },
    { name: "faceted-3-teams", mount: { dv: { year: 2025, categories: ["Alpha", "Beta", "Gamma"] }, viewport: { width: 1200, height: 600 } } },
    { name: "dark-theme", mount: { dv: { year: 2025 }, host: { dark: true }, viewport: { width: 1200, height: 600 } } },
    { name: "high-contrast", mount: { dv: { year: 2025 }, host: { highContrast: true }, viewport: { width: 1200, height: 600 } } },
    { name: "tiny-viewport", mount: { dv: { year: 2025 }, viewport: { width: 240, height: 160 } } },
    { name: "wide-short", mount: { dv: { year: 2025 }, viewport: { width: 1500, height: 220 } } },
    { name: "narrow-tall", mount: { dv: { year: 2025 }, viewport: { width: 360, height: 720 } } },
    { name: "month-layout", mount: { dv: { year: 2025 }, viewport: { width: 1200, height: 700 }, settings: { "dataDisplay.layout": { value: "month", displayName: "Month blocks" } } } },
    // KPI header is OFF by default (settings.ts) — enable it to validate the handoff's
    // re-confirm items (header not clipped, peak-day chip with pipe + year).
    { name: "header-on", mount: { dv: { year: 2025, withTarget: true }, viewport: { width: 1200, height: 600 }, settings: { "labels.showHeader": true } } },
    { name: "header-on-multiyear", mount: { dv: { years: [2024, 2025] }, viewport: { width: 1300, height: 600 }, settings: { "labels.showHeader": true } } },
];

const findings = [];
function check(scenario, cond, severity, msg) {
    if (!cond) findings.push({ scenario, severity, msg });
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
page.on("pageerror", (e) => findings.push({ scenario: "(pageerror)", severity: "HIGH", msg: String(e) }));
await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
await page.addScriptTag({ content: BUNDLE });
await page.addScriptTag({ content: inspectorSrc() });

const results = {};
for (const sc of scenarios) {
    const failure = await page.evaluate((o) => window.__zentrixMount(o), sc.mount);
    await page.waitForTimeout(60);
    const info = await page.evaluate(() => window.__inspect());
    results[sc.name] = { failure, info };

    // ---- genuine assertions on REAL geometry ----
    check(sc.name, !failure, "HIGH", `Visual reported renderingFailed: ${failure}`);
    check(sc.name, info.hasSvg, "HIGH", "No <svg.zentrix-heatmap> rendered");
    if (info.hasSvg) {
        check(sc.name, info.cells > 0, "HIGH", `No cells rendered (cells=${info.cells})`);
        check(sc.name, info.badTokens.length === 0, "HIGH", `NaN/undefined/Infinity in SVG: ${info.badTokens.join(",")}`);
        check(sc.name, info.minTop >= -0.6, "HIGH", `Text clipped above top edge (minTop=${info.minTop}px) — KPI header clipping`);
        check(sc.name, info.overflow.length === 0, "MEDIUM", `${info.overflow.length} text node(s) overflow the SVG box: ${JSON.stringify(info.overflow).slice(0, 300)}`);
    }
    await page.locator("#host").screenshot({ path: join(OUT, `${sc.name}.png`) }).catch(() => {});
}

/* ---- scenario-specific semantic checks ---- */
check("multiyear-2024-2025", results["multiyear-2024-2025"].info.hasYear2024 && results["multiyear-2024-2025"].info.hasYear2025,
    "HIGH", "Multi-year render does not stamp BOTH 2024 and 2025 (ambiguous month labels)");

// Header is opt-in: baseline (default) should NOT show it; header-on MUST show a
// well-formed peak-day chip and a Total chip, with no top-edge clipping.
check("baseline-2025", results["baseline-2025"].info.pipeText === null, "LOW",
    "Baseline unexpectedly shows a peak chip (header should be OFF by default)");
const hOn = results["header-on"].info;
check("header-on", hOn.allText.some((t) => t === "Total"), "HIGH", `Header "Total" chip missing (texts: ${JSON.stringify(hOn.allText).slice(0, 200)})`);
check("header-on", hOn.pipeText && /\d/.test(hOn.pipeText) && /20\d{2}/.test(hOn.pipeText), "HIGH",
    `Peak-day chip missing value|date+year (got: ${JSON.stringify(hOn.pipeText)})`);
check("header-on", hOn.minTop >= -0.6, "HIGH", `KPI header clipped at top edge (minTop=${hOn.minTop}px) — the "Peak uay" class of bug`);
const hMy = results["header-on-multiyear"].info;
check("header-on-multiyear", hMy.pipeText && /20\d{2}/.test(hMy.pipeText), "HIGH",
    `Multi-year peak chip missing year (got: ${JSON.stringify(hMy.pipeText)})`);

/* ---- hover → tooltip (real mouse, real tooltip DOM) ---- */
await page.evaluate((o) => window.__zentrixMount(o), { dv: { year: 2025, withTarget: true }, viewport: { width: 1200, height: 600 } });
await page.waitForTimeout(60);
const cell = await page.evaluate(() => {
    const svg = document.querySelector("svg.zentrix-heatmap");
    const rects = Array.from(svg.querySelectorAll("rect.cell"));
    let best = null, bestV = -Infinity;
    for (const r of rects) { const d = r.__data__; if (d && d.value != null && d.value > bestV) { bestV = d.value; best = r; } }
    if (!best) return null;
    const b = best.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, value: bestV };
});
if (cell) {
    await page.mouse.move(cell.x, cell.y);
    await page.waitForTimeout(80);
    const tip = await page.evaluate(() => {
        const host = document.getElementById("host");
        const tt = Array.from(host.children).find((c) => c.tagName === "DIV" && c.style.position === "fixed");
        if (!tt || tt.style.display === "none") return { shown: false };
        const r = tt.getBoundingClientRect();
        return { shown: true, text: tt.textContent, w: r.width, h: r.height, right: r.right, bottom: r.bottom, onScreen: r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1 && r.left >= -1 && r.top >= -1 };
    });
    results["_hover"] = { cellValue: cell.value, tip };
    check("hover-tooltip", tip.shown, "HIGH", "Tooltip did not appear on hover");
    if (tip.shown) {
        check("hover-tooltip", tip.text && tip.text.includes("Tickets resolved"), "MEDIUM", `Tooltip missing value name (text: ${(tip.text || "").slice(0, 80)})`);
        check("hover-tooltip", tip.onScreen, "MEDIUM", `Tooltip renders partly off-screen (right=${tip.right}, bottom=${tip.bottom})`);
        check("hover-tooltip", !/(NaN|undefined|Infinity)/.test(tip.text || ""), "HIGH", `Tooltip text contains NaN/undefined/Infinity: ${(tip.text || "").slice(0, 120)}`);
    }
    await page.locator("#host").screenshot({ path: join(OUT, "hover-tooltip.png") }).catch(() => {});
}

/* ---- keyboard: focus first cell, ArrowDown should move focus to a different cell ---- */
await page.evaluate((o) => window.__zentrixMount(o), { dv: { year: 2025 }, viewport: { width: 1200, height: 600 } });
await page.waitForTimeout(60);
const kbd = await page.evaluate(async () => {
    const svg = document.querySelector("svg.zentrix-heatmap");
    const first = svg.querySelector('rect.cell[tabindex="0"]') || svg.querySelector("rect.cell");
    if (!first) return { ok: false, reason: "no focusable cell" };
    first.focus();
    const beforeAria = first.getAttribute("aria-label");
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const active = document.activeElement;
    return { ok: true, beforeAria, moved: active !== first && active && active.classList.contains("cell"), activeAria: active && active.getAttribute && active.getAttribute("aria-label") };
});
results["_keyboard"] = kbd;
check("keyboard-nav", kbd.ok && kbd.moved, "MEDIUM", `ArrowDown did not move focus to another cell (${JSON.stringify(kbd)})`);
check("keyboard-nav", !kbd.beforeAria || !/(NaN|undefined)/.test(kbd.beforeAria), "MEDIUM", `ARIA label malformed: ${kbd.beforeAria}`);

await browser.close();

/* ---- report ---- */
const summary = {
    scenarios: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.info ? { cells: v.info.cells, texts: v.info.texts, minTop: v.info.minTop, overflow: v.info.overflow?.length ?? 0, bad: v.info.badTokens, failure: v.failure } : v])),
    findings,
};
writeFileSync(join(OUT, "report.json"), JSON.stringify(summary, null, 2));

const high = findings.filter((f) => f.severity === "HIGH");
const med = findings.filter((f) => f.severity === "MEDIUM");
console.log(`\n=== Automated visual test — ${scenarios.length} scenarios + hover + keyboard ===`);
console.log(`Screenshots + report.json in autotest/out/`);
console.log(`Peak chip (header-on):      ${JSON.stringify(results["header-on"].info.pipeText)}`);
console.log(`Peak chip (header-on m-yr): ${JSON.stringify(results["header-on-multiyear"].info.pipeText)}`);
console.log(`Hover tooltip text:         ${JSON.stringify(results["_hover"]?.tip?.text?.slice(0, 90))}`);
console.log(`\nHIGH findings:   ${high.length}`);
high.forEach((f) => console.log(`  [HIGH]   ${f.scenario}: ${f.msg}`));
console.log(`MEDIUM findings: ${med.length}`);
med.forEach((f) => console.log(`  [MEDIUM] ${f.scenario}: ${f.msg}`));
console.log(high.length === 0 ? "\nNo HIGH-severity render bugs detected." : `\n${high.length} HIGH-severity issue(s) need attention.`);
process.exit(0);
