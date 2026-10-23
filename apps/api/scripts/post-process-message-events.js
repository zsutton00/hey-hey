#!/usr/bin/env node
/**
 * Ensures the message-event models can import our branded IDs by generating a
 * tiny barrel file that re-exports the root-level src/types.ts definitions.
 */
const fs = require('fs');
const path = require('path');
const { resolveGeneratedRoot } = require('./generated-root');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_TYPES = path.join(PROJECT_ROOT, 'src', 'types.ts');
const DEST_DIR = path.join(resolveGeneratedRoot(), 'message-events');
const DEST_FILE = path.join(DEST_DIR, 'types.ts');
const MODEL_DIR = path.join(DEST_DIR, 'model');

function ensureSourceExists() {
  if (!fs.existsSync(SOURCE_TYPES)) {
    throw new Error(`Cannot find ${SOURCE_TYPES}`);
  }
}

function writeBridgeFile() {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  const contents = "export * from '../../types';\n";
  fs.writeFileSync(DEST_FILE, contents, 'utf8');
  console.log(
    `Generated message-event type bridge at ${path.relative(PROJECT_ROOT, DEST_FILE)}`,
  );
}

function rewriteModelImports() {
  if (!fs.existsSync(MODEL_DIR)) {
    console.warn(
      `Model directory ${path.relative(PROJECT_ROOT, MODEL_DIR)} not found; skipping import rewrite.`,
    );
    return;
  }

  const files = fs
    .readdirSync(MODEL_DIR)
    .filter((file) => file.endsWith('.ts') || file.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(MODEL_DIR, file);
    const contents = fs.readFileSync(filePath, 'utf8');
    const updated = contents.replace(/'\.\.\/\.\.\/types'/g, "'../types'");
    if (updated !== contents) {
      fs.writeFileSync(filePath, updated, 'utf8');
    }
  }
}

function main() {
  ensureSourceExists();
  writeBridgeFile();
  rewriteModelImports();
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
