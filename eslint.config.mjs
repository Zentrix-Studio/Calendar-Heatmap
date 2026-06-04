import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        // Only build output is ignored — never source. harness/*.js are deleted +
        // gitignored esbuild bundles (regenerate with `npm run harness`); listing
        // them here keeps the lint clean if someone regenerates them locally. All
        // real source (src/**, harness/*.ts, test/**, configs) is linted.
        ignores: ["node_modules/**", "dist/**", ".vscode/**", ".tmp/**", "harness/*.js", "harness/*.png",
            // Generated esbuild bundle for the automated visual-test harness (regenerate
            // with `npm run autotest`). Bundles third-party code that trips the shipped-
            // visual rules; the harness *source* (autotest/*.ts, *.mjs) is still linted.
            "autotest/bundle.js", "autotest/out/**"],
    },
];