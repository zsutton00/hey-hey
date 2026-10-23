const { resolveOpenapiRoot } = require('../../../scripts/openapi-source.cjs');

if (require.main === module) {
  try {
    process.stdout.write(resolveOpenapiRoot());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { resolveOpenapiRoot };
