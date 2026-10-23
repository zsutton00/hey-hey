const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const yaml = require("js-yaml");
const SwaggerParser = require("@apidevtools/swagger-parser");

const repositoryRoot = path.resolve(__dirname, "..");
const apiSpecPath = path.join(repositoryRoot, "specs/api/openapi.yaml");
const agentBridgeSpecPath = path.join(
  repositoryRoot,
  "specs/agent-bridge/openapi.yaml",
);
const eventsSpecPath = path.join(repositoryRoot, "specs/schemas/events.yaml");
const conversationsSpecPath = path.join(
  repositoryRoot,
  "specs/schemas/conversations.yaml",
);
const completionSpecPath = path.join(
  repositoryRoot,
  "specs/schemas/external-agent-completion.yaml",
);
const sourcePath = path.join(
  repositoryRoot,
  "specs/schemas/repository-grounding.yaml",
);

const sourceText = fs.readFileSync(sourcePath, "utf8");
const source = yaml.load(sourceText);
const eventsSource = yaml.load(fs.readFileSync(eventsSpecPath, "utf8"));
const conversationsSource = yaml.load(
  fs.readFileSync(conversationsSpecPath, "utf8"),
);
const completionSource = yaml.load(fs.readFileSync(completionSpecPath, "utf8"));

const assertValid = (validate, value, message) => {
  assert.equal(validate(value), true, `${message}: ${JSON.stringify(validate.errors)}`);
};

const assertInvalid = (validate, value, message) => {
  assert.equal(validate(value), false, message);
};

const sampleIds = {
  projectId: "00000000-0000-4000-8000-000000000001",
  conversationId: "00000000-0000-4000-8000-000000000002",
  workflowId: "00000000-0000-4000-8000-000000000003",
  serviceId: "00000000-0000-4000-8000-000000000004",
  machineId: "00000000-0000-4000-8000-000000000005",
};

const bounds = {
  maxFiles: 100,
  maxTotalBytes: 1000000,
  maxFileBytes: 100000,
  maxDepth: 8,
  maxGeneratedFiles: 20,
  maxIgnoredFiles: 20,
  maxUnsupportedFiles: 20,
  maxBinaryFiles: 20,
};

const request = {
  ...sampleIds,
  workflowNodeId: "repository-analysis",
  entryMode: "new_project",
  confirmedServiceBrief: "The service owns the project API and background jobs.",
  scope: { scope: "focused", focus: "The service boundary and public API." },
  provider: "codex",
  resolvedFrontierModel: "frontier-model-1",
  reasoningEffort: "high",
  fastMode: true,
  bounds,
};

const success = {
  outcome: "success",
  serviceId: sampleIds.serviceId,
  provider: request.provider,
  resolvedFrontierModel: request.resolvedFrontierModel,
  narrative: "The repository centers on an API service with a small worker surface.",
  hierarchy: {
    topLevels: [
      {
        id: "feature-api",
        name: "Project API",
        description: "The service delivers the project API capability.",
        tag: "backend",
        children: [
          {
            id: "feature-api-auth",
            name: "API Authentication",
            description: "The API authenticates project requests.",
            tag: "backend",
          },
        ],
      },
    ],
  },
  evidence: [
    {
      path: "src/api/index.ts",
      summary: "The API entry point registers the project routes.",
      lineStart: 1,
      lineEnd: 20,
    },
  ],
  briefDiscrepancies: [],
};

