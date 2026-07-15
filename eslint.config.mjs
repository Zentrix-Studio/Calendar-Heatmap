import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        // Only build output is ignored — never source. harness/*.js are deleted +
        // gitignored esbuild bundles (regenerate with `npm run harness`); listing
        // them here keeps the lint clean if someone regenerates them locally. All
        // real source (src/**, harness/*.ts, test/**, configs) is linted.
        ignores: ["node_modules/**", "dist/**", ".vscode/**", ".tmp/**", "harness/*.js", "harness/*.png"],
    },
    {
        // Cert plugin rules guard SHIPPED visual source only. Harness files
        // (dev-only esbuild playground / screenshot tooling, never bundled into
        // the .pbiviz) and tests are not shipped, so the powerbi-visuals cert
        // rules (no-inner-outer-html, no-http-string, etc.) must not fire there.
        // That drift broke `eslint .` repeatedly (2026-06-27) and was being
        // patched pointwise; this scopes it once. Rule names are derived from the
        // plugin's own list so any newly-added cert rule auto-scopes too. General
        // lint (TS parsing, etc.) still applies to harness/test source.
        files: ["harness/**", "test/**"],
        rules: Object.fromEntries(
            Object.keys(powerbiVisualsConfigs.rules).map((name) => [
                `powerbi-visuals/${name}`,
                "off",
            ])
        ),
    },
    {
        // Token-drift prevention (Z-148, mirrors the Bullet Chart's hex-ban).
        // Banned: raw hex-color string literals. Code must import from
        // src/theme/zentrixTokens.ts instead.
        //
        // SCOPE IS DELIBERATELY NARROW — only the files this v1-GAPS slice
        // introduced or re-pointed to the token mirror:
        //   states.ts, tooltip.ts, and the new panel/rules/dayData modules.
        // The cell-COLOR-RAMP files (render/colors.ts, render/ramps.ts) are
        // INTENTIONALLY EXCLUDED: the RdBu→canonical ramp reconciliation is
        // DEFERRED (CEO 2026-06-07) and those palette tables are not touched
        // this slice. Widen this glob to all of src/render/** only when the
        // ramp reconciliation is scoped.
        files: [
            "src/render/states.ts",
            "src/interaction/tooltip.ts",
            "src/interaction/dayData.ts",
            "src/interaction/detailPanel.ts",
            "src/render/rules.ts",
            "src/render/patterns.ts",
            // Z-152 — the annotation layer + editor. Every default color they draw
            // must come from the token mirror; a note the author never styled has to
            // stay on-brand in both themes, which only holds if the fallbacks are tokens.
            "src/render/annotations.ts",
            "src/interaction/noteEditor.ts",
        ],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    // Match hex literals: #RGB, #RRGGBB, #RRGGBBAA (3/4/6/8 hex chars)
                    selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
                    message:
                        "Raw hex color literals are banned in this file (Z-148). " +
                        "Import the value from src/theme/zentrixTokens.ts instead.",
                },
            ],
        },
    },
];