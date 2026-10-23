#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 6144;
const rawMaxOldSpaceSize = process.env.UI_COMMON_BUILD_MAX_OLD_SPACE_SIZE;

if (
  rawMaxOldSpaceSize !== undefined &&
  (!/^\d+$/.test(rawMaxOldSpaceSize) || Number(rawMaxOldSpaceSize) <= 0)
) {
  console.error(
    "[build] UI_COMMON_BUILD_MAX_OLD_SPACE_SIZE must be a positive integer (MB)."
  );
  process.exit(1);
}

const maxOldSpaceSizeMb = rawMaxOldSpaceSize
  ? Number(rawMaxOldSpaceSize)
  : DEFAULT_MAX_OLD_SPACE_SIZE_MB;
const nodeHeapOption = `--max-old-space-size=${maxOldSpaceSizeMb}`;
const nodeOptions = [process.env.NODE_OPTIONS, nodeHeapOption]
  .filter(Boolean)
  .join(" ");

const result = spawnSync("pnpm", ["exec", "tsup"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

if (result.error) {
  console.error(`[build] Failed to start tsup: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
