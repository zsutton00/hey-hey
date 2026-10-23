import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const journeyOffered = new Counter('api_diagnostic_journey_offered');
const journeyCompleted = new Counter('api_diagnostic_journey_completed');
const journeyErrors = new Counter('api_diagnostic_journey_errors');
const cleanupFailures = new Counter('api_diagnostic_cleanup_failures');
const correctnessChecks = new Rate('api_diagnostic_correctness');
const journeyLatency = new Trend('api_diagnostic_journey_latency', true);

function requiredEnvironment(name) {
  const value = __ENV[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function positiveInteger(name) {
  const value = Number(requiredEnvironment(name));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function positiveNumber(name) {
  const value = Number(requiredEnvironment(name));
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return value;
}

function safeRunId(value) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    throw new Error(
      'K6_RUN_ID must contain only letters, numbers, dots, underscores, or hyphens and be at most 64 characters',
    );
  }
  return value;
}

function traceMode(value) {
  if (value !== 'disabled' && value !== 'enabled') {
    throw new Error('K6_TRACE_MODE must be disabled or enabled');
  }
  return value;
}

const config = {
  baseUrl: requiredEnvironment('K6_BASE_URL').replace(/\/+$/, ''),
  buildId: requiredEnvironment('K6_BUILD_ID'),
  browserOrigin: requiredEnvironment('K6_BROWSER_ORIGIN'),
  configurationId: requiredEnvironment('K6_CONFIGURATION_ID'),
  duration: requiredEnvironment('K6_DURATION'),
  environmentId: requiredEnvironment('K6_ENVIRONMENT_ID'),
  gracefulStop: requiredEnvironment('K6_GRACEFUL_STOP'),
  maxVUs: positiveInteger('K6_MAX_VUS'),
  preAllocatedVUs: positiveInteger('K6_PRE_ALLOCATED_VUS'),
  rate: positiveNumber('K6_RATE'),
  runId: safeRunId(requiredEnvironment('K6_RUN_ID')),
  traceMode: traceMode(requiredEnvironment('K6_TRACE_MODE')),
};

if (config.preAllocatedVUs > config.maxVUs) {
  throw new Error('K6_PRE_ALLOCATED_VUS cannot exceed K6_MAX_VUS');
}

export const options = {
  discardResponseBodies: false,
  tags: {
    diagnostic: 'authenticated-api',
    build_id: config.buildId,
    configuration_id: config.configurationId,
    environment_id: config.environmentId,
    run_id: config.runId,
    trace_mode: config.traceMode,
  },
  scenarios: {
    authenticated_api_journeys: {
      executor: 'constant-arrival-rate',
      duration: config.duration,
      gracefulStop: config.gracefulStop,
      maxVUs: config.maxVUs,
      preAllocatedVUs: config.preAllocatedVUs,
      rate: config.rate,
      timeUnit: '1s',
    },
  },
};

let requestSequence = 0;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonBody(response) {
  try {
    return response.json();
  } catch {
    return undefined;
  }
}

function readApiEnvelope(response) {
  const body = parseJsonBody(response);
  if (
    !isRecord(body) ||
    body.success !== true ||
    !Object.prototype.hasOwnProperty.call(body, 'data')
  ) {
    return { valid: false, data: undefined };
  }
  return { valid: true, data: body.data };
}

function requestHeaders(fixture, correlationId) {
  requestSequence += 1;
  return {
    Authorization: `Bearer ${fixture.accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'hey-hey-api-diagnostic/1',
    'x-correlation-id': correlationId,
    'x-request-id': `${correlationId}-r${requestSequence}`,
  };
}

function requestJourney(
  fixture,
  journey,
  method,
  path,
  body,
  expectedStatus,
  payloadAssertion,
  correlationId,
  phase = 'journey',
) {
  const tags = { journey, phase };
  journeyOffered.add(1, tags);
  const startedAt = Date.now();
  const response = http.request(
    method,
    `${config.baseUrl}${path}`,
    body === undefined ? null : JSON.stringify(body),
    { headers: requestHeaders(fixture, correlationId), tags },
  );
  journeyCompleted.add(1, tags);
  journeyLatency.add(Date.now() - startedAt, tags);

  const envelope = readApiEnvelope(response);
  const statusCorrect = check(response, {
    [`${journey} returned expected status`]: (value) =>
      value.status === expectedStatus,
  });
  const envelopeCorrect = check(response, {
    [`${journey} returned the API envelope`]: () => envelope.valid,
  });
  const payloadCorrect = check(response, {
    [`${journey} returned a valid payload`]: () =>
      envelope.valid && payloadAssertion(envelope.data),
  });
  const correct = statusCorrect && envelopeCorrect && payloadCorrect;
  correctnessChecks.add(correct ? 1 : 0, tags);

  if (!correct) {
    if (phase === 'cleanup') cleanupFailures.add(1, tags);
    else journeyErrors.add(1, tags);
  }

  return { correct, data: envelope.data };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function hasId(value, expectedId) {
  return isRecord(value) && value.id === expectedId;
}

function projectPath(organizationId, suffix = '') {
  return `/api/v1/organizations/${organizationId}/projects${suffix}`;
}

function workItemPath(organizationId, projectId, suffix = '') {
  return `/api/v1/organizations/${organizationId}/projects/${projectId}/work-items${suffix}`;
}

function contextPath(organizationId, projectId, taskId) {
  return `/api/v1/organizations/${organizationId}/projects/${projectId}/entities/TASK/${taskId}/context?includeAvailableMcpTools=false&includePlan=false&includeProposals=false`;
}

function searchPath(organizationId, projectId) {
  return `/api/v1/organizations/${organizationId}/projects/${projectId}/search`;
}

function diagnosticProjectName() {
  return `api-diagnostic-${config.runId}-vu${__VU}-it${__ITER}`;
}

function diagnosticWorkItemName(projectName) {
  return `${projectName}-work-item`;
}

function findCreatedEntity(items, name) {
  if (!Array.isArray(items)) return undefined;
  const match = items.find(
    (item) => isRecord(item) && item.name === name && isNonEmptyString(item.id),
  );
  return match?.id;
}

function cleanupProject(
  fixture,
  organizationId,
  projectId,
  projectName,
  taskId,
  correlationId,
) {
  let resolvedTaskId = taskId;
  let resolvedProjectId = projectId;

  if (!resolvedTaskId && resolvedProjectId) {
    const recovery = requestJourney(
      fixture,
      'work_item_recovery_list',
      'GET',
      workItemPath(
        organizationId,
        resolvedProjectId,
        '?limit=500&sortBy=createdAt&sortDir=desc',
      ),
      undefined,
      200,
      (data) => Array.isArray(data),
      correlationId,
      'cleanup',
    );
    if (recovery.correct) {
      resolvedTaskId = findCreatedEntity(
        recovery.data,
        diagnosticWorkItemName(projectName),
      );
    }
  }

  if (!resolvedProjectId) {
    const recovery = requestJourney(
      fixture,
      'project_recovery_list',
      'GET',
      projectPath(organizationId),
      undefined,
      200,
      (data) => Array.isArray(data),
      correlationId,
      'cleanup',
    );
    if (recovery.correct) {
      resolvedProjectId = findCreatedEntity(recovery.data, projectName);
    }
  }

  if (resolvedTaskId && resolvedProjectId) {
    requestJourney(
      fixture,
      'work_item_cleanup',
      'DELETE',
      workItemPath(organizationId, resolvedProjectId, `/${resolvedTaskId}`),
      undefined,
      200,
      (data) =>
        hasId(data, resolvedTaskId) && isNonEmptyString(data.archivedAt),
      correlationId,
      'cleanup',
    );
  }

  if (resolvedProjectId) {
    requestJourney(
      fixture,
      'project_cleanup',
      'DELETE',
      projectPath(organizationId, `/${resolvedProjectId}`),
      undefined,
      200,
      (data) =>
        hasId(data, resolvedProjectId) && isNonEmptyString(data.deletedAt),
      correlationId,
      'cleanup',
    );
  }
}

function logoutSession(fixture, correlationId) {
  const requestCorrelationId =
    correlationId ?? `${config.runId}-logout-${__VU || 0}`;
  const response = http.post(`${config.baseUrl}/api/v1/auth/logout`, null, {
    headers: {
      Cookie: `accessToken=${fixture.accessToken}; refreshToken=${fixture.refreshToken}`,
      Origin: config.browserOrigin,
      'User-Agent': 'hey-hey-api-diagnostic/1',
      'x-correlation-id': requestCorrelationId,
      'x-request-id': `${requestCorrelationId}-logout`,
    },
    tags: { journey: 'auth_logout', phase: 'cleanup' },
  });
  const correct = response.status === 200 && readApiEnvelope(response).valid;
  if (!correct) {
    cleanupFailures.add(1, { journey: 'auth_logout', phase: 'cleanup' });
  }
  return correct;
}

function parseAuthUsers() {
  const raw = requiredEnvironment('K6_AUTH_USERS_JSON');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('K6_AUTH_USERS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length < config.maxVUs) {
    throw new Error(
      `K6_AUTH_USERS_JSON must contain at least ${config.maxVUs} dedicated identities`,
    );
  }
  const identities = parsed.slice(0, config.maxVUs);
  const emails = new Set(
    identities.map((user) => (isRecord(user) ? user.email : undefined)),
  );
  if (emails.size !== identities.length) {
    throw new Error('K6_AUTH_USERS_JSON identities must have distinct emails');
  }
  return identities;
}

function login(user, index) {
  if (
    !isRecord(user) ||
    !isNonEmptyString(user.email) ||
    !isNonEmptyString(user.password)
  ) {
    throw new Error(
      `K6_AUTH_USERS_JSON entry ${index + 1} must contain email and password`,
    );
  }

  const correlationId = `${config.runId}-setup-${index + 1}`;
  const response = http.post(
    `${config.baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: config.browserOrigin,
        'User-Agent': 'hey-hey-api-diagnostic/1',
        'x-correlation-id': correlationId,
        'x-request-id': `${correlationId}-login`,
      },
      tags: { journey: 'auth_login', phase: 'setup' },
    },
  );
  const envelope = readApiEnvelope(response);
  const auth = envelope.data;
  const organizationId =
    user.organizationId ?? auth?.user?.currentOrganizationId;
  const refreshToken = response.cookies?.refreshToken?.[0]?.value;

  if (
    response.status !== 200 ||
    !envelope.valid ||
    !isRecord(auth) ||
    !isNonEmptyString(auth.accessToken) ||
    !isRecord(auth.user) ||
    !isNonEmptyString(auth.user.id) ||
    !isNonEmptyString(organizationId) ||
    !isNonEmptyString(refreshToken)
  ) {
    throw new Error(
      `Authentication setup failed for identity ${index + 1} (HTTP ${response.status})`,
    );
  }

  if (
    user.organizationId !== undefined &&
    auth.user.currentOrganizationId !== user.organizationId
  ) {
    throw new Error(
      `Identity ${index + 1} is not authorized for its configured organization`,
    );
  }

  return {
    accessToken: auth.accessToken,
    organizationId,
    refreshToken,
    userId: auth.user.id,
  };
}

