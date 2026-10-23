const assert = require("node:assert/strict");
const path = require("node:path");
const SwaggerParser = require("@apidevtools/swagger-parser");

const agentBridgeSpecPath = path.resolve(
  __dirname,
  "../specs/agent-bridge/openapi.yaml",
);

const fastModeValues = [true, false, undefined];

const acceptsNamedConstraint = (constraint, provider, fastMode) => {
  const invalidCombination = constraint.not.allOf;
  const requiresFastMode = invalidCombination[0].required.includes("fastMode");
  const fastModeProviders = invalidCombination[1].properties.provider.not.enum;

  return !(
    requiresFastMode &&
    fastMode !== undefined &&
    provider !== undefined &&
    !fastModeProviders.includes(provider)
  );
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

  for (const provider of ["codex", "claude"]) {
    for (const fastMode of fastModeValues) {
      assert.equal(
        acceptsNamedConstraint(startRunFastModeConstraint, provider, fastMode),
        true,
      );
    }
  }

  for (const provider of ["opencode"]) {
    assert.equal(
      acceptsNamedConstraint(startRunFastModeConstraint, provider, undefined),
      true,
    );
    assert.equal(
      acceptsNamedConstraint(startRunFastModeConstraint, provider, true),
      false,
    );
    assert.equal(
      acceptsNamedConstraint(startRunFastModeConstraint, provider, false),
      false,
    );
  }

  console.log("Fast mode contract validation passed.");
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
