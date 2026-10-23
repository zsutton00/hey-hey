const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const load = (file) => yaml.load(fs.readFileSync(path.resolve(__dirname, '../specs', file), 'utf8'));

const evalRuns = load('schemas/eval-runs.yaml');
const reports = load('schemas/reports.yaml');
const proposals = load('schemas/proposals.yaml');
const events = load('schemas/events.yaml').components.schemas;
const bridge = load('agent-bridge/openapi.yaml').components.schemas;

const measurement = evalRuns.EvalMeasurement;
assert.deepEqual(measurement.required, ['scope'], 'Only the scope of a measurement may be required');
for (const field of ['elapsedMs', 'inputTokens', 'outputTokens', 'toolCalls', 'cost']) {
  assert.ok(measurement.properties[field], `Measurement must define ${field}`);
  assert.equal('default' in measurement.properties[field], false, `${field} must not default to 0`);
}
assert.ok(evalRuns.EvalCostMeasurement.required.includes('basis'), 'Cost must identify its basis');
assert.deepEqual(evalRuns.EvalMeasurementScope.enum, ['TARGET_PREPARATION', 'TARGET_HANDLER', 'JUDGE', 'COORDINATOR']);

const forbidden = ['checks', 'rubric', 'grading'];
for (const field of forbidden) {
  assert.equal(field in evalRuns.EvalCaseTarget.properties, false, `Target input must not carry ${field}`);
}
assert.deepEqual(evalRuns.EvalCaseGrading.required, ['checks', 'rubric']);
assert.equal('enum' in evalRuns.EvalRubricDimension.properties.key, false, 'Rubric dimensions are data, not an enum');
assert.ok(evalRuns.EvalRunCaseInput.properties.grading && evalRuns.EvalRunCaseInput.properties.target);

const payloads = {
  EVAL_RUN: evalRuns.EvalRunReportPayload,
  EVAL_ATTEMPT: evalRuns.EvalAttemptReportPayload,
  EVAL_HUMAN_REVIEW: evalRuns.EvalHumanReviewReportPayload,
};
const body = (payload) => payload.allOf[1];
for (const [reportType, payload] of Object.entries(payloads)) {
  assert.ok(reports.ReportType.enum.includes(reportType), `ReportType must include ${reportType}`);
  assert.deepEqual(body(payload).properties.reportType.enum, [reportType]);
  assert.ok(reports.ReportPayload.discriminator.mapping[reportType], `ReportPayload must map ${reportType}`);
  for (const dto of ['CreateReportDtoOther', 'ReportDtoOther']) {
    assert.ok(reports[dto].allOf[1].properties.reportType.enum.includes(reportType), `${dto} must accept ${reportType}`);
  }
}
for (const removed of ['EvalRun', 'EvalAttempt', 'EvalHumanReview', 'EvalRetainedOutput', 'EvalRunDetail', 'EvalAttemptDetail']) {
  assert.equal(removed in evalRuns, false, `${removed} is stored as a report, not a standalone record`);
}
for (const snapshot of ['projectSnapshot', 'snapshot', 'replay']) {
  assert.equal(snapshot in body(payloads.EVAL_RUN).properties, false, `Run must not model ${snapshot}`);
}
const attempt = body(payloads.EVAL_ATTEMPT).properties;
assert.equal(attempt.targetSessionId.type, 'string', 'Target session is a plain id, not an attachment');
assert.ok(attempt.automatedAssessment && attempt.measurements);
const review = body(payloads.EVAL_HUMAN_REVIEW).properties;
assert.equal('automatedAssessment' in review, false, 'Human review never carries the automated assessment');
assert.equal('humanReview' in evalRuns.EvalAutomatedAssessment.properties, false);
assert.equal(reports.CreateReportDtoBase.properties.neverExpires.type, 'boolean', 'Report create can declare no expiry');
assert.equal(reports.ReportDto.properties.expiresAt.nullable, true, 'Reports that never expire read back a null expiresAt');

const api = load('api/openapi.yaml');
const operationIds = Object.values(api.paths).flatMap((item) => Object.values(item).map((op) => op && op.operationId));
assert.ok(operationIds.includes('launchEvalRun'));
for (const removed of ['listEvalRuns', 'getEvalRun', 'saveEvalHumanReview', 'updateEvalAttemptProgress', 'submitEvalAttemptMeasurement', 'submitEvalRunMeasurement', 'submitEvalAutomatedAssessment']) {
  assert.equal(operationIds.includes(removed), false, `${removed} is served by the report operations`);
}

const reportRead = reports.ReportDto.properties;
const proposalRead = proposals.ProposalResponseDto.properties;
assert.ok(reportRead.ragEnabled && proposalRead.ragEnabled, 'Reports and proposals expose ragEnabled');
assert.ok(proposalRead.applicationEligible, 'Proposals expose a separate applicationEligible');
assert.equal('applicationEligible' in reportRead, false);
assert.equal('ragEnabled' in reports.CreateReportDtoBase.properties, false, 'ragEnabled is not client-settable');
assert.equal('ragEnabled' in proposals.CreateProposalDto.properties, false, 'ragEnabled is not client-settable');
assert.equal('applicationEligible' in proposals.CreateProposalDto.properties, false, 'applicationEligible is not client-settable');
assert.ok(proposalRead.retainedOriginalTargetContent, 'Proposals retain original target content for eval diffs');
assert.equal('retainedOriginalTargetContent' in proposals.CreateProposalDto.properties, false);
for (const [name, props] of [
  ['CreateReportDtoBase', reports.CreateReportDtoBase.properties],
  ['ReportDto', reportRead],
  ['CreateProposalDto', proposals.CreateProposalDto.properties],
  ['ProposalResponseDto', proposalRead],
]) {
  assert.equal('evalAttemptId' in props, false, `${name} must not carry an eval attempt id`);
}
assert.ok(
  evalRuns.EvalRecordedAttempt.required.includes('targetSessionId'),
  'Each recorded attempt names the target session its output is written under',
);

const payloadOf = (name) => events[name].allOf[1];
assert.ok(payloadOf('ReportCreatedEventPayload').required.includes('shouldProcess'));
assert.ok(payloadOf('ProposalApprovedEventPayload').required.includes('shouldProcess'));
const mapping = events.ExecutionContext.discriminator.mapping;
assert.ok(mapping['eval_run.updated'] && mapping['eval_attempt.updated']);
assert.ok(events.PayloadType.enum.includes('eval_run.updated') && events.PayloadType.enum.includes('eval_attempt.updated'));

const launch = bridge.LocalRunEvalPromptPayload;
assert.ok(launch.required.includes('userMessage'), 'Launch keeps its existing fields');
assert.ok(launch.required.includes('evalRunId') && launch.required.includes('attempts'));

console.log('Eval run contract validated.');
