const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const yaml = require("js-yaml");
const SwaggerParser = require("@apidevtools/swagger-parser");

const repositoryRoot = path.resolve(__dirname, "..");
const agentBridgeSpecPath = path.join(
  repositoryRoot,
  "specs/agent-bridge/openapi.yaml",
);
const runPayloadsPath = path.join(repositoryRoot, "specs/schemas/run-payloads.yaml");
const fixturePath = path.join(
  repositoryRoot,
  "specs/fixtures/workflow-start-run-payloads.json",
);
const canonicalEntityRef = "./run-entity.yaml#/RunEntityReference";

const sourceRunPayloads = yaml.load(fs.readFileSync(runPayloadsPath, "utf8"));
const sourceWorkflowKickoff = sourceRunPayloads.RunCreatePayloadWorkflowKickoff;

const main = async () => {
  const agentBridge = await SwaggerParser.dereference(agentBridgeSpecPath);
  const workflowKickoff =
    agentBridge.components.schemas.RunCreatePayloadWorkflowKickoff;
  const startRunPrompt = agentBridge.components.schemas.StartRunPromptPayload;
  const startRunWorktree = agentBridge.components.schemas.StartRunWorktree;
  const runContextMetadata = agentBridge.components.schemas.RunContextMetadata;
  const runReferences = agentBridge.components.schemas.RunReferences;
  const runEntity = agentBridge.components.schemas.RunEntityReference;

assert.equal(
  sourceWorkflowKickoff.properties.entity.$ref,
  canonicalEntityRef,
  "Workflow kickoff must reuse the canonical RunEntityReference.",
);
assert.equal(
  workflowKickoff.required.includes("entity"),
  false,
  "Omitting entity must remain the explicit unscoped workflow form.",
);
for (const duplicateIdentityField of [
  "entityType",
  "entityId",
  "focalEntity",
]) {
  assert.equal(
    Object.hasOwn(workflowKickoff.properties, duplicateIdentityField),
    false,
    `Workflow kickoff must not define duplicate identity field ${duplicateIdentityField}.`,
  );
}

assert.equal(
  startRunPrompt.required.includes("payload"),
  false,
  "Start-run payload must remain optional for bind-only workflow launches.",
);
assert.equal(
  startRunPrompt.required.includes("workflowName"),
  false,
  "Start-run workflowName must remain arm-specific.",
);
assert.equal(
  startRunPrompt.required.includes("handlerPromptType"),
  false,
  "Start-run handlerPromptType must remain arm-specific.",
);

const workflowKickoffValidationSchema = {
  ...workflowKickoff,
  properties: {
    ...workflowKickoff.properties,
    entity: runEntity,
  },
};
const workflowKickoffRef =
  "../schemas/run-payloads.yaml#/RunCreatePayloadWorkflowKickoff";
const resolveWorkflowKickoffRef = (value) => {
  if (Array.isArray(value)) {
    return value.map(resolveWorkflowKickoffRef);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value.$ref === workflowKickoffRef) {
    return workflowKickoffValidationSchema;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      resolveWorkflowKickoffRef(child),
    ]),
  );
};
const startRunContractSchema = resolveWorkflowKickoffRef(startRunPrompt);
const runContextValidationSchema = {
  ...runContextMetadata,
  properties: {
    ...runContextMetadata.properties,
    task: {},
    taskMonitor: {},
    fileReferences: runReferences,
  },
};
const startRunEnvelopeProperties = {
  attachments: startRunPrompt.properties.attachments,
  triggersAgent: startRunPrompt.properties.triggersAgent,
  handlerPromptType: startRunPrompt.properties.handlerPromptType,
  workflowName: startRunPrompt.properties.workflowName,
  payload: {},
  model: startRunPrompt.properties.model,
  reasoningEffort: startRunPrompt.properties.reasoningEffort,
  config: {},
  provider: startRunPrompt.properties.provider,
  fastMode: startRunPrompt.properties.fastMode,
  contextMetadata: runContextValidationSchema,
  serviceIds: startRunPrompt.properties.serviceIds,
  launchServiceId: startRunPrompt.properties.launchServiceId,
  worktree: startRunWorktree,
  agentSessionId: startRunPrompt.properties.agentSessionId,
};
const startRunEnvelopeValidationSchema = {
  ...startRunContractSchema,
  additionalProperties: false,
  properties: startRunEnvelopeProperties,
};
const workflowEnvelopeValidationSchema = {
  ...startRunEnvelopeValidationSchema,
  required: [...startRunPrompt.required, "workflowName"],
  properties: {
    ...startRunEnvelopeProperties,
    payload: workflowKickoffValidationSchema,
  },
};
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
addFormats(ajv);
const validateWorkflowKickoff = ajv.compile(workflowKickoffValidationSchema);
const validateStartRunEnvelope = ajv.compile(
  startRunEnvelopeValidationSchema,
);
const validateWorkflowEnvelope = ajv.compile(workflowEnvelopeValidationSchema);
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

