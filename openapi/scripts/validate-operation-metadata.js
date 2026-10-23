#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const SPEC_PATH = path.resolve(__dirname, '../specs/api/openapi.yaml');
const STANDALONE_SPEC_PATHS = [
  SPEC_PATH,
  path.resolve(__dirname, '../specs/agents/openapi.yaml'),
  path.resolve(__dirname, '../specs/embeddings/openapi.yaml'),
  path.resolve(__dirname, '../specs/graphs/openapi.yaml'),
  path.resolve(__dirname, '../specs/local/openapi.yaml'),
];
const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

const TAG_DESCRIPTIONS = {
  Auth: 'Authentication and browser session operations',
  DemoSandboxes: 'Demo sandbox admission and resume operations',
  Organizations: 'Organization lifecycle and membership operations',
  PrivateBetaAccess: 'Private beta access administration',
  PaymentProviderWebhooks: 'Payment provider webhook operations',
  Webhooks: 'Third-party webhook operations',
  Entities: 'Entity lookup operations',
  EntityContext: 'Entity context and related work-item operations',
  Search: 'Entity and project search operations',
  Topology: 'Project topology operations',
  Initiatives: 'Initiative operations',
  Projects: 'Project and project membership operations',
  Integrations: 'Project integration operations',
  Conversations: 'Conversation and message operations',
  InteractionFlows: 'Interaction flow operations',
  Events: 'Event notification and connection operations',
  Artifacts: 'Artifact operations',
  Tags: 'Tag operations',
  Development: 'Development and LLM test operations',
  Workflows: 'Workflow operations',
  DebugAdmin: 'Debug and administrative operations',
  Help: 'Help content operations',
  DesignDocs: 'Design document operations',
  Plans: 'Plan and plan execution operations',
  Suggestions: 'Suggestion decision operations',
  Executions: 'Execution result operations',
  Services: 'Service catalog operations',
  ImplementationHints: 'Implementation hint operations',
  AgentSessions: 'Agent session operations',
  Machines: 'Machine and controller operations',
  SecondaryActions: 'Secondary action operations',
  CodingPrompts: 'Coding prompt operations',
  Analytics: 'Analytics operations',
  Reports: 'Report operations',
  Proposals: 'Proposal operations',
  Notifications: 'Notification operations',
  ReportBugs: 'Report-a-problem operations',
  ActivityCorrelation: 'Activity correlation operations',
  AgentEdges: 'Agent-authored edge operations',
  ControllerAuthorization: 'Controller authorization operations',
  StagedContent: 'Staged content operations',
  OpenItems: 'Server-authoritative Open Items collection operations',
  Stars: 'Star operations',
  Tasks: 'Task and work-item operations',
  UserSettings: 'User settings operations',
  ValidationSessions: 'Validation session operations',
  WorkItemRefinement: 'Work-item refinement operations',
  WorkItemTypes: 'Work-item type operations',
  Mcp: 'MCP operations',
};

const TAG_ALIASES = {
  'Controller Authorization': 'ControllerAuthorization',
  'Debug/Admin': 'DebugAdmin',
  'Design Docs': 'DesignDocs',
  'Payment Provider Webhooks': 'PaymentProviderWebhooks',
  'Private Beta Access': 'PrivateBetaAccess',
  'Report Bugs': 'ReportBugs',
  'Staged Content': 'StagedContent',
  'User Settings': 'UserSettings',
  'Work Item Refinement': 'WorkItemRefinement',
  'Work Item Types': 'WorkItemTypes',
  'mcp': 'Mcp',
  'projects': 'Projects',
};

