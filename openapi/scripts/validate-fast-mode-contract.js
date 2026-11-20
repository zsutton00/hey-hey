const assert = require("node:assert/strict");
const path = require("node:path");
const Ajv = require("ajv");
const SwaggerParser = require("@apidevtools/swagger-parser");

const agentBridgeSpecPath = path.resolve(
  __dirname,
  "../specs/agent-bridge/openapi.yaml",
);

const apiSpecPath = path.resolve(__dirname, "../specs/api/openapi.yaml");
const conversationStartPath =
  "/organizations/{organizationId}/projects/{projectId}/conversations/{conversationId}/start-run";

const assertFastModeAdmission = (name, schema) => {
  assert.ok(schema.not, `${name} must define its Fast mode exclusion`);
  const validate = new Ajv({ strict: false }).compile({ not: schema.not });

  for (const provider of ["codex", "claude", "opencode", "antigravity"]) {
    assert.equal(
      validate({ provider }),
      true,
      `${name} must allow omission for ${provider}`,
    );
    for (const fastMode of [true, false]) {
      const supported = provider === "codex" || provider === "claude";
      assert.equal(
        validate({ provider, fastMode }),
        supported,
        `${name}: ${provider} with fastMode=${fastMode}`,
      );
    }
  }
};

const main = async () => {
  const agentBridge = await SwaggerParser.dereference(agentBridgeSpecPath);
  const config = agentBridge.components.schemas.AgentSessionConfigV2;
  const startRun = agentBridge.components.schemas.StartRunPromptPayload;
  const startRunFastModeConstraint =
    agentBridge.components.schemas.AgentBridgeStartRunAdmission;

  assert.equal(config.properties.fastMode.type, "boolean");
  assert.equal(config.required.includes("fastMode"), false);
  assert.equal(startRun.properties.fastMode.type, "boolean");

  const api = await SwaggerParser.dereference(apiSpecPath);
  const conversationStart =
    api.paths[conversationStartPath].post.requestBody.content[
      "application/json"
    ].schema;
  assertFastModeAdmission("Conversation start-run", conversationStart);
  assertFastModeAdmission("Agent Bridge start-run", startRunFastModeConstraint);

  console.log("Fast mode contract validation passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
