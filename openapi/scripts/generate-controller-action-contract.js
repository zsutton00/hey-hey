#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const {
  generateRuntimeSchema,
} = require("./generate-repository-feature-enrichment-runtime-schema");

async function generateControllerActionContract(output, typeImport) {
  await generateRuntimeSchema(
    [output],
    ["HostActionPreparation", "ControllerActionInputs"],
    "controllerActionRuntimeSchema",
    typeImport,
  );
  fs.appendFileSync(
    output,
    `
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { createHash } from 'node:crypto';

const ajv = new Ajv({ strict: false });
addFormats(ajv);
const validateAction = ajv.compile<HostActionPreparation>({
  ...controllerActionRuntimeSchema,
  $ref: '#/definitions/HostActionPreparation',
});
export const isHostActionPreparation = (value: object): value is HostActionPreparation => validateAction(value);
const validateInputs = ajv.compile<ControllerActionInputs>({
  ...controllerActionRuntimeSchema,
  $ref: '#/definitions/ControllerActionInputs',
});
export const isControllerActionInputs = (value: object): value is ControllerActionInputs => validateInputs(value);


function serialize<T>(value: T): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot canonicalize a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(item => serialize(item ?? null)).join(',') + ']';
  if (typeof value === 'object') {
    const members = Object.entries(value).filter(([, member]) => member !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return '{' + members.map(([key, member]) => JSON.stringify(key) + ':' + serialize(member)).join(',') + '}';
  }
  throw new Error('Cannot canonicalize a non-JSON value');
}

/** Every execution/disclosure input is included by construction. Only read
 * correlation and the preparation's retry identity are transport metadata.
 * Legacy machine catalog selectors retain their existing hash for continuity.
 */
export function hashControllerAction(action: HostActionPreparation): string {
  if (action.targetKind === 'CLI_READ' || !action.inputs) {
    return createHash('sha256').update(serialize(action), 'utf8').digest('hex');
  }
  const { requestId: _retryIdentity, ...semanticAction } = action;
  const inputs = action.inputs;
  if (inputs?.kind === 'CLI_READ') {
    const { requestId: _correlation, ...body } = inputs.body;
    return createHash('sha256').update(serialize({ ...semanticAction, inputs: { kind: inputs.kind, body } }), 'utf8').digest('hex');
  }
  if (inputs?.kind === 'CONTROL' && inputs.body.kind === 'permission_decision') {
    return createHash('sha256').update(serialize({ ...semanticAction, inputs: {
      kind: inputs.kind, body: { ...inputs.body, reason: inputs.body.reason ?? null },
    } }), 'utf8').digest('hex');
  }
  return createHash('sha256').update(serialize(semanticAction), 'utf8').digest('hex');
}
`,
  );
  fs.appendFileSync(
    output,
    "\nimport type { ConversationStartRunRequestDto, ControllerStartInputs, ControllerMessageInputs, UserMessageData } from " +
      JSON.stringify(typeImport) +
      ";\n" +
      fs.readFileSync(
        path.join(__dirname, "controller-action-inputs.template.ts"),
        "utf8",
      ),
  );
}
function generateBrowserInputs(output, typeImport) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    "// Generated from the shared OpenAPI action-input mapping.\nimport type { ConversationStartRunRequestDto, ControllerStartInputs, ControllerMessageInputs, UserMessageData } from " +
      JSON.stringify(typeImport) +
      ";\n" +
      fs.readFileSync(
        path.join(__dirname, "controller-action-inputs.template.ts"),
        "utf8",
      ),
  );
}
if (require.main === module) {
  if (process.argv[2] === "--browser") {
    generateBrowserInputs(process.argv[3], process.argv[4]);
  } else {
    generateControllerActionContract(process.argv[2], process.argv[3]).catch(
      (error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      },
    );
  }
}
module.exports = { generateControllerActionContract };
