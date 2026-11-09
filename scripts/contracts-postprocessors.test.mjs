import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const typescript = createRequire(
  new URL("../packages/contracts/package.json", import.meta.url),
)("typescript");
const postprocessAllOfOverrides = require("../packages/contracts/scripts/postprocess-allof-overrides.cjs");
const postprocessModelBarrels = require("../packages/contracts/scripts/postprocess-model-barrels.cjs");
const { resolveOpenapiRoot } = require("./openapi-source.cjs");
const generatedRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "hey-hey-contract-postprocess-test-"),
);

after(() => fs.rmSync(generatedRoot, { recursive: true, force: true }));

test("model namespaces preserve inherited enums and declaration-order union aliases", () => {
  const root = fs.mkdtempSync(path.join(generatedRoot, "enum-aliases-"));
  const models = path.join(root, "api", "models");
  fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(
    path.join(models, "enums.ts"),
    `
export const FirstEnum = {
    First: 'FIRST'
} as const;
export type FirstEnum = typeof FirstEnum[keyof typeof FirstEnum];
export const SecondEnum = {
    Second: 'SECOND'
} as const;
export type SecondEnum = typeof SecondEnum[keyof typeof SecondEnum];
`,
  );
  fs.writeFileSync(
    path.join(models, "base.ts"),
    `
export interface Base {
    'state': SecondEnum | FirstEnum;
    'unrelated': FirstEnumSuffix;
}
`,
  );
  fs.writeFileSync(
    path.join(models, "marker.ts"),
    "export interface Marker {}\n",
  );
  fs.writeFileSync(
    path.join(models, "identifiers.ts"),
    `
import type { ServiceId } from '../../../brands.js';
export interface Identifiers {
    /** Unique identifier for a project (branded type) */
    'projectId': string;
    /** Unique identifier for a service (branded type) */
    'serviceId': ServiceId;
}
`,
  );
  fs.writeFileSync(
    path.join(models, "child.ts"),
    `
import type { Base } from './base.js';
import type { Marker } from './marker.js';
export type Child = Base & Marker;
`,
  );

  const run = () =>
    execFileSync(process.execPath, [
      path.resolve("packages/contracts/scripts/postprocess-brands.cjs"),
      root,
      "api",
    ]);
  run();
  const child = fs.readFileSync(path.join(models, "child.ts"), "utf8");
  assert.match(child, /export const StateEnum = FirstEnum;/);
  assert.match(child, /export type StateEnum = FirstEnum;/);
  assert.doesNotMatch(child, /UnrelatedEnum/);
  const enumSource = fs.readFileSync(path.join(models, "enums.ts"), "utf8");
  const compiled = typescript.transpileModule(enumSource, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS },
  });
  const exports = {};
  runInNewContext(compiled.outputText, { exports });
  assert.equal(exports.FirstEnum.FIRST, exports.FirstEnum.First);
  assert.deepEqual(Object.values(exports.FirstEnum), ["FIRST"]);
  assert.equal(JSON.stringify(exports.FirstEnum.FIRST), '"FIRST"');
  const identifiers = fs.readFileSync(
    path.join(models, "identifiers.ts"),
    "utf8",
  );
  assert.match(identifiers, /'projectId': ProjectId;/);
  assert.match(identifiers, /'serviceId': string;/);
  run();
  assert.equal(fs.readFileSync(path.join(models, "child.ts"), "utf8"), child);
});

