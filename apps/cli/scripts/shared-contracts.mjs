import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The CLI declares no local package dependencies, so @hey-hey/contracts is
// resolved straight from the built contracts package. The build bundles it
// and Vitest loads it through the same mapping.
const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsRoot = path.join(cliRoot, '../../packages/contracts/dist/esm');
const generatedRoot = path.join(contractsRoot, 'generated');

export const SHARED_CONTRACTS_PATTERN = /^@hey-hey\/contracts(?:\/.*)?$/;

export function resolveSharedContract(specifier) {
  const subpath = specifier.slice('@hey-hey/contracts'.length).replace(/^\//, '');

  if (subpath === '') {
    return path.join(contractsRoot, 'index.js');
  }
  if (subpath === 'brands') {
    return path.join(contractsRoot, 'brands.js');
  }
  if (subpath === 'agent-bridge/runtime-schema') {
    return path.join(generatedRoot, 'agent-bridge/repository-feature-enrichment-runtime-schema.js');
  }

  const generatedModule = path.join(generatedRoot, subpath);
  const moduleFile = `${generatedModule}.js`;
  if (existsSync(moduleFile)) {
    return moduleFile;
  }

  const indexFile = path.join(generatedModule, 'index.js');
  if (existsSync(indexFile)) {
    return indexFile;
  }

  throw new Error(`Shared contract module not found: ${specifier}`);
}
