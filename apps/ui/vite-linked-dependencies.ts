import path from "node:path";

export const createUiCommonPuckIntegration = (uiCommonPackageRoot: string) => ({
  // The UI consumes ui-common source directly. Resolve and pre-bundle Puck
  // from that linked package before the editor route is opened so Vite does
  // not invalidate dependency URLs during lazy discovery.
  alias: {
    find: /^@puckeditor\/core$/,
    replacement: path.resolve(
      uiCommonPackageRoot,
      "node_modules/@puckeditor/core/dist/index.mjs",
    ),
  },
  optimizeDepsInclude: ["@puckeditor/core"] as const,
});