test("required nullable fields and boolean discriminators retain their source semantics", () => {
  const root = fs.mkdtempSync(path.join(generatedRoot, "source-semantics-"));
  const sourceRoot = path.join(root, "source");
  fs.mkdirSync(path.join(sourceRoot, "specs", "api"), { recursive: true });
  const models = path.join(root, "generated", "models");
  fs.mkdirSync(path.join(sourceRoot, "specs", "schemas"), { recursive: true });
  fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "package.json"), "{}");
  fs.symlinkSync(
    path.join(resolveOpenapiRoot(), "node_modules"),
    path.join(sourceRoot, "node_modules"),
    "dir",
  );
  fs.writeFileSync(
    path.join(sourceRoot, "specs", "schemas", "fixture.yaml"),
    `
Parent:
  type: object
  properties:
    sections: { type: array, nullable: true, items: { type: string } }
Payload:
  oneOf:
    - allOf:
        - $ref: '#/Parent'
        - type: object
          required: [sections]
Success:
  type: object
  properties:
    ok: { type: boolean, enum: [true] }
Failure:
  type: object
  properties:
    ok: { type: boolean, enum: [false] }
Response:
  oneOf: [{ $ref: '#/Success' }, { $ref: '#/Failure' }]
  discriminator:
    propertyName: ok
    mapping: { 'true': '#/Success', 'false': '#/Failure' }
Action:
  type: object
  required: [kind]
  properties:
    kind: { type: string, enum: [run, stop] }
  discriminator:
    propertyName: kind
    mapping: { run: '#/RunAction' }
RunAction:
  allOf: [{ $ref: '#/Action' }]
  x-discriminator-value: run
Envelope:
  type: object
  properties:
    data: {}
Choice:
  oneOf: [{ $ref: '#/Option' }]
  discriminator:
    propertyName: kind
    mapping: { first: '#/Option', second: '#/Option' }
Option:
  type: object
  required: [kind]
  properties:
    kind: { type: string, enum: [first, second] }
ImplicitChoice:
  oneOf: [{ $ref: '#/RunAction' }]
  discriminator:
    propertyName: kind
`,
  );
  fs.writeFileSync(
    path.join(sourceRoot, "specs", "api", "openapi.yaml"),
    `
components:
  schemas:
    Envelope: { $ref: '../schemas/fixture.yaml#/Envelope' }
paths:
  /result:
    get:
      operationId: readData
      responses:
        '200':
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/Envelope'
                  - type: object
                    properties:
                      data: { type: string }
`,
  );
  const sources = {
    "parent.ts":
      "export interface Parent {\n 'sections'?: string[] | null;\n}\n",
    "payload-one-of.ts":
      "import type { Parent } from './parent';\nexport interface PayloadOneOf extends Parent {}\n",
    "success.ts":
      "export interface Success {\n 'ok': boolean;\n 'value': string;\n}\n",
    "failure.ts":
      "export interface Failure {\n 'ok': boolean;\n 'error': string;\n}\n",
    "action.ts": "export interface Action {\n 'kind': 'run' | 'stop';\n}\n",
    "run-action.ts":
      "import type { Action } from './action';\nexport interface RunAction extends Action {}\n",
    "envelope.ts": "export interface Envelope {\n 'data'?: unknown;\n}\n",
    "read-data200-response-all-of.ts":
      "export interface ReadData200ResponseAllOf {\n 'data'?: string;\n}\n",
    "read-data200-response.ts":
      "import type { Envelope } from './envelope';\nimport type { ReadData200ResponseAllOf } from './read-data200-response-all-of';\nexport interface ReadData200Response extends Envelope, ReadData200ResponseAllOf {}\n",
    "option.ts": "export interface Option {\n 'kind': 'first' | 'second';\n}\n",
    "choice.ts":
      "import type { Option } from './option';\nexport type Choice = { kind: 'first' } & Option | { kind: 'second' } & Option;\n",
    "implicit-choice.ts":
      "import type { RunAction } from './run-action';\nexport type ImplicitChoice = RunAction;\n",
    "response.ts":
      "import type { Success } from './success';\nimport type { Failure } from './failure';\nexport type Response = { ok: 'true' } & Success | { ok: 'false' } & Failure;\n",
    "consumer.ts": `
import type { PayloadOneOf } from './payload-one-of';
import type { Response } from './response';
import type { RunAction } from './run-action';
import { ActionDiscriminatorValues } from './action';
import type { ReadData200Response } from './read-data200-response';
import type { Choice } from './choice';
import type { Option } from './option';
import { ImplicitChoiceDiscriminatorValues } from './implicit-choice';
const nullable: PayloadOneOf = { sections: null };
// @ts-expect-error The source requires sections even though its parent does not.
const missing: PayloadOneOf = {};
function read(result: Response): string {
  return result.ok ? result.value : result.error;
}
function actionKind(action: RunAction): 'run' { return action.kind; }
const kinds: readonly ['run'] = ActionDiscriminatorValues;
function readEnvelope(response: ReadData200Response): string | undefined { return response.data; }
function choose(option: Option): Choice { return option; }
const implicitKinds: readonly ['run'] = ImplicitChoiceDiscriminatorValues;
`,
  };
  for (const [name, source] of Object.entries(sources)) {
    fs.writeFileSync(path.join(models, name), source);
  }
  postprocessAllOfOverrides(path.join(root, "generated"), sourceRoot);
  const program = typescript.createProgram([path.join(models, "consumer.ts")], {
    strict: true,
    noEmit: true,
    types: [],
    skipLibCheck: true,
  });
  const diagnostics = typescript.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) =>
      typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
  );
});

test("ApiResponse payloads remain specific in shared allOf models", () => {
  const modelsDirectory = path.join(generatedRoot, "models");
  fs.mkdirSync(modelsDirectory, { recursive: true });
  const apiResponseFile = path.join(modelsDirectory, "api-response.ts");
  fs.writeFileSync(
    apiResponseFile,
    "export interface ApiResponse {\n    'data'?: any;\n}\n",
  );

  postprocessAllOfOverrides(generatedRoot, resolveOpenapiRoot());

  assert.match(fs.readFileSync(apiResponseFile, "utf8"), /'data'\?: unknown;/);
});

test("generated API imports resolve through the shared model barrel", () => {
  const targetDirectory = path.join(generatedRoot, "agent-bridge");
  fs.mkdirSync(path.join(targetDirectory, "models"), { recursive: true });
  fs.writeFileSync(
    path.join(targetDirectory, "index.ts"),
    'export * from "./models.js";\n',
  );
  fs.writeFileSync(
    path.join(targetDirectory, "models", "index.ts"),
    "export {};\n",
  );

  postprocessModelBarrels(targetDirectory, "agent-bridge");

  assert.equal(
    fs.readFileSync(path.join(targetDirectory, "models.ts"), "utf8"),
    'export * from "./models/index.js";\n',
  );
  assert.match(
    fs.readFileSync(path.join(targetDirectory, "index.ts"), "utf8"),
    /export \* from "\.\/models\/index\.js";/,
  );
});
