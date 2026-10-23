const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const requiredFiles = {
  api: [
    'Dockerfile',
    'package.json',
    'docker-compose.migration-stack.yml',
    'scripts/migration-stack.sh',
    'docker/migration-stack/embeddings.Dockerfile',
  ],
  graphs: ['pom.xml'],
  embeddings: [
    'requirements.txt',
    'constraints.txt',
    'scripts/generate_openapi_models.sh',
  ],
  ui: ['Dockerfile'],
  'ui-common': ['package.json'],
  openapi: [
    'specs/api/openapi.yaml',
    'specs/graphs/openapi.yaml',
    'specs/embeddings/openapi.yaml',
  ],
};
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
function resolveSource(name, root, worktree, scratch) {
  let source = fs.realpathSync(root);
  let reason = 'development checkout';
  let baseline = null;
  if (worktree) {
    const records = git(root, 'worktree', 'list', '--porcelain', '-z').split(
      '\0\0',
    );
    const matches = records
      .slice(1)
      .map((record) =>
        record.split('\0').find((field) => field.startsWith('worktree ')),
      )
      .filter(Boolean)
      .map((field) => field.slice(9))
      .filter((candidate) => path.basename(candidate) === worktree);
    if (matches.length > 1)
      throw new Error(`${name}: ambiguous registered worktree ${worktree}`);
    if (matches.length === 1) {
      source = fs.realpathSync(matches[0]);
      if (
        fs.realpathSync(git(source, 'rev-parse', '--show-toplevel')) !==
          source ||
        fs.realpathSync(
          git(
            source,
            'rev-parse',
            '--path-format=absolute',
            '--git-common-dir',
          ),
        ) !==
          fs.realpathSync(
            git(
              root,
              'rev-parse',
              '--path-format=absolute',
              '--git-common-dir',
            ),
          )
      ) {
        throw new Error(`${name}: malformed matching worktree ${source}`);
      }
      reason = `registered worktree ${worktree}`;
    } else {
      const refs =
        name === 'openapi'
          ? ['refs/remotes/origin/master']
          : ['refs/remotes/origin/dev', 'refs/heads/dev'];
      let revision;
      for (const ref of refs) {
        try {
          revision = git(root, 'rev-parse', '--verify', `${ref}^{commit}`);
          baseline = ref;
          break;
        } catch {}
      }
      if (!baseline)
        throw new Error(
          `${name}: no allowed baseline available (${refs.join(', ')})`,
        );
      source = path.join(scratch, name);
      git(
        root,
        'clone',
        '--quiet',
        '--shared',
        '--no-checkout',
        '--',
        fs.realpathSync(root),
        source,
      );
      git(source, 'checkout', '--quiet', '--detach', revision);
      reason = `baseline fallback: no registered worktree ${worktree}`;
    }
  }
  for (const file of requiredFiles[name]) {
    if (
      !fs.existsSync(path.join(source, file)) ||
      !fs.statSync(path.join(source, file)).isFile()
    ) {
      throw new Error(
        `${name}: required local source file is missing: ${path.join(source, file)}`,
      );
    }
  }
  return {
    name,
    path: source,
    revision: git(source, 'rev-parse', 'HEAD'),
    dirty: Boolean(
      git(source, 'status', '--porcelain', '--untracked-files=normal'),
    ),
    reason,
    baseline,
  };
}
function prepareEmbeddings(sources, scratch) {
  const embeddings = sources.find((source) => source.name === 'embeddings');
  const openapi = sources.find((source) => source.name === 'openapi');
  const generatedRoot = path.join(scratch, 'embeddings-generated');
  // Ignored packages may be absent or from another spec. Generate separately
  // to preserve working files while using exactly the selected sources.
  const generatorEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('OPENAPI_')),
  );
  for (const [directory, spec, packageName, projectName] of [
    [
      'openapi-models',
      'embeddings',
      'hey_hey_embeddings_models',
      'hey-hey-embeddings-models',
    ],
    [
      'openapi-events-models',
      'api',
      'hey_hey_events_models',
      'hey-hey-events-models',
    ],
  ]) {
    const output = path.join(generatedRoot, directory);
    // Supply a config even to older baseline scripts whose mktemp template
    // is incompatible with macOS. The launcher's scratch cleanup owns it.
    const cliConfig = path.join(scratch, `${directory}-openapitools.json`);
    fs.writeFileSync(cliConfig, JSON.stringify({ 'generator-cli': {} }), {
      mode: 0o600,
    });
    execFileSync(
      'bash',
      [
        path.join(embeddings.path, 'scripts/generate_openapi_models.sh'),
        path.join(openapi.path, 'specs', spec, 'openapi.yaml'),
        output,
      ],
      {
        cwd: embeddings.path,
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
          ...generatorEnv,
          HEY_HEY_OPENAPI_ROOT: openapi.path,
          OPENAPI_DISABLE_LOCAL_CLI: '1',
          OPENAPI_GENERATOR_CLI_CONFIG: cliConfig,
          OPENAPI_GENERATOR: 'python',
          OPENAPI_ADDITIONAL_PROPERTIES: 'useOneOfDiscriminatorLookup=true',
          OPENAPI_PACKAGE_NAME: packageName,
          OPENAPI_PROJECT_NAME: projectName,
        },
      },
    );
    if (!fs.existsSync(path.join(output, 'setup.py'))) {
      throw new Error(
        `embeddings: generation did not produce ${output}/setup.py`,
      );
    }
  }
  return generatedRoot;
}
module.exports = { resolveSource, requiredFiles, prepareEmbeddings };
if (require.main === module) {
  try {
    const [scratch, worktree, ...roots] = process.argv.slice(2);
    const sources = Object.keys(requiredFiles).map((name, index) =>
      resolveSource(name, roots[index], worktree, scratch),
    );
    for (const source of sources) console.error(JSON.stringify(source));
    prepareEmbeddings(sources, scratch);
    fs.writeFileSync(
      path.join(scratch, 'sources'),
      sources.map((source) => source.path).join('\0') + '\0',
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