const OPERATION_ID_OVERRIDES = {
  'GET /organizations/{organizationId}/design-docs': 'listDesignDocs',
  'POST /organizations/{organizationId}/design-docs': 'createDesignDoc',
  'GET /organizations/{organizationId}/design-docs/library': 'getDesignDocLibrary',
  'GET /organizations/{organizationId}/design-docs/{designDocId}': 'getDesignDoc',
  'PATCH /organizations/{organizationId}/design-docs/{designDocId}': 'updateDesignDoc',
  'DELETE /organizations/{organizationId}/design-docs/{designDocId}': 'archiveDesignDoc',
  'PATCH /organizations/{organizationId}/design-docs/{designDocId}/restore': 'restoreDesignDoc',
  'GET /organizations/{organizationId}/design-docs/{designDocId}/links': 'listDesignDocLinks',
  'POST /organizations/{organizationId}/design-docs/{designDocId}/links': 'createDesignDocLink',
  'DELETE /organizations/{organizationId}/design-docs/{designDocId}/links/{linkId}': 'removeDesignDocLink',
  'GET /organizations/{organizationId}/project/{projectId}/plans': 'listPlans',
  'POST /organizations/{organizationId}/project/{projectId}/plans': 'createPlan',
  'GET /organizations/{organizationId}/project/{projectId}/plans/active-stage-execution-guidance': 'getActivePlanStageExecutionGuidance',
  'GET /organizations/{organizationId}/project/{projectId}/plans/{planId}': 'getPlan',
  'PATCH /organizations/{organizationId}/project/{projectId}/plans/{planId}': 'updatePlan',
  'DELETE /organizations/{organizationId}/project/{projectId}/plans/{planId}': 'deletePlan',
  'GET /organizations/{organizationId}/project/{projectId}/plans/{planId}/relationships': 'listPlanRelationships',
  'POST /organizations/{organizationId}/project/{projectId}/plans/{planId}/sign-offs': 'signOffPlan',
  'GET /organizations/{organizationId}/project/{projectId}/plans/{planId}/sequencing': 'getPlanStageParallelStartSet',
  'GET /organizations/{organizationId}/project/{projectId}/plans/{planId}/stages/{stageId}/steps': 'listPlanSteps',
  'PATCH /organizations/{organizationId}/project/{projectId}/plans/{planId}/stages/{stageId}': 'updatePlanStage',
  'PATCH /organizations/{organizationId}/project/{projectId}/plans/{planId}/stages/{stageId}/steps/{stepId}': 'updatePlanStep',
  'POST /organizations/{organizationId}/project/{projectId}/plans/{planId}/stages/{stageId}/steps/{stepId}/skip': 'skipPlanStep',
  'POST /organizations/{organizationId}/project/{projectId}/plans/{planId}/stages/{stageId}/steps/{stepId}/unskip': 'unskipPlanStep',
  'GET /organizations/{organizationId}/project/{projectId}/plans/{planId}/critical-path': 'getPlanCriticalPath',
  'GET /organizations/{organizationId}/projects/{projectId}/integrations/suggested-users': 'getSuggestedIntegrationUsers',
  'POST /organizations/{organizationId}/suggestions/generate-task': 'generateTaskSuggestion',
  'POST /organizations/{organizationId}/suggestions/generate-design-doc': 'generateDesignDocSuggestion',
  'GET /organizations/{organizationId}/suggestions/{type}/{suggestionId}': 'getSuggestionDecision',
  'POST /organizations/{organizationId}/suggestions/{type}/{suggestionId}': 'recordSuggestionDecision',
  'GET /organizations/{organizationId}/suggestions': 'listSuggestionDecisions',
  'GET /organizations/{organizationId}/workflows': 'listOrganizationWorkflows',
  'GET /organizations/{organizationId}/executions/{executionId}/result': 'getExecutionResult',
  'GET /organizations/{organizationId}/executions/{executionId}/wait': 'waitForExecution',
  'GET /organizations/{organizationId}/services': 'listServices',
  'POST /organizations/{organizationId}/services': 'createService',
  'GET /organizations/{organizationId}/services/{serviceId}': 'getService',
  'PATCH /organizations/{organizationId}/services/{serviceId}': 'updateService',
  'DELETE /organizations/{organizationId}/services/{serviceId}': 'deleteService',
  'GET /organizations/{organizationId}/services/{serviceId}/links': 'listServiceLinks',
  'POST /organizations/{organizationId}/services/{serviceId}/links': 'createServiceLink',
  'DELETE /organizations/{organizationId}/services/{serviceId}/links': 'removeServiceLink',
  'GET /organizations/{organizationId}/implementation-hints': 'listImplementationHints',
  'POST /organizations/{organizationId}/implementation-hints': 'createImplementationHint',
  'GET /organizations/{organizationId}/implementation-hints/{hintId}': 'getImplementationHint',
  'PATCH /organizations/{organizationId}/implementation-hints/{hintId}': 'updateImplementationHint',
  'DELETE /organizations/{organizationId}/implementation-hints/{hintId}': 'deleteImplementationHint',
  'GET /organizations/{organizationId}/implementation-hints/versions': 'listImplementationHintVersions',
  'POST /organizations/{organizationId}/implementation-hints/{hintId}/append-version': 'appendImplementationHintVersion',
  'GET /organizations/{organizationId}/implementation-hints/{hintId}/versions': 'listImplementationHintVersionsForHint',
  'POST /organizations/{organizationId}/implementation-hints/{hintId}/versions': 'appendImplementationHintVersionForHint',
  'GET /organizations/{organizationId}/implementation-hints/{hintId}/file-references': 'listImplementationHintFileReferences',
  'POST /organizations/{organizationId}/implementation-hints/{hintId}/file-references': 'createImplementationHintFileReference',
  'GET /organizations/{organizationId}/implementation-hints/{hintId}/file-references/{fileReferenceId}': 'getImplementationHintFileReference',
  'PATCH /organizations/{organizationId}/implementation-hints/{hintId}/file-references/{fileReferenceId}': 'updateImplementationHintFileReference',
  'DELETE /organizations/{organizationId}/implementation-hints/{hintId}/file-references/{fileReferenceId}': 'deleteImplementationHintFileReference',
  'POST /organizations/{organizationId}/implementation-hints/file-references/query': 'queryImplementationHintFileReferences',
  'GET /organizations/{organizationId}/projects/{projectId}/agent-sessions': 'listAgentSessions',
  'POST /organizations/{organizationId}/projects/{projectId}/agent-sessions': 'createAgentSession',
  'GET /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}': 'getAgentSession',
  'PATCH /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}': 'updateAgentSession',
  'DELETE /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}': 'deleteAgentSession',
  'POST /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/conversation': 'createAgentSessionConversation',
  'GET /organizations/{organizationId}/secondary-actions': 'listSecondaryActions',
  'POST /organizations/{organizationId}/coding-prompts/research-executions': 'createCodingPromptResearchExecution',
  'GET /organizations/{organizationId}/reports': 'listReports',
  'POST /organizations/{organizationId}/reports': 'createReport',
  'GET /organizations/{organizationId}/reports/{reportId}': 'getReport',
  'PATCH /organizations/{organizationId}/reports/{reportId}': 'updateReport',
  'DELETE /organizations/{organizationId}/reports/{reportId}': 'deleteReport',
  'GET /organizations/{organizationId}/projects/{projectId}/proposals': 'listProposals',
  'POST /organizations/{organizationId}/projects/{projectId}/proposals': 'createProposal',
  'GET /organizations/{organizationId}/projects/{projectId}/proposals/{proposalId}': 'getProposal',
  'PATCH /organizations/{organizationId}/projects/{projectId}/proposals/{proposalId}': 'updateProposal',
  'DELETE /organizations/{organizationId}/projects/{projectId}/proposals/{proposalId}': 'deleteProposal',
  'POST /organizations/{organizationId}/projects/{projectId}/proposals/{proposalId}/validate': 'validateProposal',
  'POST /organizations/{organizationId}/projects/{projectId}/proposals/{proposalId}/reject': 'rejectProposal',
};

