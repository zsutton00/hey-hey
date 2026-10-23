const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const repositoryRoot = path.resolve(__dirname, "..");
const readYaml = (relativePath) =>
  yaml.load(fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"));

const codingSessions = readYaml("specs/schemas/coding-sessions.yaml");
const proposals = readYaml("specs/schemas/proposals.yaml");
const reports = readYaml("specs/schemas/reports.yaml");
const triggerPayloads = readYaml("specs/schemas/trigger-payloads.yaml");
const reportGuidance = triggerPayloads.SessionMonitorReportGuidance;

const findKeyPaths = (value, key, pathSegments = []) => {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findKeyPaths(entry, key, [...pathSegments, String(index)]),
    );
  }
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([entryKey, entryValue]) => {
    const entryPath = [...pathSegments, entryKey];
    return [
      ...(entryKey === key ? [entryPath.join(".")] : []),
      ...findKeyPaths(entryValue, key, entryPath),
    ];
  });
};

assert.deepEqual(
  reportGuidance.required,
  ["actions"],
  "Session Monitor report guidance must require only workflow actions.",
);
assert.equal(
  reportGuidance.properties.monitorEvaluation,
  undefined,
  "Session Monitor report guidance must not expose terminal consumer routing.",
);
assert.equal(
  reportGuidance.properties.actions.type,
  "array",
  "Session Monitor report guidance must preserve its action vocabulary.",
);

for (const [schemaName, schema] of Object.entries({
  codingSessions,
  proposals,
  reports,
  triggerPayloads,
})) {
  assert.deepEqual(
    findKeyPaths(schema, "x-monitorEvaluation"),
    [],
    `${schemaName} must not contain x-monitorEvaluation metadata.`,
  );
}

assert.deepEqual(
  findKeyPaths(codingSessions, "monitorEvaluation"),
  [],
  "Agent Session terminal policy must not duplicate Task Monitor Review mode.",
);

console.log("Session Monitor report-guidance contract validation passed.");
