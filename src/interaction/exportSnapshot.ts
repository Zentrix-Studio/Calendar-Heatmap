"use strict";

/**
 * Raster snapshot of the live diagram, for the PDF export.
 *
 * There is deliberately no PNG output: Power BI's file-download API only accepts
 * .txt/.csv/.json/.tmplt/.xml/.pdf/.xlsx, so a raster file cannot be handed to the
 * user from inside a visual. The JPEG below exists solely to be embedded in the PDF.
 *
 * The calendar renders entirely into SVG (no canvas underlay, unlike the Network
 * Graph's large-graph mode), so this serializes the SVG layer and rasterizes it
 * over the surface background. Cert-safe: the only URL it ever loads is a
 * `data:image/svg+xml` built from our own serialized DOM — no network.
 */

import { bytesToBase64, utf8Bytes } from "./exportFiles";

export interface VisualSnapshot {
    jpegBase64: string;
    width: number;
    height: number;
}

function dataPart(url: string): string {
    const comma = url.indexOf(",");
    return comma >= 0 ? url.slice(comma + 1) : url;
}

function imageFromSvg(svg: SVGSVGElement): Promise<HTMLImageElement> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const width = Math.max(1, Math.round(svg.getBoundingClientRect().width || svg.clientWidth || 1));
    const height = Math.max(1, Math.round(svg.getBoundingClientRect().height || svg.clientHeight || 1));
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    clone.style.display = "block";
    const serialized = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;base64,${bytesToBase64(utf8Bytes(serialized))}`;

    return new Promise((resolve, reject) => {
        const img = document.createElement("img");
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("The visual snapshot could not be rasterized."));
        img.src = url;
    });
}

/**
 * Rasterize the current diagram. The 2× output is capped at 4096 px to stay below
 * the host download API's 30 MB limit.
 */
export async function captureVisualSnapshot(
    svg: SVGSVGElement,
    viewportWidth: number,
    viewportHeight: number,
    background: string,
): Promise<VisualSnapshot> {
    const width = Math.max(1, Math.round(viewportWidth));
    const height = Math.max(1, Math.round(viewportHeight));
    const scale = Math.min(2, 4096 / Math.max(width, height));
    const outW = Math.max(1, Math.round(width * scale));
    const outH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas export is unavailable in this host.");

    ctx.fillStyle = background || "#FFFFFF";
    ctx.fillRect(0, 0, outW, outH);
    const svgImage = await imageFromSvg(svg);
    ctx.drawImage(svgImage, 0, 0, outW, outH);

    return {
        jpegBase64: dataPart(canvas.toDataURL("image/jpeg", 0.92)),
        width: outW,
        height: outH,
    };
}

/** One printable table: its heading, the header row, and display-ready cells. */
export interface PrintTable {
    title: string;
    head: string[];
    rows: string[][];
    /** Columns to right-align (numbers). */
    numeric: boolean[];
}

export interface PrintStyle { bg: string; fg: string; muted: string; rule: string; font: string; }

/** A4 portrait at 2× (595 × 842 pt), so the table pages print crisply. */
export const PAGE_W = 1190;
export const PAGE_H = 1684;

/**
 * Draw the export tables as page images (zentrix-qa#5 / #15). The PDF used to print
 * them as raw CSV lines in a WinAnsi font: every non-Latin character became "?" and long
 * rows broke mid-number. Drawing with the browser's own text engine prints हिन्दी,
 * 日本語 and emoji exactly as the canvas does, and gives real columns (numbers right-
 * aligned, a rule under the header, the header repeated on every page). Cert-safe:
 * canvas only, no network, no font download.
 */
export function renderTablePages(tables: PrintTable[], style: PrintStyle): VisualSnapshot[] {
    const pages: VisualSnapshot[] = [];
    const margin = 72, rowH = 30, headH = 34, titleH = 54;
    const usableW = PAGE_W - margin * 2;
    for (const t of tables) {
        const cols = t.head.length;
        const measure = document.createElement("canvas").getContext("2d");
        if (!measure) throw new Error("Canvas export is unavailable in this host.");
        // Fit the columns: natural widths at 20px, then one shared scale so the widest
        // table still fits the page (text never runs into the next column).
        let size = 20;
        const natural = (fs: number): number[] => {
            const w: number[] = new Array(cols).fill(0);
            measure.font = `600 ${fs}px ${style.font}`;
            t.head.forEach((h, i) => { w[i] = Math.max(w[i], measure.measureText(h).width); });
            measure.font = `400 ${fs}px ${style.font}`;
            for (const r of t.rows) r.forEach((c, i) => { w[i] = Math.max(w[i], measure.measureText(c).width); });
            return w.map(x => x + fs * 1.4);
        };
        let widths = natural(size);
        const total = widths.reduce((a, b) => a + b, 0);
        if (total > usableW) { size = Math.max(11, Math.floor(size * usableW / total)); widths = natural(size); }
        const sum = widths.reduce((a, b) => a + b, 0);
        const scale = sum > usableW ? usableW / sum : 1;
        widths = widths.map(w => w * scale);
        const perPage = Math.max(1, Math.floor((PAGE_H - margin * 2 - titleH - headH) / rowH));
        for (let start = 0; start < Math.max(1, t.rows.length); start += perPage) {
            const canvas = document.createElement("canvas");
            canvas.width = PAGE_W; canvas.height = PAGE_H;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas export is unavailable in this host.");
            ctx.fillStyle = style.bg; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
            ctx.textBaseline = "middle";
            ctx.fillStyle = style.fg;
            ctx.font = `700 28px ${style.font}`;
            ctx.fillText(start ? `${t.title} (continued)` : t.title, margin, margin + 18);
            let y = margin + titleH;
            const drawRow = (cells: string[], weight: number, color: string): void => {
                ctx.font = `${weight} ${size}px ${style.font}`;
                ctx.fillStyle = color;
                let x = margin;
                cells.forEach((c, i) => {
                    const w = widths[i];
                    const pad = size * 0.7;
                    // Clip each cell to its column so an over-long label can't overprint.
                    ctx.save();
                    ctx.beginPath(); ctx.rect(x, y, w, rowH); ctx.clip();
                    ctx.textAlign = t.numeric[i] ? "right" : "left";
                    ctx.fillText(c, t.numeric[i] ? x + w - pad : x + pad / 2, y + rowH / 2);
                    ctx.restore();
                    x += w;
                });
            };
            drawRow(t.head, 600, style.muted);
            y += headH;
            ctx.fillStyle = style.rule; ctx.fillRect(margin, y - 4, usableW, 2);
            for (const r of t.rows.slice(start, start + perPage)) {
                drawRow(r, 400, style.fg);
                y += rowH;
            }
            pages.push({ jpegBase64: dataPart(canvas.toDataURL("image/jpeg", 0.9)), width: PAGE_W, height: PAGE_H });
        }
    }
    return pages;
}
