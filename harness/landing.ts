/*
 * Standalone landing-page harness — mounts the real LandingPage carousel at a
 * realistic Power BI tile size so the onboarding flow can be verified outside PBI.
 * Build: esbuild harness/landing.ts --bundle --outfile=harness/landing.js
 *
 * URL hash controls what is shown:
 *   #p=2        → start on page index 2 (0-based)
 *   #dark       → dark theme
 *   #grid       → render all 6 pages in a grid (light), for a contact sheet
 */
import { LandingPage } from "../src/interaction/landingPage";

function mount(parent: HTMLElement, w: number, h: number, dark: boolean, page: number): void {
    const wrap = document.createElement("div");
    wrap.style.cssText =
        `width:${w}px;height:${h}px;margin:10px;border-radius:10px;overflow:hidden;` +
        "box-shadow:0 8px 30px rgba(0,0,0,.12);position:relative;";
    parent.appendChild(wrap);
    const lp = new LandingPage(wrap);
    lp.setTheme(dark);
    lp.show();
    // advance to the requested page via its public keyboard handler
    for (let i = 0; i < page; i++) {
        wrap.querySelector<HTMLElement>(".zx-lp")?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowRight" }));
    }
}

const root = document.getElementById("root")!;
const hash = location.hash;
root.style.cssText = "display:flex;flex-wrap:wrap;background:#E9EBF2;padding:6px;margin:0;";

if (hash.includes("grid")) {
    for (let p = 0; p < 6; p++) mount(root, 540, 360, hash.includes("dark"), p);
} else {
    const page = (/p=(\d+)/.exec(hash)?.[1]) ? parseInt(/p=(\d+)/.exec(hash)![1], 10) : 0;
    const hm = /h=(\d+)/.exec(hash)?.[1];
    mount(root, 900, hm ? parseInt(hm, 10) : 470, hash.includes("dark"), page);
}