const inferTag = (pathName) => {
  if (pathName.startsWith('/auth/')) return 'Auth';
  if (pathName === '/private-beta/access-requests' || pathName.startsWith('/admin/private-beta-')) return 'PrivateBetaAccess';
  if (pathName.startsWith('/payment-providers/')) return 'PaymentProviderWebhooks';
  if (pathName.startsWith('/webhooks/')) return 'Webhooks';
  if (pathName.startsWith('/admin/')) return 'DebugAdmin';
  if (pathName.startsWith('/help/')) return 'Help';
  if (pathName.startsWith('/report-bug')) return 'ReportBugs';
  if (pathName.startsWith('/llm-tracking') || pathName.startsWith('/debug/')) return 'DebugAdmin';
  if (pathName.startsWith('/dev/')) return 'Development';
  if (pathName.startsWith('/events/')) return 'Events';
  if (pathName.startsWith('/mcp/')) return 'Mcp';
  if (pathName.startsWith('/workflows/')) return 'Workflows';
  if (pathName.startsWith('/ui-flows/')) return 'InteractionFlows';
  if (pathName.startsWith('/analytics/')) return 'Analytics';
  if (pathName.includes('/design-docs')) return 'DesignDocs';
  if (pathName.includes('/project/') && pathName.includes('/plans')) return 'Plans';
  if (pathName.includes('/suggestions/')) return 'Suggestions';
  if (pathName.includes('/executions/')) return 'Executions';
  if (pathName.includes('/implementation-hints')) return 'ImplementationHints';
  if (pathName.includes('/services')) return 'Services';
  if (pathName.includes('/agent-sessions')) return 'AgentSessions';
  if (pathName.includes('/secondary-actions')) return 'SecondaryActions';
  if (pathName.includes('/coding-prompts/')) return 'CodingPrompts';
  if (pathName.includes('/reports')) return 'Reports';
  if (pathName.includes('/proposals')) return 'Proposals';
  if (pathName.includes('/notifications')) return 'Notifications';
  if (pathName.includes('/activity-correlations')) return 'ActivityCorrelation';
  if (pathName.includes('/agent-edges')) return 'AgentEdges';
  if (pathName.includes('/controller-authorizations')) return 'ControllerAuthorization';
  if (pathName.includes('/staged-content')) return 'StagedContent';
  if (pathName.includes('/open-items')) return 'OpenItems';
  if (pathName.includes('/stars')) return 'Stars';
  if (pathName.includes('/work-item-types')) return 'WorkItemTypes';
  if (pathName.includes('/work-items')) return 'Tasks';
  if (pathName.includes('/validation-sessions')) return 'ValidationSessions';
  if (pathName.includes('/user-settings')) return 'UserSettings';
  if (pathName.includes('/integrations')) return 'Integrations';
  if (pathName.includes('/topology/')) return 'Topology';
  if (pathName.includes('/entities/search') || pathName.includes('/search')) return 'Search';
  if (pathName.includes('/entities/')) return 'Entities';
  if (pathName.includes('/artifacts')) return 'Artifacts';
  if (pathName.includes('/tags')) return 'Tags';
  if (pathName.includes('/conversations') || pathName.includes('/messages')) return 'Conversations';
  if (pathName.includes('/initiatives')) return 'Initiatives';
  if (pathName.includes('/projects')) return 'Projects';
  if (pathName.startsWith('/organizations')) return 'Organizations';
  return 'DebugAdmin';
};

