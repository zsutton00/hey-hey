const path = require('node:path');
const fs = require('node:fs');
const {
  canonicalPath,
  resolveSiblingRepository,
  resolveWorktreeContext,
} = require('./worktree-context.cjs');

const OPENAPI_SPEC = path.join('specs', 'api', 'openapi.yaml');

const resolveOpenapiContext = ({ cwd = process.cwd(), environment = process.env } = {}) => {
  const worktreeContext = resolveWorktreeContext(cwd, environment);
  const configuredRoot = environment.HEY_HEY_OPENAPI_ROOT?.trim();
  const openapiRoot = resolveSiblingRepository(worktreeContext, 'openapi', configuredRoot);
  const mainOpenapiRoot = canonicalPath(path.join(worktreeContext.repositoriesRoot, 'openapi'));
  const matchingOpenapiRoot = worktreeContext.workspaceId
    ? canonicalPath(path.join(mainOpenapiRoot, '.worktrees', worktreeContext.workspaceId))
    : null;
  const openapiSource = configuredRoot
    ? 'explicit_override'
    : matchingOpenapiRoot && openapiRoot === matchingOpenapiRoot
      ? 'matching_worktree'
      : 'main_checkout';

  if (!fs.existsSync(path.join(openapiRoot, OPENAPI_SPEC))) {
    throw new Error(
      `Unable to locate the OpenAPI repository at ${openapiRoot}. Set HEY_HEY_OPENAPI_ROOT to the pinned checkout.`,
    );
  }

  return {
    ...worktreeContext,
    openapiRoot,
    openapiSource,
  };
};

const printContext = (context) => {
  process.stdout.write(`${JSON.stringify(context, null, 2)}\n`);
};

const resolveOpenapiRoot = (options) => resolveOpenapiContext(options).openapiRoot;

const main = () => {
  const [command] = process.argv.slice(2);
  const context = resolveOpenapiContext();

  if (command === '--context' || command === '--doctor') {
    printContext(context);
    return;
  }
  if (command) {
    throw new Error('Usage: openapi-root.cjs [--context|--doctor]');
  }

  process.stderr.write(
    `[openapi] source=${context.openapiRoot} selection=${context.openapiSource} workspace=${context.workspaceId ?? 'main-checkout'}\n`,
  );
  process.stdout.write(context.openapiRoot);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { resolveOpenapiContext, resolveOpenapiRoot };