assert.equal(
  validateWorkflowKickoff(fixture.entityScoped),
  true,
  JSON.stringify(validateWorkflowKickoff.errors),
);
assert.equal(
  validateWorkflowKickoff(fixture.unscoped),
  true,
  JSON.stringify(validateWorkflowKickoff.errors),
);
assert.equal(
  validateWorkflowKickoff(fixture.invalidEntity),
  false,
  "Malformed workflow focal entities must be rejected.",
);
assert.equal(
  validateStartRunEnvelope({
    ...fixture.envelopeBase,
    handlerPromptType: "startup_session",
    attachments: [],
    payload: { promptType: "startup_session" },
  }),
  true,
  JSON.stringify(validateStartRunEnvelope.errors),
);
for (const handlerPromptType of ["entity_conversation", "project_assistant"]) {
  const envelope = {
    ...fixture.envelopeBase,
    handlerPromptType,
    payload: { promptType: handlerPromptType },
  };
  assert.equal(
    validateStartRunEnvelope(envelope),
    true,
    JSON.stringify(validateStartRunEnvelope.errors),
  );
  assert.equal(
    validateStartRunEnvelope({ ...envelope, attachments: [] }),
    true,
    JSON.stringify(validateStartRunEnvelope.errors),
  );
  assert.equal(
    validateStartRunEnvelope({
      ...envelope,
      attachments: [{ attachmentId: "invalid", fileName: "notes.txt" }],
    }),
    false,
    "Malformed attachment references must be rejected.",
  );
}
assert.equal(
  validateStartRunEnvelope(fixture.envelopeBase),
  false,
  "A start-run envelope must select exactly one arm.",
);
assert.equal(
  validateStartRunEnvelope({
    ...fixture.envelopeBase,
    handlerPromptType: "startup_session",
  }),
  false,
  "The handler arm must carry a payload.",
);
assert.equal(
  validateStartRunEnvelope({
    ...fixture.envelopeBase,
    handlerPromptType: "startup_session",
    workflowName: "feature-sync",
    attachments: [],
    payload: { promptType: "startup_session" },
  }),
  false,
  "The handler and workflow discriminators are mutually exclusive.",
);
assert.equal(
  validateWorkflowEnvelope({
    ...fixture.envelopeBase,
    workflowName: "plan-from-design-doc",
  }),
  true,
  JSON.stringify(validateWorkflowEnvelope.errors),
);
assert.equal(
  validateWorkflowEnvelope({
    ...fixture.envelopeBase,
    workflowName: "feature-sync",
    payload: fixture.entityScoped,
  }),
  true,
  JSON.stringify(validateWorkflowEnvelope.errors),
);
assert.equal(
  validateWorkflowEnvelope({
    ...fixture.envelopeBase,
    workflowName: "feature-sync",
    payload: fixture.unscoped,
  }),
  true,
  JSON.stringify(validateWorkflowEnvelope.errors),
);
assert.equal(
  validateWorkflowEnvelope({
    ...fixture.envelopeBase,
    workflowName: "feature-sync",
    payload: fixture.invalidEntity,
  }),
  false,
  "Malformed workflow focal entities must be rejected in a full envelope.",
);

  process.stdout.write("Workflow start-run contract validation passed.\n");
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