const main = async () => {
  assert.match(
    sourceText,
    /RepositoryGroundingIntentAnswer:[\s\S]*?choice:\s*\n\s*type: string\s*\n\s*enum:\s*\n\s*-\s*["']yes["']\s*\n\s*-\s*["']no["']/,
    "Yes/No intent enum values must remain quoted YAML strings for OpenAPI Generator",
  );
  assert.deepEqual(Object.keys(source.RepositoryGroundingIntentAnswer.properties), ["choice"]);
  assert.deepEqual(source.RepositoryGroundingIntentAnswer.required, ["choice"]);
  assert.equal(source.RepositoryGroundingIntentAnswer.additionalProperties, false);
  assert.deepEqual(source.RepositoryGroundingFocusedScope.required, ["scope", "focus"]);
  assert.deepEqual(source.RepositoryGroundingComprehensiveScope.required, ["scope"]);
  assert.equal(source.RepositoryGroundingComprehensiveScope.additionalProperties, false);
  assert.equal(source.RepositoryGroundingCompletion.oneOf.length, 3);
  assert.deepEqual(source.RepositoryGroundingCompletion.discriminator, {
    propertyName: "outcome",
    mapping: {
      success: "#/RepositoryGroundingSuccess",
      retryable_failure: "#/RepositoryGroundingRetryableFailure",
      terminal_failure: "#/RepositoryGroundingTerminalFailure",
    },
  });
  assert.equal(
    completionSource.RepositoryGroundingExternalCompletionPayload.oneOf.length,
    8,
    "External completion payload must include the grounding, enrichment, first-work, placement, and generic branches",
  );
  assert.equal(
    completionSource.SubmitExternalAgentCompletionRequestDto.properties.payload.$ref,
    "#/RepositoryGroundingExternalCompletionPayload",
    "External completion requests must use the shared typed payload contract",
  );
  assert.equal(
    conversationsSource.ExternalAgentNodeCompletion.properties.payload.$ref,
    "./external-agent-completion.yaml#/RepositoryGroundingExternalCompletionPayload",
    "External-agent completion markers must use the shared typed payload contract",
  );
  assert.equal(
    conversationsSource.ExternalAgentCompletionPayload.properties.payload.$ref,
    "./external-agent-completion.yaml#/RepositoryGroundingExternalCompletionPayload",
    "External-agent completion messages must use the shared typed payload contract",
  );

  const forbiddenPropertyPattern = /^(absolutePath|directoryPath|sourceBody|sourceBodies|rawSource|contents)$/i;
  const walkProperties = (value, location = "source") => {
    if (!value || typeof value !== "object") return;
    if (value.properties && typeof value.properties === "object") {
      for (const propertyName of Object.keys(value.properties)) {
        assert.equal(
          forbiddenPropertyPattern.test(propertyName),
          false,
          `Repository-grounding schemas must not expose ${location}.${propertyName}.`,
        );
        walkProperties(value.properties[propertyName], `${location}.${propertyName}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== "properties") walkProperties(child, `${location}.${key}`);
    }
  };
  walkProperties(source);

  const [apiSpec, agentBridgeSpec] = await Promise.all([
    SwaggerParser.dereference(apiSpecPath),
    SwaggerParser.dereference(agentBridgeSpecPath),
  ]);
  const apiSchemas = apiSpec.components.schemas;
  const bridgeSchemas = agentBridgeSpec.components.schemas;
  const ajv = new Ajv({ allErrors: true, strict: false, coerceTypes: false });
  addFormats(ajv);
  for (const format of [
    "branded-OrganizationId",
    "branded-ProjectId",
    "branded-ConversationId",
    "branded-WorkflowId",
    "branded-ServiceId",
    "branded-MachineId",
  ]) {
    ajv.addFormat(format, true);
  }
  const compile = (schemas, name) => ajv.compile(schemas[name]);

  const validateIntent = compile(apiSchemas, "RepositoryGroundingIntentAnswer");
  const validatePrerequisites = compile(
    apiSchemas,
    "RepositoryGroundingPrerequisites",
  );
  const validateConfiguration = compile(
    apiSchemas,
    "RepositoryGroundingAnalysisConfiguration",
  );
  const validateRequest = compile(bridgeSchemas, "RepositoryGroundingRequest");
  const validateCompletion = compile(
    bridgeSchemas,
    "RepositoryGroundingCompletion",
  );
  const validateCompletionRequestPayload = ajv.compile(
    apiSchemas.SubmitExternalAgentCompletionRequestDto.properties.payload,
  );
  const validateMessageCompletion = compile(
    apiSchemas,
    "ExternalAgentCompletionPayload",
  );
  const validateWorkflowContext = compile(
    apiSchemas,
    "RepositoryGroundingWorkflowContext",
  );
  const validateRunPayload = compile(
    bridgeSchemas,
    "RunCreatePayloadRepositoryGrounding",
  );
  const validateTrigger = compile(
    bridgeSchemas,
    "AgentTriggerRepositoryGrounding",
  );

  assertValid(validateIntent, { choice: "yes" }, "Yes intent answer must validate");
  assertValid(validateIntent, { choice: "no" }, "No intent answer must validate");
  assertInvalid(
    validateIntent,
    { choice: "yes", serviceId: sampleIds.serviceId },
    "Intent answer must not collect repository prerequisites",
  );

  assertValid(
    validatePrerequisites,
    {
      entryMode: "existing_project",
      serviceId: sampleIds.serviceId,
      confirmedServiceBrief: "The service owns project reporting.",
      machineId: sampleIds.machineId,
    },
    "Accepted prerequisites must validate",
  );
  assertInvalid(
    validatePrerequisites,
    {
      entryMode: "existing_project",
      serviceId: sampleIds.serviceId,
      confirmedServiceBrief: "",
      machineId: sampleIds.machineId,
    },
    "A confirmed Service brief must be non-empty",
  );

  assertValid(
    validateConfiguration,
    {
      scope: { scope: "focused", focus: "Public API" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      reasoningEffort: "high",
      fastMode: true,
      bounds,
    },
    "Focused configuration must validate",
  );
  assertValid(
    validateConfiguration,
    {
      scope: { scope: "comprehensive" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      reasoningEffort: "high",
      bounds,
    },
    "Comprehensive configuration must validate without focus",
  );
  assertInvalid(
    validateConfiguration,
    {
      scope: { scope: "focused" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      reasoningEffort: "high",
      bounds,
    },
    "Focused configuration must require a non-empty focus",
  );
  assertInvalid(
    validateConfiguration,
    {
      scope: { scope: "comprehensive", focus: "Unexpected focus" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      reasoningEffort: "high",
      bounds,
    },
    "Comprehensive configuration must reject focus",
  );
  assertInvalid(
    validateConfiguration,
    {
      scope: { scope: "comprehensive" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      bounds,
    },
    "Configuration must reject a partial runtime selection without reasoning effort",
  );
  assertInvalid(
    validateConfiguration,
    {
      scope: { scope: "comprehensive" },
      provider: "codex",
      resolvedFrontierModel: "frontier-model-1",
      reasoningEffort: "automatic",
      bounds,
    },
    "Configuration must reject a reasoning effort outside the runtime catalog vocabulary",
  );

  assertValid(validateRequest, request, "Machine-addressed request must validate");
  assertInvalid(
    validateRequest,
    { ...request, confirmedServiceBrief: "" },
    "Machine-addressed request must require a confirmed brief",
  );
  assertInvalid(
    validateRequest,
    { ...request, scope: { scope: "focused" } },
    "Machine-addressed request must preserve focused-scope requirements",
  );

  const workflowContext = {
    prerequisites: {
      entryMode: "new_project",
      serviceId: sampleIds.serviceId,
      confirmedServiceBrief: request.confirmedServiceBrief,
      machineId: sampleIds.machineId,
    },
    analysisConfiguration: {
      scope: request.scope,
      provider: request.provider,
      resolvedFrontierModel: request.resolvedFrontierModel,
      reasoningEffort: request.reasoningEffort,
      fastMode: request.fastMode,
      bounds,
    },
  };
  assertValid(
    validateWorkflowContext,
    workflowContext,
    "Repository-grounding workflow context must validate",
  );
  assert.deepEqual(
    conversationsSource.CreateRepositoryImportConversationContext.properties
      .repositoryGrounding.oneOf,
    [
      {
        $ref:
          "./repository-grounding.yaml#/RepositoryGroundingConversationSeed",
      },
      { $ref: "./workflows.yaml#/RepositoryGroundingWorkflowContext" },
    ],
    "Repository-import conversation creation must consume the typed repository-grounding seed or workflow context",
  );
  assert.equal(
    eventsSource.components.schemas.FlowContextSnapshot.properties.repositoryGrounding.$ref,
    "./workflows.yaml#/RepositoryGroundingWorkflowContext",
    "Flow context must consume repository-grounding workflow context",
  );

  assertValid(validateCompletion, success, "Successful completion must validate");
  assertValid(
    validateCompletionRequestPayload,
    success,
    "External completion requests must accept typed repository-grounding results",
  );
  assertValid(
    validateMessageCompletion,
    { action: "repository_grounding", payload: success },
    "External completion messages must accept typed repository-grounding results",
  );
  assertValid(
    validateCompletionRequestPayload,
    { arbitraryActionField: "preserved" },
    "External completion requests must preserve generic action payloads",
  );
  assertValid(
    validateCompletionRequestPayload,
    { outcome: "success", arbitraryActionField: "preserved" },
    "Generic action payloads may retain their own outcome values",
  );
  assertInvalid(
    validateCompletion,
    {
      ...success,
      hierarchy: {
        topLevels: [
          {
            ...success.hierarchy.topLevels[0],
            children: [
              {
                ...success.hierarchy.topLevels[0].children[0],
                children: [],
              },
            ],
          },
        ],
      },
    },
    "Hierarchy leaves must not grow a third level",
  );
  assertInvalid(
    validateCompletion,
    { ...success, evidence: [{ path: "/Users/example/src/index.ts", summary: "leak" }] },
    "Evidence must remain repository-relative",
  );
  assertInvalid(
    validateCompletion,
    { ...success, evidence: [{ path: "src\\..\\outside.ts", summary: "traversal" }] },
    "Evidence must not use Windows-style traversal",
  );
  assertValid(
    validateCompletion,
    {
      outcome: "retryable_failure",
      code: "provider_timeout",
      message: "The selected provider timed out.",
    },
    "Retryable failure must validate",
  );
  assertValid(
    validateCompletion,
    {
      outcome: "terminal_failure",
      code: "unsupported_model",
      message: "The selected model is not supported.",
    },
    "Terminal failure must validate",
  );
  assertInvalid(
    validateCompletion,
    { outcome: "retryable_failure", code: "provider_timeout", message: "x", narrative: "not allowed" },
    "Failure outcomes must not carry success result fields",
  );

  assertValid(validateRunPayload, { promptType: "repository_grounding", ...request }, "Run payload must reuse the request");
  assertValid(
    validateTrigger,
    {
      promptType: "repository_grounding",
      nodeId: "repository-analysis",
      triggerMessageId: "00000000-0000-4000-8000-000000000006",
      payload: request,
    },
    "Trigger must carry the typed machine request",
  );

  const apiPaths = Object.keys(apiSpec.paths);
  assert.equal(
    apiPaths.some((route) => /repository-grounding|analysis-attempt|durable-review/i.test(route)),
    false,
    "Repository grounding must not add a parallel completion or persistence endpoint",
  );

  process.stdout.write("Repository-grounding contract validation passed.\n");
};

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
