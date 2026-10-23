const fs = require('fs');
const path = require('path');

require('ts-node/register/transpile-only');
const {
  resolveSiblingRepository,
  resolveWorktreeContext,
} = require('../src/utils/worktree-context');

const resolveOpenapiRoot = () => {
  const context = resolveWorktreeContext();
  const openapiRoot = resolveSiblingRepository(
    context,
    'openapi',
    process.env.HEY_HEY_OPENAPI_ROOT,
  );

  if (!fs.existsSync(path.join(openapiRoot, 'specs/api/openapi.yaml'))) {
    throw new Error(
      `Unable to locate the OpenAPI repository at ${openapiRoot}. Set HEY_HEY_OPENAPI_ROOT to the pinned checkout.`,
    );
  }

  return openapiRoot;
};

if (require.main === module) {
  try {
    process.stdout.write(resolveOpenapiRoot());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { resolveOpenapiRoot };
