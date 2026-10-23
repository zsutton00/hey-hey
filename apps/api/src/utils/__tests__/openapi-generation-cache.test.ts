import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  CACHE_FORMAT_VERSION,
  evaluateCache,
  fingerprintDirectory,
  fingerprintInputs,
  getGenerationCleanupDirectory,
} = require('../../../scripts/openapi-generation-cache');

describe('OpenAPI generation cache', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openapi-generation-cache-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const createContract = () => {
    const openapiRoot = join(root, 'openapi');
    const apiDirectory = join(openapiRoot, 'specs', 'api');
    const schemasDirectory = join(openapiRoot, 'specs', 'schemas');
    mkdirSync(apiDirectory, { recursive: true });
    mkdirSync(schemasDirectory, { recursive: true });
    const entryPath = join(apiDirectory, 'openapi.yaml');
    writeFileSync(
      entryPath,
      [
        'openapi: 3.0.0',
        'info: { title: Test, version: 1.0.0 }',
        'paths: {}',
        'components:',
        '  schemas:',
        '    Example:',
        '      $ref: ../schemas/example.yaml#/Example',
      ].join('\n'),
    );
    writeFileSync(
      join(schemasDirectory, 'example.yaml'),
      ['Example:', '  $ref: ./shared.yaml#/Shared'].join('\n'),
    );
    writeFileSync(
      join(schemasDirectory, 'shared.yaml'),
      [
        'Shared:',
        '  type: object',
        '  properties:',
        '    id: { type: string }',
      ].join('\n'),
    );
    return { openapiRoot, entryPath, schemasDirectory };
  };

  it('fingerprints the transitive local reference graph', () => {
    const { openapiRoot, entryPath, schemasDirectory } = createContract();
    const dependencyPath = join(root, 'dependency.js');
    writeFileSync(dependencyPath, 'dependency-v1');

    const options = {
      projectRoot: root,
      openapiRoot,
      entryPath,
      generatorKey: 'api-models',
      surface: 'api',
      generatorConfig: { generatorName: 'typescript-nestjs' },
      dependencyPaths: ['dependency.js'],
    };
    const initial = fingerprintInputs(options);
    expect(initial.cacheable).toBe(true);
    expect(initial.documentCount).toBe(3);

    writeFileSync(
      join(schemasDirectory, 'shared.yaml'),
      [
        'Shared:',
        '  type: object',
        '  properties:',
        '    id: { type: integer }',
      ].join('\n'),
    );
    const changed = fingerprintInputs(options);
    expect(changed.fingerprint).not.toBe(initial.fingerprint);
  });

  it('disables caching for remote references', () => {
    const { openapiRoot, entryPath } = createContract();
    writeFileSync(
      entryPath,
      [
        'openapi: 3.0.0',
        'info: { title: Test, version: 1.0.0 }',
        'paths: {}',
        'components:',
        '  schemas:',
        '    Remote:',
        '      $ref: https://example.com/schema.yaml#/Remote',
      ].join('\n'),
    );
    writeFileSync(join(root, 'dependency.js'), 'dependency-v1');

    const result = fingerprintInputs({
      projectRoot: root,
      openapiRoot,
      entryPath,
      generatorKey: 'api-models',
      surface: 'api',
      generatorConfig: {},
      dependencyPaths: ['dependency.js'],
    });
    expect(result.cacheable).toBe(false);
    expect(result.reason).toContain('remote OpenAPI references');
  });

  it('requires both matching inputs and unchanged generated output', () => {
    const outputDirectory = join(root, 'model');
    mkdirSync(outputDirectory);
    writeFileSync(
      join(outputDirectory, 'example.ts'),
      'export type Example = string;',
    );
    const outputFingerprint = fingerprintDirectory(outputDirectory);
    const manifest = {
      cacheFormatVersion: CACHE_FORMAT_VERSION,
      inputFingerprint: 'input-v1',
      outputFingerprint,
    };

    expect(
      evaluateCache({
        manifest,
        inputFingerprint: 'input-v1',
        outputDirectory,
        force: false,
      }).hit,
    ).toBe(true);

    writeFileSync(
      join(outputDirectory, 'example.ts'),
      'export type Example = number;',
    );
    expect(
      evaluateCache({
        manifest,
        inputFingerprint: 'input-v1',
        outputDirectory,
        force: false,
      }),
    ).toMatchObject({ hit: false, reason: 'generated model output changed' });
  });

  it('honors forced generation', () => {
    expect(
      evaluateCache({
        manifest: null,
        inputFingerprint: 'input-v1',
        outputDirectory: join(root, 'missing'),
        force: true,
      }),
    ).toEqual({ hit: false, reason: 'generation was forced' });
  });

  it('preserves cached API output until after the cache check', () => {
    const generatorOutputDirectory = join(root, 'generated');
    const generatedModelDirectory = join(generatorOutputDirectory, 'model');

    expect(
      getGenerationCleanupDirectory({
        cacheEnabled: true,
        generatorOutputDirectory,
        generatedModelDirectory,
      }),
    ).toBe(generatedModelDirectory);
    expect(
      getGenerationCleanupDirectory({
        cacheEnabled: false,
        generatorOutputDirectory,
        generatedModelDirectory,
      }),
    ).toBe(generatorOutputDirectory);
  });

  it('does not delete generated output before running the cached API generator', () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    );

    expect(packageJson.scripts['generate:all']).not.toContain(
      'rm -rf src/generated',
    );
    expect(packageJson.scripts['generate:api:unlocked']).toBe(
      'node scripts/generate-api-atomically.js',
    );

    const atomicGenerator = readFileSync(
      join(__dirname, '../../../scripts/generate-api-atomically.js'),
      'utf8',
    );
    expect(atomicGenerator).toContain('HEY_HEY_GENERATED_ROOT');
    expect(atomicGenerator).toContain(
      'fs.renameSync(stagedGeneratedRoot, liveGeneratedRoot)',
    );
    expect(atomicGenerator).toContain(
      'fs.renameSync(backupGeneratedRoot, liveGeneratedRoot)',
    );
  });

  it('excludes generated outputs owned by other API surfaces from API post-processing', () => {
    const postProcessor = readFileSync(
      join(__dirname, '../../../scripts/post-process-generated-types.ts'),
      'utf8',
    );

    expect(postProcessor).toContain(
      "['agents', 'api', 'embeddings', 'graphs', 'local']",
    );
    expect(postProcessor).toContain('NON_API_GENERATED_DIRS.has');
    expect(postProcessor).toContain(
      'const result = processDirectory(GENERATED_DIR);',
    );
  });
});