const operationKey = (method, pathName) => `${method.toUpperCase()} ${pathName}`;

const getOperationEntries = (document) => {
  const entries = [];
  for (const [pathName, pathItem] of Object.entries(document.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem || {})) {
      if (HTTP_METHODS.has(method)) {
        entries.push({ method, operation, pathName, key: operationKey(method, pathName) });
      }
    }
  }
  return entries;
};

const expectedOperationId = ({ key, operation }) =>
  operation.operationId || OPERATION_ID_OVERRIDES[key] || null;

const expectedTag = ({ operation, pathName }) => {
  const currentTag = Array.isArray(operation.tags) && operation.tags.length === 1
    ? operation.tags[0]
    : null;
  return TAG_ALIASES[currentTag] || currentTag || inferTag(pathName);
};

const parseOperationRanges = (lines) => {
  const ranges = [];
  let currentPath = null;
  for (let index = 0; index < lines.length; index += 1) {
    const pathMatch = lines[index].match(/^  (\/.*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = lines[index].match(/^    (get|post|put|patch|delete|options|head|trace):\s*$/);
    if (currentPath && methodMatch) {
      let end = lines.length;
      for (let next = index + 1; next < lines.length; next += 1) {
        if (/^    (get|post|put|patch|delete|options|head|trace):\s*$/.test(lines[next]) || /^  (\/.*):\s*$/.test(lines[next])) {
          end = next;
          break;
        }
      }
      ranges.push({ end, method: methodMatch[1], pathName: currentPath, start: index });
    }
  }
  return ranges;
};

const indentWidth = (line) => line.length - line.trimStart().length;

const applyFixes = (text, document) => {
  const lines = text.split('\n');
  const ranges = parseOperationRanges(lines);
  const entries = getOperationEntries(document);
  if (ranges.length !== entries.length) {
    throw new Error(`Could not safely map YAML operations to source lines (${ranges.length} !== ${entries.length}).`);
  }

  for (let rangeIndex = ranges.length - 1; rangeIndex >= 0; rangeIndex -= 1) {
    const range = ranges[rangeIndex];
    const entry = entries[rangeIndex];
    if (range.pathName !== entry.pathName || range.method !== entry.method) {
      throw new Error(`Could not safely map ${entry.key} to source lines.`);
    }

    const operationId = expectedOperationId(entry);
    const tag = expectedTag(entry);
    if (!operationId || !tag) {
      throw new Error(`No metadata mapping exists for ${entry.key}.`);
    }

    let operationIdLine = -1;
    let tagsLine = -1;
    for (let index = range.start + 1; index < range.end; index += 1) {
      if (/^      operationId:\s*/.test(lines[index])) operationIdLine = index;
      if (/^      tags:\s*/.test(lines[index])) tagsLine = index;
    }

    if (tagsLine >= 0) {
      let tagsEnd = tagsLine + 1;
      while (tagsEnd < range.end && indentWidth(lines[tagsEnd]) > 6) tagsEnd += 1;
      lines.splice(tagsLine, tagsEnd - tagsLine, `      tags: [${tag}]`);
    } else {
      const insertAt = operationIdLine >= 0 ? operationIdLine + 1 : range.start + 1;
      lines.splice(insertAt, 0, `      tags: [${tag}]`);
    }

    if (operationIdLine < 0) {
      lines.splice(range.start + 1, 0, `      operationId: ${operationId}`);
    }
  }

  if (!/^tags:\s*$/m.test(lines.join('\n'))) {
    const tagBlock = [
      'tags:',
      ...Object.entries(TAG_DESCRIPTIONS).flatMap(([name, description]) => [
        `  - name: ${name}`,
        `    description: ${description}`,
      ]),
      '',
    ];
    const pathsIndex = lines.findIndex((line) => line === 'paths:');
    if (pathsIndex < 0) throw new Error('Could not locate the paths section.');
    lines.splice(pathsIndex, 0, ...tagBlock);
  }

  return lines.join('\n');
};

const validate = (document, documentPath) => {
  const errors = [];
  const declaredTags = new Set((document.tags || []).map((tag) => tag.name));
  const operationIds = new Map();

  for (const entry of getOperationEntries(document)) {
    const { operation, key } = entry;
    if (typeof operation.operationId !== 'string' || !operation.operationId) {
      errors.push(`${key}: missing operationId`);
    } else {
      if (!/^[a-z][A-Za-z0-9]*$/.test(operation.operationId)) errors.push(`${key}: operationId must be lower camel case (${operation.operationId})`);
      const previous = operationIds.get(operation.operationId);
      if (previous) errors.push(`${key}: duplicate operationId ${operation.operationId} (already used by ${previous})`);
      operationIds.set(operation.operationId, key);
    }
    if (!Array.isArray(operation.tags) || operation.tags.length !== 1) {
      errors.push(`${key}: expected exactly one tag`);
    } else if (!declaredTags.has(operation.tags[0])) {
      errors.push(`${key}: tag ${operation.tags[0]} is not declared at the document level`);
    } else if (!/^[A-Za-z][A-Za-z0-9]*$/.test(operation.tags[0])) {
      errors.push(`${key}: tag must contain only letters and numbers (${operation.tags[0]})`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`OpenAPI operation metadata validation failed for ${documentPath}:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  }
};

const main = () => {
  const source = fs.readFileSync(SPEC_PATH, 'utf8');
  const document = yaml.load(source);
  if (process.argv.includes('--fix')) {
    const updated = applyFixes(source, document);
    fs.writeFileSync(SPEC_PATH, updated);
    console.log(`Updated operation metadata in ${path.relative(process.cwd(), SPEC_PATH)}.`);
  }
  for (const specPath of STANDALONE_SPEC_PATHS) {
    const currentDocument = yaml.load(fs.readFileSync(specPath, 'utf8'));
    validate(currentDocument, path.relative(process.cwd(), specPath));
    console.log(`Validated ${getOperationEntries(currentDocument).length} OpenAPI operations in ${path.relative(process.cwd(), specPath)}.`);
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
