const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const SwaggerParser = require("@apidevtools/swagger-parser");

const repositoryRoot = path.resolve(__dirname, "..");
const agentBridgeSpecPath = path.join(
  repositoryRoot,
  "specs/agent-bridge/openapi.yaml",
);
const fixturePath = path.join(
  repositoryRoot,
  "specs/fixtures/task-monitor-contract.json",
);

const parseArguments = (argv) => {
  const options = {
    validateFixture: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--validate-fixture") {
      options.validateFixture = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) {
      throw new Error(`Missing value for ${argument}.`);
    }
    if (argument === "--typescript-output") {
      options.typescriptOutput = path.resolve(value);
    } else {
      throw new Error(`Unknown argument ${argument}.`);
    }
    index += 1;
  }

  return options;
};

const loadSchemas = async () => {
  const agentBridge = await SwaggerParser.dereference(agentBridgeSpecPath);
  const executionDefinition =
    agentBridge.components.schemas.TaskMonitorExecutionDefinition;
  if (!executionDefinition) {
    throw new Error(
      "Task Monitor execution definition must be explicitly exported by the Agent Bridge specification.",
    );
  }
  const coordinatorDecision =
    agentBridge.components.schemas.LocalTaskMonitorCoordinatorDecision;
  if (!coordinatorDecision) {
    throw new Error(
      "Task Monitor coordinator decision must be explicitly exported by the Agent Bridge specification.",
    );
  }
  const launchConfig = agentBridge.components.schemas.TaskMonitorLaunchConfig;
  if (!launchConfig) {
    throw new Error(
      "Task Monitor launch config must be explicitly exported by the Agent Bridge specification.",
    );
  }
  return { executionDefinition, coordinatorDecision, launchConfig };
};

const ensureParentDirectory = (filePath) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

const writeTypescriptArtifact = (outputPath, schemas) => {
  if (!outputPath) {
    return;
  }
  ensureParentDirectory(outputPath);
  const source = [
    "/* This file is generated from OpenAPI by scripts/task-monitor-contract.js. */",
    "/* Do not edit by hand. */",
    "",
    `export const taskMonitorExecutionDefinitionJsonSchema = ${JSON.stringify(schemas.executionDefinition, null, 2)} as const;`,
    "",
    `export const taskMonitorCoordinatorDecisionJsonSchema = ${JSON.stringify(schemas.coordinatorDecision, null, 2)} as const;`,
    "",
  ].join("\n");
  fs.writeFileSync(outputPath, source);
};

const formatErrors = (errors) =>
  (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");

const validateFixture = (schemas) => {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
  });
  addFormats(ajv);
  const validateExecutionDefinition = ajv.compile(
    schemas.executionDefinition,
  );
  const validateLaunchConfig = ajv.compile(schemas.launchConfig);
  const serializedFixture = fs.readFileSync(fixturePath, "utf8");
  const fixture = JSON.parse(serializedFixture);

  for (const key of ["notStarted", "running", "paused"]) {
    if (!validateExecutionDefinition(fixture[key])) {
      throw new Error(
        `Canonical fixture ${key} is invalid: ${formatErrors(validateExecutionDefinition.errors)}`,
      );
    }
  }
  for (const key of [
    "supportedEnabled",
    "supportedDisabled",
    "unsupportedOmitted",
  ]) {
    if (!validateLaunchConfig(fixture.launchConfigs[key])) {
      throw new Error(
        `Canonical launch config ${key} is invalid: ${formatErrors(validateLaunchConfig.errors)}`,
      );
    }
  }
  if (fixture.launchConfigs.supportedEnabled.fastMode !== true) {
    throw new Error("Canonical launch config must preserve explicit Fast mode true.");
  }
  if (fixture.launchConfigs.supportedDisabled.fastMode !== false) {
    throw new Error("Canonical launch config must preserve explicit Fast mode false.");
  }
  if ("fastMode" in fixture.launchConfigs.unsupportedOmitted) {
    throw new Error("Canonical unsupported launch config must omit Fast mode.");
  }
  const unknownFastModeField = structuredClone(
    fixture.launchConfigs.supportedEnabled,
  );
  unknownFastModeField.fastModePreference = true;
  if (validateLaunchConfig(unknownFastModeField)) {
    throw new Error("Task Monitor launch configs must reject unknown fields.");
  }
  const missingTerminalSupervision = structuredClone(fixture.notStarted);
  delete missingTerminalSupervision.launchPolicy.terminalSupervision;
  if (validateExecutionDefinition(missingTerminalSupervision)) {
    throw new Error(
      "Task Monitor execution definitions must require terminal supervision policy.",
    );
  }

  const missingReasoningEffort = structuredClone(fixture.notStarted);
  delete missingReasoningEffort.executionPlan[0].launchConfiguration.reasoningEffort;
  if (validateExecutionDefinition(missingReasoningEffort)) {
    throw new Error(
      "Task Monitor execution definitions must require reasoning effort.",
    );
  }

  const unknownTerminalSupervisionMode = structuredClone(fixture.notStarted);
  unknownTerminalSupervisionMode.launchPolicy.terminalSupervision.mode = "UNKNOWN";
  if (validateExecutionDefinition(unknownTerminalSupervisionMode)) {
    throw new Error(
      "Task Monitor execution definitions must reject unknown terminal supervision modes.",
    );
  }
  if (serializedFixture !== `${JSON.stringify(fixture, null, 2)}\n`) {
    throw new Error(
      "Canonical fixture must remain stable under an unchanged JSON serialization round trip.",
    );
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const schemas = await loadSchemas();
  writeTypescriptArtifact(options.typescriptOutput, schemas);
  if (options.validateFixture) {
    validateFixture(schemas);
  }
  process.stdout.write("Task Monitor schemas processed\n");
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
