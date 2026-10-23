const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CACHE_FORMAT_VERSION,
  evaluateCache,
  fingerprintInputs,
  getGenerationCleanupDirectory,
  getCachePaths,
  readJsonIfPresent,
  writeJsonAtomic,
} = require('./openapi-generation-cache');
const { resolveGeneratedRoot } = require('./generated-root');
const { resolveOpenapiRoot } = require('./openapi-root');

const [generatorKey, surface, ...options] = process.argv.slice(2);
if (!generatorKey || !surface) {
  throw new Error(
    'Usage: node scripts/generate-openapi-models.js <generator-key> <surface> [--cache] [--force]',
  );
}
const cacheEnabled = options.includes('--cache');
const forceGeneration =
  options.includes('--force') ||
  ['1', 'true'].includes(
    String(process.env.HEY_HEY_FORCE_OPENAPI_GENERATION).toLowerCase(),
  );

const openapiRoot = resolveOpenapiRoot();

const config = JSON.parse(
  fs.readFileSync(path.resolve('openapitools.json'), 'utf8'),
);
const generator = config['generator-cli'].generators[generatorKey];
if (!generator) {
  throw new Error(`Unknown OpenAPI generator key ${generatorKey}.`);
}
generator.inputSpec = path.join(openapiRoot, `specs/${surface}/openapi.yaml`);
if (process.env.HEY_HEY_GENERATED_ROOT) {
  const configuredOutput = path.resolve(generator.output);
  const defaultGeneratedRoot = path.resolve('src/generated');
  const relativeOutput = path.relative(defaultGeneratedRoot, configuredOutput);
  if (relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
    throw new Error(
      `Generator ${generatorKey} output is outside src/generated and cannot be staged.`,
    );
  }
  generator.output = path.join(resolveGeneratedRoot(), relativeOutput);
}

const generatedModelDirectory = path.resolve(
  generator.output,
  generator.generatorName === 'typescript-nestjs' ? 'model' : 'models',
);
const generatorOutputDirectory = path.resolve(generator.output);
const projectRoot = path.resolve(__dirname, '..');

if (cacheEnabled) {
  const cachePaths = getCachePaths(projectRoot, generatorKey);
  const originalGenerator = JSON.parse(
    fs.readFileSync(path.resolve('openapitools.json'), 'utf8'),
  )['generator-cli'].generators[generatorKey];
  const input = fingerprintInputs({
    projectRoot,
    openapiRoot,
    entryPath: generator.inputSpec,
    generatorKey,
    surface,
    generatorConfig: originalGenerator,
  });

  if (input.cacheable) {
    const decision = evaluateCache({
      manifest: readJsonIfPresent(cachePaths.manifestPath),
      inputFingerprint: input.fingerprint,
      outputDirectory: generatedModelDirectory,
      force: forceGeneration,
    });
    writeJsonAtomic(cachePaths.pendingPath, {
      cacheFormatVersion: CACHE_FORMAT_VERSION,
      inputFingerprint: input.fingerprint,
    });
    if (decision.hit) {
      console.log(
        `OpenAPI model cache hit for ${generatorKey}; skipping OpenAPI Generator.`,
      );
      process.exit(0);
    }
    console.log(
      `OpenAPI model cache miss for ${generatorKey}: ${decision.reason}.`,
    );
  } else {
    console.log(`OpenAPI model cache disabled: ${input.reason}`);
  }
}

fs.rmSync(
  getGenerationCleanupDirectory({
    cacheEnabled,
    generatorOutputDirectory,
    generatedModelDirectory,
  }),
  { recursive: true, force: true },
);

const temporaryConfigDirectory = path.join(
  projectRoot,
  '.tmp',
  'openapi-generation-config',
);
fs.mkdirSync(temporaryConfigDirectory, { recursive: true });
const temporaryConfig = path.join(
  temporaryConfigDirectory,
  `openapitools-${process.pid}.json`,
);
fs.writeFileSync(temporaryConfig, JSON.stringify(config, null, 2));
try {
  const result = spawnSync(
    'openapi-generator-cli',
    [
      'generate',
      '--generator-key',
      generatorKey,
      '--openapitools',
      temporaryConfig,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
} finally {
  fs.rmSync(temporaryConfig, { force: true });
}
