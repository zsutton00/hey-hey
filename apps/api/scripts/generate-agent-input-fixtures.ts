/**
 * Emit the cross-workspace JSON artifact for the `UserMessageData.agentInput`
 * per-arm contract from the typed source of truth
 * (`api/test/fixtures/userMessageAgentInput/index.ts`).
 *
 * The JSON lives alongside the OpenAPI spec so the paired CLI dispatcher
 * round-trip test can parse it without depending on the API's generated TS
 * types. The API contract test asserts this file stays byte-in-sync with the TS
 * source; regenerate with:
 *
 *   npx ts-node -r tsconfig-paths/register scripts/generate-agent-input-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { AGENT_INPUT_FIXTURES } from '../test/fixtures/userMessageAgentInput';
import { resolveOpenapiRoot } from '../test/helpers/openapi-root';

const OUTPUT_PATH = resolve(
  resolveOpenapiRoot(),
  'specs/fixtures/user-message-agent-input.fixtures.json',
);

mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(
  OUTPUT_PATH,
  `${JSON.stringify(AGENT_INPUT_FIXTURES, null, 2)}\n`,
);

// eslint-disable-next-line no-console
console.log(
  `wrote ${AGENT_INPUT_FIXTURES.length} agent-input fixtures to ${OUTPUT_PATH}`,
);
