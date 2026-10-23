const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const yaml = require('js-yaml');

const CACHE_FORMAT_VERSION = 1;
const CACHE_DIRECTORY = path.join('.tmp', 'openapi-generation-cache');
const API_GENERATION_DEPENDENCIES = [
  'openapitools.json',
  'scripts/generate-api-atomically.js',
  'scripts/generated-root.js',
  'scripts/generate-openapi-models.js',
  'scripts/openapi-generation-cache.js',
  'scripts/generate-task-monitor-schema.js',
  'scripts/generate-project-mode-schema.js',
  'scripts/generate-private-beta-access-schema.js',
  'scripts/generate-workflow-review-schemas.js',
  'scripts/generate-diagram-schemas.js',
  'scripts/generate-entity-prompt-template-language.js',
  'scripts/post-process-message-events.js',
  'scripts/generate-models-barrel.js',
  'scripts/post-process-generated-types.ts',
  'scripts/generate-path-constants.js',
];

const hashParts = (parts) => {
  const hash = crypto.createHash('sha256');
  for (const part of parts) {
    hash.update(String(Buffer.byteLength(part)));
    hash.update(':');
    hash.update(part);
  }
  return hash.digest('hex');
};

const visitReferences = (value, references) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      visitReferences(entry, references);
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  if (typeof value.$ref === 'string') {
    references.push(value.$ref);
  }
  for (const entry of Object.values(value)) {
    visitReferences(entry, references);
  }
};

const resolveReferencePath = (reference, sourcePath) => {
  const referencePath = reference.split('#', 1)[0];
  if (!referencePath) {
    return { kind: 'internal' };
  }

  if (referencePath.startsWith('file:')) {
    return { kind: 'local', path: fileURLToPath(referencePath) };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(referencePath)) {
    return { kind: 'remote', reference: referencePath };
  }

  return {
    kind: 'local',
    path: path.resolve(
      path.dirname(sourcePath),
      decodeURIComponent(referencePath),
    ),
  };
};

const collectReferencedDocuments = (entryPath) => {
  const documents = new Map();
  const remoteReferences = new Set();
  const pending = [path.resolve(entryPath)];

  while (pending.length > 0) {
    const documentPath = pending.pop();
    const realPath = fs.realpathSync(documentPath);
    if (documents.has(realPath)) {
      continue;
    }

    const contents = fs.readFileSync(realPath, 'utf8');
    documents.set(realPath, contents);
    const parsed = yaml.load(contents);
    const references = [];
    visitReferences(parsed, references);

    for (const reference of references) {
      const resolved = resolveReferencePath(reference, realPath);
      if (resolved.kind === 'local') {
        pending.push(resolved.path);
      } else if (resolved.kind === 'remote') {
        remoteReferences.add(resolved.reference);
      }
    }
  }

  return { documents, remoteReferences };
};

const listFiles = (rootPath) => {
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const files = [];
  const pending = [path.resolve(rootPath)];
  while (pending.length > 0) {
    const currentPath = pending.pop();
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
};

const fingerprintDirectory = (rootPath) => {
  const resolvedRoot = path.resolve(rootPath);
  const files = listFiles(resolvedRoot);
  if (files.length === 0) {
    return null;
  }

  const parts = [`directory:${files.length}`];
  for (const filePath of files) {
    parts.push(path.relative(resolvedRoot, filePath));
    parts.push(fs.readFileSync(filePath));
  }
  return hashParts(parts);
};

const getGenerationCleanupDirectory = ({
  cacheEnabled,
  generatorOutputDirectory,
  generatedModelDirectory,
}) => (cacheEnabled ? generatedModelDirectory : generatorOutputDirectory);

const fingerprintInputs = ({
  projectRoot,
  openapiRoot,
  entryPath,
  generatorKey,
  surface,
  generatorConfig,
  dependencyPaths = API_GENERATION_DEPENDENCIES,
}) => {
  const { documents, remoteReferences } = collectReferencedDocuments(entryPath);
  if (remoteReferences.size > 0) {
    return {
      cacheable: false,
      reason: `remote OpenAPI references cannot be fingerprinted safely: ${[
        ...remoteReferences,
      ].join(', ')}`,
    };
  }

  const parts = [
    `cache-format:${CACHE_FORMAT_VERSION}`,
    `generator-key:${generatorKey}`,
    `surface:${surface}`,
    JSON.stringify(generatorConfig),
  ];
  const resolvedOpenapiRoot = fs.realpathSync(openapiRoot);
  for (const [documentPath, contents] of [...documents.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    parts.push(path.relative(resolvedOpenapiRoot, documentPath));
    parts.push(contents);
  }

  for (const dependencyPath of dependencyPaths) {
    const resolvedPath = path.resolve(projectRoot, dependencyPath);
    parts.push(dependencyPath);
    parts.push(fs.readFileSync(resolvedPath));
  }

  return {
    cacheable: true,
    fingerprint: hashParts(parts),
    documentCount: documents.size,
  };
};

const getCachePaths = (projectRoot, generatorKey) => {
  const cacheRoot = path.resolve(projectRoot, CACHE_DIRECTORY);
  return {
    cacheRoot,
    manifestPath: path.join(cacheRoot, `${generatorKey}.json`),
    pendingPath: path.join(cacheRoot, `${generatorKey}.pending.json`),
  };
};

const readJsonIfPresent = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    return null;
  }
};

const writeJsonAtomic = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
};

const evaluateCache = ({
  manifest,
  inputFingerprint,
  outputDirectory,
  force,
}) => {
  if (force) {
    return { hit: false, reason: 'generation was forced' };
  }
  if (!manifest) {
    return { hit: false, reason: 'no cache manifest exists' };
  }
  if (manifest.cacheFormatVersion !== CACHE_FORMAT_VERSION) {
    return { hit: false, reason: 'cache format changed' };
  }
  if (manifest.inputFingerprint !== inputFingerprint) {
    return { hit: false, reason: 'OpenAPI generation inputs changed' };
  }

  const outputFingerprint = fingerprintDirectory(outputDirectory);
  if (!outputFingerprint) {
    return { hit: false, reason: 'generated model output is missing' };
  }
  if (manifest.outputFingerprint !== outputFingerprint) {
    return { hit: false, reason: 'generated model output changed' };
  }
  return { hit: true, outputFingerprint };
};

module.exports = {
  API_GENERATION_DEPENDENCIES,
  CACHE_FORMAT_VERSION,
  collectReferencedDocuments,
  evaluateCache,
  fingerprintDirectory,
  fingerprintInputs,
  getGenerationCleanupDirectory,
  getCachePaths,
  readJsonIfPresent,
  writeJsonAtomic,
};
