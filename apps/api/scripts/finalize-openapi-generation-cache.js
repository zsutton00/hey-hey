const fs = require('fs');
const path = require('path');

const {
  CACHE_FORMAT_VERSION,
  fingerprintDirectory,
  fingerprintInputs,
  getCachePaths,
  readJsonIfPresent,
  writeJsonAtomic,
} = require('./openapi-generation-cache');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');

const [generatorKey, surface] = process.argv.slice(2);
if (!generatorKey || !surface) {
  throw new Error(
    'Usage: node scripts/finalize-openapi-generation-cache.js <generator-key> <surface>',
  );
}

const projectRoot = path.resolve(__dirname, '..');
const openapiRoot = resolveOpenapiRoot();
const config = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'openapitools.json'), 'utf8'),
);
const generator = config['generator-cli'].generators[generatorKey];
if (!generator) {
  throw new Error(`Unknown OpenAPI generator key ${generatorKey}.`);
}

const entryPath = path.join(openapiRoot, `specs/${surface}/openapi.yaml`);
const input = fingerprintInputs({
  projectRoot,
  openapiRoot,
  entryPath,
  generatorKey,
  surface,
  generatorConfig: generator,
});
const cachePaths = getCachePaths(projectRoot, generatorKey);
const pending = readJsonIfPresent(cachePaths.pendingPath);

if (!input.cacheable) {
  fs.rmSync(cachePaths.pendingPath, { force: true });
  console.log(`OpenAPI generation cache disabled: ${input.reason}`);
  process.exit(0);
}
if (!pending) {
  throw new Error(`OpenAPI generation cache state is missing for ${generatorKey}.`);
}
if (pending.inputFingerprint !== input.fingerprint) {
  throw new Error(
    'OpenAPI generation inputs changed while generation was running. Rerun generate:api.',
  );
}

const configuredOutput = path.resolve(projectRoot, generator.output);
const defaultGeneratedRoot = path.resolve(projectRoot, 'src/generated');
const relativeOutput = path.relative(defaultGeneratedRoot, configuredOutput);
const generatorOutput = process.env.HEY_HEY_GENERATED_ROOT
  ? path.join(resolveGeneratedRoot(), relativeOutput)
  : configuredOutput;
const generatedModelDirectory = path.resolve(
  generatorOutput,
  generator.generatorName === 'typescript-nestjs' ? 'model' : 'models',
);
const outputFingerprint = fingerprintDirectory(generatedModelDirectory);
if (!outputFingerprint) {
  throw new Error(
    `Cannot cache OpenAPI generation because ${generatedModelDirectory} is empty.`,
  );
}

writeJsonAtomic(cachePaths.manifestPath, {
  cacheFormatVersion: CACHE_FORMAT_VERSION,
  generatorKey,
  surface,
  inputFingerprint: input.fingerprint,
  outputFingerprint,
  documentCount: input.documentCount,
  updatedAt: new Date().toISOString(),
});
fs.rmSync(cachePaths.pendingPath, { force: true });
console.log(
  `Updated OpenAPI generation cache for ${generatorKey} (${input.documentCount} contract documents).`,
);
