/** Jest config for pure-logic unit tests (no Power BI host needed). */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/test"],
    testMatch: ["**/*.test.ts"],
    transform: {
        // Also transpile .js so the ESM-only deps below (d3, formatting utils) become CJS.
        "^.+\\.[tj]s$": ["ts-jest", { tsconfig: { module: "commonjs", esModuleInterop: true, allowJs: true } }],
    },
    // d3 v7 and the powerbi formatting/tooltip utils ship ESM; transpile them
    // (everything else in node_modules stays ignored for speed).
    transformIgnorePatterns: [
        "node_modules/(?!(d3|d3-[^/]+|internmap|delaunator|robust-predicates|powerbi-visuals-utils-formattingmodel|powerbi-visuals-utils-tooltiputils)/)",
    ],
    // The visual imports a .less stylesheet; map it to a no-op stub in tests.
    moduleNameMapper: {
        "\\.(less|css|scss)$": "<rootDir>/test/harness/styleStub.js",
    },
};
