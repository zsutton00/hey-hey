import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { printWebUiReadSchema } from '../web-ui-read-schema';

const SCHEMA_FILE = resolve(
  __dirname,
  '../../../../../openapi/specs/graphql/web-ui-read.graphql',
);

/**
 * Drift check for the published schema. After changing a resolver or type, run
 * `pnpm --filter hey-hey-api graphql:publish` to rewrite the file.
 */
describe('published Web UI read GraphQL schema', () => {
  it('matches the schema the endpoint serves', async () => {
    const served = await printWebUiReadSchema();

    if (process.env.UPDATE_GRAPHQL_SCHEMA === '1') {
      mkdirSync(dirname(SCHEMA_FILE), { recursive: true });
      writeFileSync(SCHEMA_FILE, served);
    }

    expect(readFileSync(SCHEMA_FILE, 'utf8')).toBe(served);
  });
});
