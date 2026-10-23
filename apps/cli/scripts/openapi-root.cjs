const {
  describeOpenapiSource,
  resolveOpenapiRoot,
  resolveOpenapiSource,
} = require('../../../scripts/openapi-source.cjs');

const main = () => {
  const [command] = process.argv.slice(2);

  if (command === '--context' || command === '--doctor') {
    process.stdout.write(`${JSON.stringify(describeOpenapiSource(), null, 2)}\n`);
    return;
  }
  if (command) {
    throw new Error('Usage: openapi-root.cjs [--context|--doctor]');
  }

  const { openapiRoot, selection } = resolveOpenapiSource();
  process.stderr.write(`[openapi] source=${openapiRoot} selection=${selection}\n`);
  process.stdout.write(openapiRoot);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { resolveOpenapiRoot };
