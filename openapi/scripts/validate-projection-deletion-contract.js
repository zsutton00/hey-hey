const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const readYaml = (relativePath) =>
  yaml.load(fs.readFileSync(path.join(root, relativePath), "utf8"));

const graph = readYaml("specs/graphs/openapi.yaml");
const embeddings = readYaml("specs/embeddings/openapi.yaml");
const api = readYaml("specs/api/openapi.yaml");
const schemas = readYaml("specs/schemas/projection-deletion.yaml");

const commandFields = [
  "organizationId",
  "markerId",
  "irreversibleClosureAt",
  "deletionDeadline",
];
const resultFields = [
  ...commandFields,
  "tombstoneRecorded",
  "contentVerificationCompleted",
];
const responseRefs = {
  200: "ProjectionDeletionResult",
  400: "ProjectionDeletionValidationErrorResponse",
  409: "ProjectionDeletionIdentityConflictResponse",
  503: "ProjectionDeletionRetryableFailureResponse",
};

function sorted(values) {
  return [...values].sort();
}

function assertOperation(spec, expectedPath, expectedAudience) {
  const matchingPaths = Object.entries(spec.paths).filter(([route, pathItem]) =>
    route.endsWith("/projection-deletion") ||
    pathItem.post?.operationId === "deleteOrganizationProjection",
  );
  assert.deepEqual(
    matchingPaths.map(([route]) => route),
    [expectedPath],
    "projection deletion must have one documented primary route and no aliases",
  );

  const operation = spec.paths[expectedPath].post;
  assert.deepEqual(operation.security, [{ BearerAuth: [] }]);
  assert.deepEqual(operation["x-required-jwt-claims"], {
    scopes: ["organization:projection:delete"],
    audience: expectedAudience,
  });
  assert.equal(
    operation.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/ProjectionDeletionCommand",
  );
  assert.ok(operation.responses["401"], "authentication failure must be documented");

  for (const [status, schemaName] of Object.entries(responseRefs)) {
    assert.equal(
      operation.responses[status].content["application/json"].schema.$ref,
      `#/components/schemas/${schemaName}`,
    );
  }
}

assertOperation(
  graph,
  "/organizations/{organizationId}/projection-deletion",
  "graph-service",
);
assertOperation(
  embeddings,
  "/orgs/{organizationId}/projection-deletion",
  "embeddings-service",
);

assert.deepEqual(sorted(schemas.ProjectionDeletionIdentity.required), sorted(commandFields));
assert.deepEqual(sorted(schemas.ProjectionDeletionCommand.required), sorted(commandFields));
assert.deepEqual(sorted(schemas.ProjectionDeletionResult.required), sorted(resultFields));
assert.deepEqual(schemas.ProjectionDeletionResult.properties.tombstoneRecorded.enum, [true]);
assert.deepEqual(
  schemas.ProjectionDeletionResult.properties.contentVerificationCompleted.enum,
  [true],
);
assert.deepEqual(
  schemas.ProjectionDeletionValidationErrorResponse.properties.errorCode.enum,
  ["PROJECTION_DELETION_VALIDATION_FAILED"],
);
assert.deepEqual(
  schemas.ProjectionDeletionIdentityConflictResponse.properties.errorCode.enum,
  ["PROJECTION_DELETION_IDENTITY_CONFLICT"],
);
assert.deepEqual(
  schemas.ProjectionDeletionRetryableFailureResponse.properties.errorCode.enum,
  ["PROJECTION_DELETION_RETRYABLE_FAILURE"],
);
assert.deepEqual(
  schemas.ProjectionDeletionRetryableFailureResponse.properties.retryable.enum,
  [true],
);

for (const spec of [api, graph, embeddings]) {
  for (const schemaName of [
    "ProjectionDeletionIdentity",
    "ProjectionDeletionCommand",
    "ProjectionDeletionResult",
    "ProjectionDeletionValidationErrorResponse",
    "ProjectionDeletionIdentityConflictResponse",
    "ProjectionDeletionRetryableFailureResponse",
  ]) {
    assert.equal(
      spec.components.schemas[schemaName].$ref,
      `../schemas/projection-deletion.yaml#/${schemaName}`,
    );
  }
}

console.log("Projection deletion contract is canonical and aligned.");
