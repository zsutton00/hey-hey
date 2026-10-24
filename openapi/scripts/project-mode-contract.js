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

const parseArguments = (argv) => {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument !== "--typescript-output" || !value) {
      throw new Error(`Unknown or incomplete argument ${argument}.`);
    }
    options.typescriptOutput = path.resolve(value);
    index += 1;
  }
  return options;
};

const toRuntimeJsonSchema = (value) => {
  if (Array.isArray(value)) {
    return value.map(toRuntimeJsonSchema);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }

  const entries = Object.entries(value).map(([key, entry]) => [
    key === "x-propertyNames" ? "propertyNames" : key,
    toRuntimeJsonSchema(entry),
  ]);
  return Object.fromEntries(entries);
};

const loadSchemas = async () => {
  const agentBridge = await SwaggerParser.dereference(agentBridgeSpecPath);
  const names = [
    "ProjectModeFiles",
    "ProjectModeSettings",
    "ProjectModeSelection",
    "ProjectModeSnapshot",
  ];
  return Object.fromEntries(
    names.map((name) => {
      const schema = agentBridge.components.schemas[name];
      if (!schema) {
        throw new Error(
          `${name} must be explicitly exported by the Agent Bridge specification.`,
        );
      }
      return [name, toRuntimeJsonSchema(schema)];
    }),
  );
};

