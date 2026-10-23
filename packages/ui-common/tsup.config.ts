import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    animations: "src/animations/index.ts",
    api: "src/api/index.ts",
    components: "src/components/index.ts",
    "agent-sessions-runtime": "src/components/AgentSession/runtime/index.ts",
    context: "src/contexts/index.ts",
    data: "src/data/index.ts",
    hooks: "src/hooks/index.ts",
    clients: "src/clients/index.ts",
    agents: "src/agents/index.ts",
    "agents-prompts": "src/agents/prompts.ts",
    services: "src/services/index.ts",
    i18n: "src/i18n/index.ts",
    utils: "src/utils/index.ts",
    permissions: "src/permissions/index.ts",
    "capability-catalog": "src/components/AgentSession/capabilityCatalog.ts",
  },
  format: ["esm", "cjs"],
  splitting: true,
  // Package type exports point directly at source entrypoints. Rolling the
  // entire project into declaration bundles duplicates type-checking and can
  // exhaust tsup's declaration worker on constrained build agents.
  dts: process.env.UI_COMMON_BUILD_DTS === "true",
  sourcemap: "inline",
  clean: true,
  target: "es2019",
  outDir: "dist",
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".mjs" : ".cjs",
    };
  },
  esbuildOptions(options) {
    // Inline imported .gif assets as base64 data URIs so the bundle stays a
    // self-contained drop-in with no separate asset files to ship.
    options.loader = {
      ...options.loader,
      ".gif": "dataurl",
    };
  },
  external: [
    "react",
    "react-dom",
    "@mui/material",
    "@mui/icons-material",
    "@emotion/react",
    "@emotion/styled",
    "@tanstack/react-query",
    "react-router-dom",
    "i18next",
    "react-i18next",
    "jotai",
    "jotai/utils",
    "@puckeditor/core",
    "@puckeditor/core/puck.css",
  ],
  tsconfig: "./tsconfig.json",
});