export function setup() {
  const users = parseAuthUsers();
  const fixtures = [];
  try {
    for (let index = 0; index < users.length; index += 1) {
      fixtures.push(login(users[index], index));
    }
  } catch (error) {
    fixtures.forEach((fixture, index) =>
      logoutSession(fixture, `${config.runId}-setup-cleanup-${index + 1}`),
    );
    throw error;
  }
  return { fixtures };
}

export default function (data) {
  const fixture = data.fixtures[__VU - 1];
  if (!fixture) {
    throw new Error(
      `No dedicated authenticated identity configured for VU ${__VU}`,
    );
  }

  const correlationId = `${config.runId}-vu${__VU}-it${__ITER}`;
  const projectName = diagnosticProjectName();
  const taskName = diagnosticWorkItemName(projectName);
  let projectId;
  let taskId;

  try {
    requestJourney(
      fixture,
      'project_read_list',
      'GET',
      projectPath(fixture.organizationId),
      undefined,
      200,
      (payload) => Array.isArray(payload),
      correlationId,
    );

    const projectCreate = requestJourney(
      fixture,
      'project_create',
      'POST',
      projectPath(fixture.organizationId),
      { name: projectName, description: 'Fixed-load API diagnostic fixture' },
      201,
      (payload) =>
        isRecord(payload) &&
        isNonEmptyString(payload.id) &&
        payload.name === projectName &&
        payload.organizationId === fixture.organizationId,
      correlationId,
    );
    if (projectCreate.correct) projectId = projectCreate.data.id;
    if (!projectId) return;

    requestJourney(
      fixture,
      'project_read_detail',
      'GET',
      projectPath(fixture.organizationId, `/${projectId}`),
      undefined,
      200,
      (payload) => hasId(payload, projectId),
      correlationId,
    );

    const workItemCreate = requestJourney(
      fixture,
      'work_item_create',
      'POST',
      workItemPath(fixture.organizationId, projectId),
      {
        name: taskName,
        priority: 'MEDIUM',
        sections: [
          {
            content: 'Fixed-load authenticated API diagnostic fixture.',
            key: 'description',
            order: 0,
          },
          {
            content:
              'The created work item can be read, searched, and contextualized.',
            key: 'acceptanceCriteria',
            order: 1,
          },
        ],
        source: 'user',
        status: 'BACKLOG',
        type: 'BUG',
      },
      201,
      (payload) =>
        isRecord(payload) &&
        isNonEmptyString(payload.id) &&
        payload.name === taskName &&
        payload.projectId === projectId,
      correlationId,
    );
    if (workItemCreate.correct) taskId = workItemCreate.data.id;
    if (!taskId) return;

    requestJourney(
      fixture,
      'work_item_read',
      'GET',
      workItemPath(fixture.organizationId, projectId, `/${taskId}`),
      undefined,
      200,
      (payload) => hasId(payload, taskId) && payload.projectId === projectId,
      correlationId,
    );

    requestJourney(
      fixture,
      'search_hybrid',
      'POST',
      searchPath(fixture.organizationId, projectId),
      {
        common: { types: ['TASK'] },
        embeddings: { maxResults: 10, queryMode: 'title_fuzzy' },
        graph: {
          includeRelationships: true,
          seedEntityIds: [taskId],
          size: 10,
          traversal: { depth: 1, direction: 'BOTH' },
        },
        intent: 'hybrid',
        query: taskName,
      },
      200,
      (payload) =>
        isRecord(payload) &&
        payload.intent === 'hybrid' &&
        Array.isArray(payload.results),
      correlationId,
    );

    requestJourney(
      fixture,
      'context_read',
      'GET',
      contextPath(fixture.organizationId, projectId, taskId),
      undefined,
      200,
      (payload) =>
        isRecord(payload) &&
        payload.entityId === taskId &&
        payload.entityType === 'TASK',
      correlationId,
    );
  } finally {
    cleanupProject(
      fixture,
      fixture.organizationId,
      projectId,
      projectName,
      taskId,
      correlationId,
    );
  }
}

export function teardown(data) {
  data.fixtures.forEach((fixture, index) =>
    logoutSession(fixture, `${config.runId}-teardown-${index + 1}`),
  );
}