const validateSchemas = (schemas) => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateFiles = ajv.compile(schemas.ProjectModeFiles);
  const validateSettings = ajv.compile(schemas.ProjectModeSettings);
  const validateSelection = ajv.compile(schemas.ProjectModeSelection);
  const validateSnapshot = ajv.compile(schemas.ProjectModeSnapshot);
  const modeId = "00000000-0000-4000-8000-000000000001";
  const validFiles = {
    schemaVersion: "project-mode-files.v1",
    files: {
      "MODE.md": "Use the project-specific review discipline.",
      "references/checklist.md": "Check the public boundary.",
    },
  };
  if (!validateFiles(validFiles)) {
    throw new Error(
      `Valid ProjectModeFiles rejected: ${JSON.stringify(validateFiles.errors)}`,
    );
  }

  const invalidBundles = [
    { schemaVersion: "project-mode-files.v1", files: {} },
    {
      schemaVersion: "project-mode-files.v1",
      files: { "MODE.md": "ok", "../escape.md": "unsafe" },
    },
    {
      schemaVersion: "project-mode-files.v1",
      files: { "MODE.md": "ok", "references\\escape.md": "unsafe" },
    },
    {
      schemaVersion: "project-mode-files.v1",
      files: { "MODE.md": "ok" },
      executable: true,
    },
  ];
  for (const bundle of invalidBundles) {
    if (validateFiles(bundle)) {
      throw new Error(
        `Invalid ProjectModeFiles accepted: ${JSON.stringify(bundle)}`,
      );
    }
  }

  for (const enabled of [true, false]) {
    const settings = {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled },
    };
    if (!validateSettings(settings)) {
      throw new Error(
        `Valid ProjectModeSettings rejected: ${JSON.stringify(validateSettings.errors)}`,
      );
    }
  }

  for (const eligibleWorkItemTypeKeys of [["STANDARD"], ["STANDARD", "BUG"]]) {
    const settings = {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: false },
      eligibleWorkItemTypeKeys,
    };
    if (!validateSettings(settings)) {
      throw new Error(
        `Valid ProjectModeSettings rejected: ${JSON.stringify(validateSettings.errors)}`,
      );
    }
  }

  for (const sessionRole of [
    "implementation",
    "research",
    "planning",
    "review",
  ]) {
    if (
      !validateSettings({
        schemaVersion: "project-mode-settings.v1",
        projectAssistant: { enabled: false },
        sessionRole,
      })
    ) {
      throw new Error(`Valid session role rejected: ${sessionRole}`);
    }
  }
  for (const sessionRole of ["unknown", "", null, false, 42, [], {}]) {
    if (
      validateSettings({
        schemaVersion: "project-mode-settings.v1",
        projectAssistant: { enabled: false },
        sessionRole,
      })
    ) {
      throw new Error("Invalid session role accepted");
    }
  }

  const invalidSettings = [
    {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: [],
    },
    {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: true },
      eligibleWorkItemTypeKeys: [""],
    },
    { schemaVersion: "project-mode-settings.v1" },
    { schemaVersion: "project-mode-settings.v1", projectAssistant: {} },
    {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: "true" },
    },
    {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: true, allowEdgeUpdates: true },
    },
    {
      schemaVersion: "project-mode-settings.v1",
      projectAssistant: { enabled: true },
      toolGrants: ["Bash"],
    },
    {
      schemaVersion: "project-mode-settings.v2",
      projectAssistant: { enabled: true },
    },
  ];
  for (const settings of invalidSettings) {
    if (validateSettings(settings)) {
      throw new Error(
        `Invalid ProjectModeSettings accepted: ${JSON.stringify(settings)}`,
      );
    }
  }

  const validSelection = {
    schemaVersion: "project-mode-selection.v1",
    modeId,
  };
  if (!validateSelection(validSelection)) {
    throw new Error(
      `Valid ProjectModeSelection rejected: ${JSON.stringify(validateSelection.errors)}`,
    );
  }

  const validSnapshot = {
    schemaVersion: "project-mode-snapshot.v1",
    modeId,
    catalogDescription: "Review public boundaries before implementation.",
    applicableWorkItemTypeKeys: ["STANDARD"],
    files: validFiles,
    snapshotHash: "a".repeat(64),
  };
  if (!validateSnapshot(validSnapshot)) {
    throw new Error(
      `Valid ProjectModeSnapshot rejected: ${JSON.stringify(validateSnapshot.errors)}`,
    );
  }

  const validSnapshotV2 = {
    ...validSnapshot,
    schemaVersion: "project-mode-snapshot.v2",
    projectAssistant: { enabled: false },
  };
  if (!validateSnapshot(validSnapshotV2)) {
    throw new Error(
      `Valid v2 ProjectModeSnapshot rejected: ${JSON.stringify(validateSnapshot.errors)}`,
    );
  }

  for (const sessionRole of schemas.ProjectModeSettings.properties.sessionRole
    .allOf[0].enum) {
    if (
      !validateSnapshot({
        ...validSnapshotV2,
        schemaVersion: "project-mode-snapshot.v3",
        sessionRole,
      })
    ) {
      throw new Error(`Valid v3 snapshot role rejected: ${sessionRole}`);
    }
  }

  for (const snapshot of [
    {
      ...validSnapshotV2,
      schemaVersion: "project-mode-snapshot.v3",
      sessionRole: "invalid",
    },
    { ...validSnapshot, snapshotHash: "not-a-sha256" },
    { ...validSnapshot, untrustedRuntimeHook: "node install.js" },
    { ...validSnapshotV2, projectAssistant: { enabled: "no" } },
    {
      ...validSnapshotV2,
      projectAssistant: { enabled: true, workItemProposalMode: "all" },
    },
  ]) {
    if (validateSnapshot(snapshot)) {
      throw new Error(
        `Invalid ProjectModeSnapshot accepted: ${JSON.stringify(snapshot)}`,
      );
    }
  }
};

const writeTypescriptArtifact = (outputPath, schemas) => {
  if (!outputPath) return;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const source = [
    "/* This file is generated from OpenAPI by scripts/project-mode-contract.js. */",
    "/* Do not edit by hand. */",
    "",
    `export const projectModeFilesJsonSchema = ${JSON.stringify(schemas.ProjectModeFiles, null, 2)} as const;`,
    "",
    `export const projectModeSettingsJsonSchema = ${JSON.stringify(schemas.ProjectModeSettings, null, 2)} as const;`,
    "",
    `export const projectModeSelectionJsonSchema = ${JSON.stringify(schemas.ProjectModeSelection, null, 2)} as const;`,
    "",
    `export const projectModeSnapshotJsonSchema = ${JSON.stringify(schemas.ProjectModeSnapshot, null, 2)} as const;`,
    "",
  ].join("\n");
  fs.writeFileSync(outputPath, source);
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const schemas = await loadSchemas();
  validateSchemas(schemas);
  writeTypescriptArtifact(options.typescriptOutput, schemas);
  process.stdout.write("Project MODE schemas processed\n");
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
