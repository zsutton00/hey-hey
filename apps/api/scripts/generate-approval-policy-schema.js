const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveOpenapiRoot } = require('./openapi-root');
const { resolveGeneratedRoot } = require('./generated-root');
const schemas = yaml.load(
  fs.readFileSync(
    path.join(resolveOpenapiRoot(), 'specs/schemas/approval-policies.yaml'),
    'utf8',
  ),
);
const names = [
  'ProposalApprovalExplanation',
  'ProposalApprovalExplanationEvidence',
  'ProjectApprovalPolicyEffectiveConditions',
  'ProjectApprovalPolicyRuleSource',
  'ProjectApprovalPolicyRequirement',
  'ProjectApprovalPolicyReplaceRequest',
  'ProjectApprovalPolicyRestoreRequest',
  'ProjectApprovalPolicyRule',
  'ProjectApprovalPolicyConditions',
  'ProjectApprovalPolicyAuthor',
  'ProjectApprovalPolicyAction',
  'ProjectApprovalPolicyChangeSelector',
];
function toJsonSchema(value) {
  if (Array.isArray(value)) {
    return value.map(toJsonSchema);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const { nullable, ...rest } = value;
  const converted = Object.fromEntries(
    Object.entries(rest).map(([key, entry]) => [key, toJsonSchema(entry)]),
  );
  return nullable ? { anyOf: [converted, { type: 'null' }] } : converted;
}
const definitions = Object.fromEntries(
  names.map((name) => [name, schemas[name]]),
);
const schema = JSON.parse(
  JSON.stringify(toJsonSchema({ definitions })).replace(
    /#\/(ProjectApprovalPolicy|ProposalApprovalExplanation)/g,
    '#/definitions/$1',
  ),
);
fs.writeFileSync(
  path.join(resolveGeneratedRoot(), 'approval-policy.schema.ts'),
  '// Generated from OpenAPI. Do not edit.\nexport const approvalPolicySchema = ' +
    JSON.stringify(schema, null, 2) +
    ' as const;\n',
);
