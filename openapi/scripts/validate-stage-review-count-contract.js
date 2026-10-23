const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const Ajv = require("ajv");
const read = (name) => yaml.load(fs.readFileSync(path.join(__dirname, "../specs/schemas", name), "utf8"));
const completion = read("external-agent-completion.yaml").PlanShapingProposedStagesCompletionPayload;
const conversations = read("conversations.yaml");
const field = conversations.PlanGenerationStageReviewPayload;
const ajv = new Ajv();
for (const schema of [completion, field]) {
  const validate = ajv.compile(schema);
  for (const count of [0, 1, 2]) assert.equal(validate({ expectedStageCount: count }), true);
  for (const value of [{}, { expectedStageCount: -1 }, { expectedStageCount: 1.5 }, { expectedStageCount: "2" }, { expectedStageCount: 2, revisionId: "old" }]) {
    assert.equal(validate(value), false, JSON.stringify(value));
  }
}
assert.equal(conversations.UIElement.discriminator.mapping.plan_generation_stage_review, "#/PlanGenerationStageReviewElement");
assert.ok(conversations.UIElement.properties.payload.oneOf.some((item) => item.$ref === "#/PlanGenerationStageReviewPayload"));
assert.deepEqual(conversations.PlanGenerationStageReviewElement.allOf[1].required, ["payload"]);
assert.equal(conversations.PlanGenerationStageReviewElement.allOf[1].properties.payload.$ref, "#/PlanGenerationStageReviewPayload");
console.log("Stage completion and review field count contracts validated");
