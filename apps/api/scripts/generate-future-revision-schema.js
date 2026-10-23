const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveGeneratedRoot } = require('./generated-root');

async function main() {
  const root = execFileSync(
    process.execPath,
    [path.join(__dirname, 'openapi-root.js')],
    { encoding: 'utf8' },
  ).trim();
  const Parser = require(
    require.resolve('@apidevtools/swagger-parser', { paths: [root] }),
  );
  const document = await Parser.dereference({
    openapi: '3.0.3',
    info: { title: 'Future revision mutation', version: '1' },
    paths: {},
    components: {
      schemas: {
        FutureApplyRequest: {
          $ref:
            path.join(root, 'specs/schemas/future-revisions.yaml') +
            '#/FutureApplyRequest',
        },
        FutureRevisionMutation: {
          $ref:
            path.join(root, 'specs/schemas/future-revisions.yaml') +
            '#/FutureRevisionMutation',
        },
        FutureRevisionAuthoring: {
          $ref:
            path.join(root, 'specs/schemas/future-revisions.yaml') +
            '#/FutureRevisionAuthoring',
        },
        FutureWorkItemChanges: {
          $ref:
            path.join(root, 'specs/schemas/future-revisions.yaml') +
            '#/FutureWorkItemChanges',
        },
        FutureDesignDocChanges: {
          $ref:
            path.join(root, 'specs/schemas/future-revisions.yaml') +
            '#/FutureDesignDocChanges',
        },
      },
    },
  });
  const exports = {
    futureRevisionMutationSchema: 'FutureRevisionMutation',
    futureApplyRequestSchema: 'FutureApplyRequest',
    futureRevisionAuthoringSchema: 'FutureRevisionAuthoring',
    futureWorkItemChangesSchema: 'FutureWorkItemChanges',
    futureDesignDocChangesSchema: 'FutureDesignDocChanges',
  };
  fs.writeFileSync(
    path.join(resolveGeneratedRoot(), 'future-revision.schema.ts'),
    '// Generated from OpenAPI. Do not edit.\n' +
      Object.entries(exports)
        .map(
          ([name, component]) =>
            `export const ${name} = ` +
            JSON.stringify(
              toJsonSchema(document.components.schemas[component]),
              null,
              2,
            ) +
            ';\n',
        )
        .join(''),
  );
}
function toJsonSchema(value) {
  if (Array.isArray(value)) return value.map(toJsonSchema);
  if (value === null || typeof value !== 'object') return value;
  const { nullable, ...rest } = value;
  const converted = Object.fromEntries(
    Object.entries(rest).map(([key, entry]) => [key, toJsonSchema(entry)]),
  );
  return nullable ? { anyOf: [converted, { type: 'null' }] } : converted;
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
