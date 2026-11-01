import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SwaggerParser = require("../openapi/node_modules/@apidevtools/swagger-parser");
const yaml = require("../openapi/node_modules/js-yaml");
const {
  checkComposition,
} = require("../openapi/scripts/check-controller-schema-composition");
const {
  CONTROLLER_ROOT_DEFINITIONS,
} = require("../openapi/scripts/generate-controller-action-contract");
const bundled = await SwaggerParser.bundle(
  new URL("../openapi/specs/agent-bridge/openapi.yaml", import.meta.url)
    .pathname,
);

test("all generated controller roots accept the corrected schema compositions", () => {
  assert.deepEqual(checkComposition(bundled, CONTROLLER_ROOT_DEFINITIONS), []);
});

test("the original Verify Feature contradiction reports schema and forbidden fields", () => {
  const document = structuredClone(bundled);
  document.components.schemas.RunCreatePayloadVerifyFeature = {
    allOf: [
      {
        type: "object",
        required: ["promptType", "entity"],
        properties: {
          promptType: { type: "string" },
          entity: { type: "object" },
        },
      },
      { $ref: "#/components/schemas/VerifyFeaturePromptPayload" },
    ],
  };
  const errors = checkComposition(document, CONTROLLER_ROOT_DEFINITIONS).join(
    "\n",
  );
  assert.match(
    errors,
    /RunCreatePayloadVerifyFeature: field 'promptType'.*VerifyFeaturePromptPayload.*additionalProperties:false/,
  );
  assert.match(errors, /field 'entity'/);
});

test("a newly added variant cannot bypass the schema walk", () => {
  const document = structuredClone(bundled);
  document.components.schemas.NewLaunchVariant = {
    allOf: [
      { type: "object", properties: { newLaunchField: { type: "string" } } },
      { type: "object", additionalProperties: false },
    ],
  };
  document.components.schemas.RunCreatePayload.oneOf.push({
    $ref: "#/components/schemas/NewLaunchVariant",
  });
  assert.match(
    checkComposition(document, CONTROLLER_ROOT_DEFINITIONS).join("\n"),
    /NewLaunchVariant: field 'newLaunchField'/,
  );
});

test("changed body properties and requirements cannot silently escape a closed envelope", () => {
  const document = structuredClone(bundled);
  const body = document.components.schemas.VerifyFeaturePromptPayload;
  body.properties.newContext = { type: "string" };
  body.required.push("newContext");
  const errors = checkComposition(document, CONTROLLER_ROOT_DEFINITIONS).join(
    "\n",
  );
  assert.match(errors, /field 'newContext' must match/);
  assert.match(errors, /must require body field 'newContext'/);
});

test("changing a body constraint requires the envelope to carry the same definition", () => {
  const document = structuredClone(bundled);
  document.components.schemas.VerifyFeaturePromptPayload.properties.concern.minLength = 10;
  assert.match(
    checkComposition(document, CONTROLLER_ROOT_DEFINITIONS).join("\n"),
    /field 'concern' must match/,
  );
});

test("the required generate:verify path rejects a contradictory source before freshness checks", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "controller-composition-"),
  );
  try {
    for (const directory of ["specs", "scripts", "shared"]) {
      if (!fs.existsSync(path.join(root, "openapi", directory))) continue;
      fs.cpSync(
        path.join(root, "openapi", directory),
        path.join(temporary, directory),
        { recursive: true },
      );
    }
    fs.symlinkSync(
      path.join(root, "openapi/node_modules"),
      path.join(temporary, "node_modules"),
      "dir",
    );
    const sourcePath = path.join(temporary, "specs/schemas/run-payloads.yaml");
    const source = yaml.load(fs.readFileSync(sourcePath, "utf8"));
    source.RunCreatePayloadVerifyFeature = {
      allOf: [
        {
          type: "object",
          required: ["promptType", "entity"],
          properties: {
            promptType: { type: "string" },
            entity: { type: "object" },
          },
        },
        { $ref: "./trigger-payloads.yaml#/VerifyFeaturePromptPayload" },
      ],
    };
    fs.writeFileSync(sourcePath, yaml.dump(source));
    const result = spawnSync(
      process.execPath,
      ["scripts/generate-contracts.mjs", "--verify"],
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, HEY_HEY_OPENAPI_ROOT: temporary },
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stdout + result.stderr,
      /Controller schema composition failed/,
    );
    assert.match(result.stdout + result.stderr, /field 'promptType'/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
