import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const {
  resolveSource,
  requiredFiles,
  prepareEmbeddings,
} = require('../../../scripts/migration-stack-sources.js');

describe('remote migration stack source selection', () => {
  let temp: string;
  let root: string;
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  const write = (relative: string, content = 'fixture') => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  beforeEach(() => {
    const tmpRoot = path.resolve(__dirname, '../../../.tmp');
    fs.mkdirSync(tmpRoot, { recursive: true });
    temp = fs.mkdtempSync(path.join(tmpRoot, 'stack-sources-'));
    root = path.join(temp, 'repository with spaces');
    fs.mkdirSync(root);
    git('init', '-b', 'dev');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    for (const file of new Set<string>(
      Object.values(requiredFiles).flat() as string[],
    ))
      write(file);
    git('add', '.');
    git('commit', '-m', 'baseline');
  });
  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

  it('keeps development working files for all six repositories', () => {
    write('local-edit', 'uncommitted');
    for (const name of Object.keys(requiredFiles)) {
      expect(resolveSource(name, root, '', temp)).toMatchObject({
        path: fs.realpathSync(root),
        revision: git('rev-parse', 'HEAD'),
        dirty: true,
        reason: 'development checkout',
        baseline: null,
      });
    }
  });

  it('selects registered linked worktrees by directory name including dirty files', () => {
    const linked = path.join(temp, 'migration-one');
    git('worktree', 'add', '-b', 'different-branch-name', linked);
    fs.writeFileSync(path.join(linked, 'Dockerfile'), 'edited');
    expect(resolveSource('api', root, 'migration-one', temp)).toMatchObject({
      path: fs.realpathSync(linked),
      dirty: true,
      baseline: null,
    });
  });

  it('prefers origin/dev over local dev and arbitrary HEAD without copying dirty files', () => {
    const baseline = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/dev', baseline);
    write('Dockerfile', 'new local dev');
    git('commit', '-am', 'local dev');
    write('local-edit');
    const result = resolveSource('api', root, 'missing', temp);
    expect(result).toMatchObject({
      revision: baseline,
      dirty: false,
      baseline: 'refs/remotes/origin/dev',
    });
    expect(fs.readFileSync(path.join(result.path, 'Dockerfile'), 'utf8')).toBe(
      'fixture',
    );
    expect(fs.existsSync(path.join(result.path, 'local-edit'))).toBe(false);
  });

  it('uses local dev when origin/dev is absent and origin/master for OpenAPI', () => {
    expect(resolveSource('graphs', root, 'missing', temp).baseline).toBe(
      'refs/heads/dev',
    );
    expect(() => resolveSource('openapi', root, 'missing', temp)).toThrow(
      'no allowed baseline',
    );
    git('update-ref', 'refs/remotes/origin/master', 'HEAD');
    expect(resolveSource('openapi', root, 'missing', temp).baseline).toBe(
      'refs/remotes/origin/master',
    );
  });

  it('rejects arbitrary branches and malformed matches instead of falling back', () => {
    git('branch', '-m', 'arbitrary');
    expect(() => resolveSource('api', root, 'missing', temp)).toThrow(
      'no allowed baseline',
    );
    git('branch', 'dev');
    const linked = path.join(temp, 'migration-one');
    git('worktree', 'add', '--detach', linked);
    fs.unlinkSync(path.join(linked, 'Dockerfile'));
    expect(() => resolveSource('api', root, 'migration-one', temp)).toThrow(
      'required local source file',
    );
    fs.rmSync(linked, { recursive: true });
    expect(() => resolveSource('api', root, 'migration-one', temp)).toThrow();
  });

  it('generates absent baseline packages from selected specs without touching local packages', () => {
    write(
      'scripts/generate_openapi_models.sh',
      `set -eu
mkdir -p "$2"
cat "$1" > "$2/setup.py"
printf '%s' "$OPENAPI_PACKAGE_NAME" > "$2/package-name"
test -z "\${OPENAPI_SPEC:-}"
test -z "\${OPENAPI_OUTPUT_DIR:-}"
test -f "$OPENAPI_GENERATOR_CLI_CONFIG"
cp "$OPENAPI_GENERATOR_CLI_CONFIG" "$2/cli-config.json"
`,
    );
    git('commit', '-am', 'generator');
    write('generated/openapi-models/setup.py', 'local package');
    const embeddings = resolveSource('embeddings', root, 'missing', temp);
    expect(fs.existsSync(path.join(embeddings.path, 'generated'))).toBe(false);
    write('specs/embeddings/openapi.yaml', 'selected embeddings spec');
    write('specs/api/openapi.yaml', 'selected API spec');
    const openapi = resolveSource('openapi', root, '', temp);
    const previousSpec = process.env.OPENAPI_SPEC;
    const previousOutput = process.env.OPENAPI_OUTPUT_DIR;
    process.env.OPENAPI_SPEC = '/wrong/spec';
    process.env.OPENAPI_OUTPUT_DIR = '/wrong/output';
    let output: string;
    try {
      output = prepareEmbeddings([embeddings, openapi], temp);
    } finally {
      if (previousSpec === undefined) delete process.env.OPENAPI_SPEC;
      else process.env.OPENAPI_SPEC = previousSpec;
      if (previousOutput === undefined) delete process.env.OPENAPI_OUTPUT_DIR;
      else process.env.OPENAPI_OUTPUT_DIR = previousOutput;
    }
    expect(
      fs.readFileSync(path.join(output, 'openapi-models/setup.py'), 'utf8'),
    ).toBe('selected embeddings spec');
    expect(
      fs.readFileSync(
        path.join(output, 'openapi-events-models/setup.py'),
        'utf8',
      ),
    ).toBe('selected API spec');
    expect(
      fs.readFileSync(
        path.join(output, 'openapi-events-models/package-name'),
        'utf8',
      ),
    ).toBe('hey_hey_events_models');
    expect(
      fs.readFileSync(
        path.join(root, 'generated/openapi-models/setup.py'),
        'utf8',
      ),
    ).toBe('local package');
    expect(fs.existsSync(path.join(embeddings.path, 'generated'))).toBe(false);
    for (const directory of ['openapi-models', 'openapi-events-models']) {
      expect(
        JSON.parse(
          fs.readFileSync(
            path.join(output, directory, 'cli-config.json'),
            'utf8',
          ),
        ),
      ).toEqual({ 'generator-cli': {} });
    }
  });

  it('stops preparation when generation fails or omits the installable package', () => {
    const sources = ['embeddings', 'openapi'].map((name) =>
      resolveSource(name, root, '', temp),
    );
    write('scripts/generate_openapi_models.sh', 'exit 9');
    expect(() => prepareEmbeddings(sources, temp)).toThrow();
    write('scripts/generate_openapi_models.sh', 'exit 0');
    expect(() => prepareEmbeddings(sources, temp)).toThrow(
      'generation did not produce',
    );
  });
});
