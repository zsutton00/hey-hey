/// <reference types="vitest" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { visualizer } from "rollup-plugin-visualizer";
import viteCompression from "vite-plugin-compression";
import path from "path";
import { createUiCommonPuckIntegration } from "./vite-linked-dependencies";

const uiCommonPackageRoot = path.resolve(__dirname, "../../packages/ui-common");
const uiCommonRoot = path.resolve(uiCommonPackageRoot, "src");
const uiCommonPuckIntegration =
  createUiCommonPuckIntegration(uiCommonPackageRoot);
const muiMaterialEsmRoot = path.resolve(
  __dirname,
  "./node_modules/@mui/material/esm",
);
const muiSystemEsmRoot = path.resolve(
  __dirname,
  "./node_modules/@mui/system/esm",
);
// Keep in sync with the "entry" object in packages/ui-common/tsup.config.ts
// and the "exports" field in packages/ui-common/package.json.
const uiCommonSourceAliases = [
  {
    find: /^@hey-hey\/ui-common$/,
    replacement: path.resolve(uiCommonRoot, "index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/animations$/,
    replacement: path.resolve(uiCommonRoot, "animations/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/api$/,
    replacement: path.resolve(uiCommonRoot, "api/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/components$/,
    replacement: path.resolve(uiCommonRoot, "components/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/components\/(.+)$/,
    replacement: path.resolve(uiCommonRoot, "components") + "/$1",
  },
  {
    find: /^@hey-hey\/ui-common\/agent-sessions-runtime$/,
    replacement: path.resolve(
      uiCommonRoot,
      "components/AgentSession/runtime/index.ts",
    ),
  },
  {
    find: /^@hey-hey\/ui-common\/context$/,
    replacement: path.resolve(uiCommonRoot, "contexts/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/data$/,
    replacement: path.resolve(uiCommonRoot, "data/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/hooks$/,
    replacement: path.resolve(uiCommonRoot, "hooks/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/clients$/,
    replacement: path.resolve(uiCommonRoot, "clients/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/agents$/,
    replacement: path.resolve(uiCommonRoot, "agents/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/agents-prompts$/,
    replacement: path.resolve(uiCommonRoot, "agents/prompts.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/services$/,
    replacement: path.resolve(uiCommonRoot, "services/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/services\/(.+)$/,
    replacement: path.resolve(uiCommonRoot, "services") + "/$1",
  },
  {
    find: /^@hey-hey\/ui-common\/i18n$/,
    replacement: path.resolve(uiCommonRoot, "i18n/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/utils$/,
    replacement: path.resolve(uiCommonRoot, "utils/index.ts"),
  },
  {
    find: /^@hey-hey\/ui-common\/feature-tree-visualization$/,
    replacement: path.resolve(
      uiCommonRoot,
      "components/Features/FeatureTreeVisualization.tsx",
    ),
  },
];

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "VITE_");
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:3000";

  return {
    plugins: [
      react(),
      process.env.ANALYZE === "true" &&
        visualizer({
          open: true,
          gzipSize: true,
          brotliSize: true,
          filename: "dist/stats.html",
        }),
      viteCompression({
        algorithm: "gzip",
        ext: ".gz",
        filter: /\.(js|mjs|json|css|html)$/i,
      }),
      viteCompression({
        algorithm: "brotliCompress",
        ext: ".br",
        filter: /\.(js|mjs|json|css|html)$/i,
      }),
    ],
    build: {
      sourcemap: true,
      modulePreload: {
        // diagram-vendor (mermaid + cytoscape + dagre, ~2.7 MB) is only
        // reachable via deeply-nested dynamic imports (e.g. SystemMessage ->
        // lazy MermaidCodeBlock -> import("mermaid")). Vite's default preload
        // graph traversal warms it up on every page load. Skip it so the
        // chunk only loads when a markdown block actually contains mermaid.
        resolveDependencies: (_filename, deps) =>
          deps.filter((dep) => !dep.includes("diagram-vendor")),
      },
      rollupOptions: {
        plugins: [
          {
            name: "trace-chunks",
            async generateBundle(_options, bundle) {
              const fs = await import("node:fs");
              const lines: string[] = [];
              for (const [fileName, chunk] of Object.entries(bundle)) {
                if (chunk.type === "chunk") {
                  lines.push(
                    `\n=== ${fileName} (${(chunk.code.length / 1024).toFixed(1)} KB) ===`,
                  );
                  for (const mod of Object.keys(chunk.modules).sort()) {
                    if (mod.includes("node_modules")) {
                      lines.push(`  ${mod}`);
                    }
                  }
                }
              }
              fs.writeFileSync("dist/chunk-manifest.txt", lines.join("\n"));
            },
          },
        ],
        output: {
          manualChunks(id) {
            // The entry uses this helper before choosing landing vs. app.
            // Letting a vendor chunk absorb it pulls that vendor into both.
            if (id.includes("vite/preload-helper")) {
              return "vite-runtime";
            }

            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/react-router/") ||
              id.includes("/node_modules/react-router-dom/") ||
              id.includes("/node_modules/scheduler/")
            ) {
              return "react-vendor";
            }

            if (
              id.includes("/node_modules/@mui/x-charts/") ||
              id.includes("/node_modules/@mui/x-date-pickers/") ||
              id.includes("/node_modules/@mui/x-internals/")
            ) {
              return "mui-x-vendor";
            }

            if (
              id.includes("/node_modules/@mui/") ||
              id.includes("/node_modules/@emotion/")
            ) {
              return "mui-vendor";
            }

            if (
              id.includes("/node_modules/motion/") ||
              id.includes("/node_modules/framer-motion/")
            ) {
              return "motion-vendor";
            }

            if (
              id.includes("/node_modules/@tanstack/") ||
              id.includes("/node_modules/jotai") ||
              id.includes("/node_modules/nuqs/")
            ) {
              return "data-vendor";
            }

            if (id.includes("/node_modules/axios/")) {
              return "api-vendor";
            }

            if (
              id.includes("/node_modules/mermaid/") ||
              id.includes("/node_modules/cytoscape/") ||
              id.includes("/node_modules/dagre/") ||
              id.includes("/node_modules/katex/")
            ) {
              return "diagram-vendor";
            }

            if (
              id.includes("/node_modules/@lexical/") ||
              id.includes("/node_modules/lexical/") ||
              id.includes("/node_modules/yjs/") ||
              id.includes("/node_modules/y-protocols/") ||
              id.includes("/node_modules/lib0/") ||
              id.includes("/node_modules/prismjs/")
            ) {
              return "editor-vendor";
            }

            if (
              id.includes("/node_modules/@dnd-kit/") ||
              id.includes("/node_modules/filepond/") ||
              id.includes("/node_modules/filepond-plugin-") ||
              id.includes("/node_modules/react-filepond/")
            ) {
              return "interaction-vendor";
            }
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ["jotai", "jotai/utils"],
      include: [...uiCommonPuckIntegration.optimizeDepsInclude],
    },
    ssr: {
      // Source-linked ui-common dependencies must be transformed in Vitest so
      // their React peer imports resolve through this app's aliases.
      noExternal: true,
    },
    server: {
      fs: {
        allow: [__dirname, uiCommonPackageRoot],
      },
      proxy: {
        // Proxy API requests to the backend server
        // Set VITE_API_PROXY_TARGET to point at a remote API (e.g. https://heyhey.dev)
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: true,
          configure: (proxy) => {
            // The backend only accepts browser-session changes (e.g. token
            // refresh) from an allowed origin, so present the target's own.
            const targetOrigin = new URL(apiProxyTarget).origin;
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("origin", targetOrigin);
            });
          },
        },
      },
    },
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "jotai",
        "react-hook-form",
        // ui-common's DndProvider/drag sources and this app's drop targets
        // must share one @dnd-kit/core, or they get separate React contexts
        // and drops silently never register.
        "@dnd-kit/core",
        "@mui/material",
        "@mui/system",
        "@mui/styles",
        "@mui/x-charts",
        "@mui/x-date-pickers",
        "@emotion/react",
        "@emotion/styled",
        "jotai",
      ],
      alias: [
        ...uiCommonSourceAliases,
        uiCommonPuckIntegration.alias,
        {
          // Keep MUI X's ESM entrypoints on MUI Material's ESM entrypoints.
          // Mixing the chart ESM build with Material's CJS subpaths makes
          // Vite's interop wrapper expose useMediaQuery.default as an object.
          find: /^@mui\/material$/,
          replacement: `${muiMaterialEsmRoot}/index.js`,
        },
        {
          find: /^@mui\/material\/(.+)$/,
          replacement: `${muiMaterialEsmRoot}/$1`,
        },
        {
          // MUI's ESM material entrypoints import system subpaths. Pin those
          // subpaths to the matching ESM files so Vite does not mix the ESM
          // material bundle with a CJS system default export.
          find: /^@mui\/system$/,
          replacement: `${muiSystemEsmRoot}/index.js`,
        },
        {
          find: /^@mui\/system\/(.+)$/,
          replacement: `${muiSystemEsmRoot}/$1/index.js`,
        },
        {
          // Force all React imports to use the ui project's version
          // This prevents multiple React instances when importing from ui-common
          find: "react",
          replacement: path.resolve(__dirname, "./node_modules/react"),
        },
        {
          find: "react-dom",
          replacement: path.resolve(__dirname, "./node_modules/react-dom"),
        },
        {
          find: /^jotai$/,
          replacement: path.resolve(
            __dirname,
            "./node_modules/jotai/esm/index.mjs",
          ),
        },
        {
          find: /^jotai\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/jotai/esm")}/$1`,
        },
        {
          find: /^react-hook-form$/,
          replacement: path.resolve(
            __dirname,
            "./node_modules/react-hook-form",
          ),
        },
        {
          find: /^motion$/,
          replacement: path.resolve(__dirname, "./node_modules/motion"),
        },
        {
          find: /^motion\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/motion")}/$1`,
        },
        {
          find: /^@mui\/styles$/,
          replacement: path.resolve(__dirname, "./node_modules/@mui/styles"),
        },
        {
          find: /^@mui\/styles\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/@mui/styles")}/$1`,
        },
        {
          find: /^@mui\/icons-material$/,
          replacement: path.resolve(
            __dirname,
            "./node_modules/@mui/icons-material",
          ),
        },
        {
          find: /^@mui\/icons-material\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/@mui/icons-material")}/$1`,
        },
        {
          find: /^@emotion\/react$/,
          replacement: path.resolve(__dirname, "./node_modules/@emotion/react"),
        },
        {
          find: /^@emotion\/react\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/@emotion/react")}/$1`,
        },
        {
          find: /^@emotion\/styled$/,
          replacement: path.resolve(
            __dirname,
            "./node_modules/@emotion/styled",
          ),
        },
        {
          find: /^@emotion\/styled\/(.+)$/,
          replacement: `${path.resolve(__dirname, "./node_modules/@emotion/styled")}/$1`,
        },
        {
          find: "@tanstack/react-query",
          replacement: path.resolve(
            __dirname,
            "./node_modules/@tanstack/react-query",
          ),
        },
        {
          find: "motion/react",
          replacement: path.resolve(
            __dirname,
            "./node_modules/motion/dist/es/react.mjs",
          ),
        },
        {
          find: "motion",
          replacement: path.resolve(__dirname, "./node_modules/motion"),
        },
        {
          find: "react-router-dom",
          replacement: path.resolve(
            __dirname,
            "./node_modules/react-router-dom",
          ),
        },
        {
          find: "react-i18next",
          replacement: path.resolve(__dirname, "./node_modules/react-i18next"),
        },
        {
          find: "i18next",
          replacement: path.resolve(__dirname, "./node_modules/i18next"),
        },
      ],
    },
    test: {
      server: { deps: { inline: [/@lexical\//, /@dnd-kit/] } },
      // Bundle the source-linked drag dependencies through the app's React
      // alias; their CommonJS builds otherwise load UI Common's React copy.
      deps: {
        optimizer: {
          web: {
            enabled: true,
            include: ["@dnd-kit/core", "@dnd-kit/utilities"],
          },
        },
      },
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      maxWorkers: 4,
      include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
      exclude: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/coverage/**",
      ],
    },
  };
});
