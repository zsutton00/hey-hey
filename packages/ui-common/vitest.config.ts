import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
    alias: {
      "@hey-hey/ui-common": path.resolve(__dirname, "src"),
      "@mui/system": path.resolve(
        __dirname,
        "src/test/__mocks__/muiSystemMock.ts",
      ),
      "react-markdown": path.resolve(
        __dirname,
        "src/test/__mocks__/reactMarkdownMock.tsx",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    exclude: [
      "apps/**",
      ".tmp/**",
      ".tsbuild/**",
      ".worktrees/**",
      "node_modules",
    ],
    testTimeout: 20000,
    hookTimeout: 20000,
    teardownTimeout: 10000,
    maxWorkers: 4,
    // Each test file runs in a forked child process. Cap its V8 heap so a
    // runaway test (render loop, unbounded mock data) dies with a heap OOM
    // that names the file, instead of growing to multiple GB and hanging.
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=1536"],
      },
    },
  },
});
