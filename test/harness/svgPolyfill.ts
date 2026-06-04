/*
 * jsdom has no SVG layout engine, so geometry methods are undefined and throw
 * ("not implemented"). The Zentrix *render* path computes its layout
 * mathematically (no getBBox), but the in-visual overlay + tooltip do call these
 * on hover/mount — so we stub them to harmless values. The stubs never feed grid
 * geometry, so fake boxes don't distort what we're testing.
 *
 * Import this once at the top of any jsdom test that mounts the real Visual.
 */
const proto: any = (globalThis as any).SVGElement && (globalThis as any).SVGElement.prototype;
if (proto) {
    if (!proto.getBBox) proto.getBBox = function () { return { x: 0, y: 0, width: 0, height: 0 }; };
    if (!proto.getComputedTextLength) proto.getComputedTextLength = function (this: any) {
        return ((this.textContent as string) || "").length * 6;
    };
    if (!proto.getCTM) proto.getCTM = function () { return null; };
    if (!proto.getScreenCTM) proto.getScreenCTM = function () { return null; };
    if (!proto.createSVGPoint) proto.createSVGPoint = function () {
        return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) };
    };
}
export {};
