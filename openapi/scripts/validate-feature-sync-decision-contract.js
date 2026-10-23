const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const yaml = require("js-yaml");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const Parser = require("@apidevtools/swagger-parser");

async function main() {
  const root = path.resolve(__dirname, "..");
  const parser = new Parser();
  await parser.dereference(path.join(root, "specs/api/openapi.yaml"));
  const schemas = parser.$refs.get(path.join(root, "specs/schemas/reports.yaml"));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const target = { entityType: "feature", entityId: "11111111-1111-4111-8111-111111111111", title: "Reporting" };
  const v1 = {
    reportType: "FEATURE_SYNC_DECISION", summary: "Legacy decision",
    discrepancies: [{ sourceType: "feature", source: target, description: "Scope differs" }],
    reconciliationOptions: [{ description: "1. Update scope", discrepancyIndices: [0] }],
  };
  const v2 = {
    reportType: "FEATURE_SYNC_DECISION", summary: "Grouped decision",
    decisionGroups: [{
      id: "scope", title: "Reporting scope", summary: "Choose the intended scope.",
      affectedEntities: [target],
      choices: [
        { id: "update", label: "Update scope", isNoChange: false },
        { id: "keep", label: "Keep current scope", isNoChange: true },
      ],
    }],
  };
  let checks = 0;
  function check(schema, value, valid, label) {
    const validate = ajv.compile(schemas[schema]);
    assert.equal(validate(value), valid, label + ": " + ajv.errorsText(validate.errors));
    checks++;
  }
  check("FeatureSyncDecisionReportPayload", v1, true, "legacy payload");
  check("FeatureSyncDecisionReportPayload", v2, true, "grouped payload");
  check("FeatureSyncHandoffReportPayload", { reportType: "FEATURE_SYNC_HANDOFF", summary: "No additional findings", notes: [] }, true, "unchanged terminal handoff");
  for (const field of ["discrepancies", "reconciliationOptions"]) {
    check("FeatureSyncDecisionReportPayload", { ...v2, [field]: v1[field] }, false, "mixed " + field);
  }
  check("FeatureSyncDecisionReportPayload", { ...v1, decisionGroups: [] }, false, "legacy with grouped field");
  check("FeatureSyncDecisionReportPayload", { ...v2, schemaVersion: 2 }, false, "version belongs on envelope");
  check("FeatureSyncDecisionReportPayload", { ...v2, decisionGroups: [] }, false, "empty groups");
  for (const field of ["affectedEntities", "choices"]) {
    check("FeatureSyncDecisionReportPayload", { ...v2, decisionGroups: [{ ...v2.decisionGroups[0], [field]: [] }] }, false, "empty " + field);
  }
  check("FeatureSyncDecisionReportPayload", { ...v2, decisionGroups: [{ ...v2.decisionGroups[0], choices: [v2.decisionGroups[0].choices[0]] }] }, false, "single choice");
  for (const name of ["CreateReportDto", "UpdateReportDto", "ReportDto", "CreateReportResponseDto"]) {
    const base = {
      reportType: "FEATURE_SYNC_DECISION", audience: "PROJECT_VISIBLE",
      id: target.entityId, organizationId: target.entityId, title: "Decision",
      version: 1, createdAt: "2026-09-04T22:00:00Z", expiresAt: "2026-09-05T22:00:00Z", entities: [],
      reportGuidance: { actions: [] },
    };
    check(name, { ...base, payload: v1, schemaVersion: 1 }, true, name + " V1");
    check(name, { ...base, payload: v2, schemaVersion: 2 }, true, name + " V2");
    check(name, { ...base, payload: v1, schemaVersion: 2 }, false, name + " wrong V1 version");
    check(name, { ...base, payload: v2, schemaVersion: 1 }, false, name + " wrong V2 version");
    check(name, { ...base, payload: v2, schemaVersion: 3 }, false, name + " unsupported version");
    check(name, { ...base, payload: v1 }, name === "CreateReportDto", name + " omitted legacy version");
    check(name, { ...base, payload: v2 }, false, name + " omitted grouped version");
    if (name !== "UpdateReportDto") {
      check(name, { ...base, reportType: "FEATURE_SYNC", payload: v2, schemaVersion: 2 }, false, name + " wrong envelope type");
    }
    check(name, { ...base, reportType: "FEATURE_SYNC", payload: { ...v1, reportType: "FEATURE_SYNC", discrepancies: [], reconciliationOptions: [] }, schemaVersion: 1 }, true, name + " terminal");
  }
  const raw = yaml.load(fs.readFileSync(path.join(root, "specs/schemas/reports.yaml"), "utf8"));
  assert.equal(raw.ReportPayload.discriminator.mapping.FEATURE_SYNC_DECISION, "#/FeatureSyncDecisionReportPayload");
  console.log("Feature Sync decision contract: " + checks + " fixtures passed.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
