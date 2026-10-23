// Measured activity against the persistent fixture written by
// seed-activity-fixture.mjs. No setup or teardown here touches the fixture;
// writes only reach the scratch feature, which the seed step resets.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const actionLatency = new Trend('activity_action_latency', true);
const actionCount = new Counter('activity_actions');
const actionCorrectness = new Rate('activity_correctness');
const reauthentications = new Counter('activity_reauthentications');
// Paced mixes schedule requests per user; a slot the user could not start on
// time is counted as missed instead of silently lowering the offered rate.
const offeredSlots = new Counter('activity_offered');
const missedSlots = new Counter('activity_missed');

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

function safeRunId(value) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    throw new Error(
      'K6_RUN_ID must contain only letters, numbers, dots, underscores, or hyphens and be at most 64 characters',
    );
  }
  return value;
}

const config = {
  baseUrl: requiredEnvironment('K6_BASE_URL').replace(/\/+$/, ''),
  browserOrigin: requiredEnvironment('K6_BROWSER_ORIGIN'),
  buildId: requiredEnvironment('K6_BUILD_ID'),
  configurationId: requiredEnvironment('K6_CONFIGURATION_ID'),
  duration: requiredEnvironment('K6_DURATION'),
  environmentId: requiredEnvironment('K6_ENVIRONMENT_ID'),
  gracefulStop: requiredEnvironment('K6_GRACEFUL_STOP'),
  runId: safeRunId(requiredEnvironment('K6_RUN_ID')),
  vus: positiveInteger('K6_VUS'),
};

const fixtureManifest = JSON.parse(
  open(requiredEnvironment('ACTIVITY_FIXTURE_MANIFEST')),
);
let fixture = fixtureManifest;
const distributed = fixtureManifest.distributionVersion === 1;
const mix = JSON.parse(open(requiredEnvironment('ACTIVITY_MIX_FILE')));
const users = JSON.parse(requiredEnvironment('K6_AUTH_USERS_JSON'));

if (!Array.isArray(users) || users.length < config.vus) {
  throw new Error(
    `K6_AUTH_USERS_JSON must contain at least ${config.vus} dedicated identities`,
  );
}

const paced = mix.cohorts !== undefined;

function weighted(table) {
  const entries = Object.entries(table);
  return {
    entries,
    total: entries.reduce((sum, [, weight]) => sum + weight, 0),
  };
}

const weightedActions = weighted(mix.actions);
const weightedSearches = paced ? weighted(mix.searchActions) : undefined;

export const options = {
  discardResponseBodies: false,
  setupTimeout: '5m',
  tags: {
    diagnostic: 'authenticated-activity',
    build_id: config.buildId,
    configuration_id: config.configurationId,
    environment_id: config.environmentId,
    fixture_version: String(fixture.fixtureVersion),
    mix_version: String(mix.mixVersion),
    run_id: config.runId,
    vus: String(config.vus),
  },
  scenarios: {
    activity: {
      executor: 'constant-vus',
      duration: config.duration,
      gracefulStop: config.gracefulStop,
      vus: config.vus,
    },
  },
};

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

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickAction({ entries, total }) {
  let roll = Math.random() * total;
  for (const [action, weight] of entries) {
    roll -= weight;
    if (roll < 0) return action;
  }
  return entries[entries.length - 1][0];
}

// Every tenth user is heavy, so 50 and 100 users split exactly 90/10.
function cohortOf(vu) {
  if (!paced) return 'uniform';
  return vu % mix.cohorts.heavy.everyNthUser === 0 ? 'heavy' : 'light';
}

function login(user, index) {
  const correlationId = `${config.runId}-login-${index + 1}`;
  const response = http.post(
    `${config.baseUrl}/api/v1/auth/login`,
    JSON.stringify({ email: user.email, password: user.password }),
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: config.browserOrigin,
        'User-Agent': 'hey-hey-api-diagnostic/1',
        'x-correlation-id': correlationId,
      },
      tags: { action: 'auth_login', phase: 'setup' },
    },
  );
  const body = parseJsonBody(response);
  const auth = isRecord(body) ? body.data : undefined;
  if (
    response.status !== 200 ||
    !isRecord(auth) ||
    typeof auth.accessToken !== 'string'
  ) {
    throw new Error(
      `Authentication failed for identity ${index + 1} (HTTP ${response.status})`,
    );
  }
  return auth.accessToken;
}

function setupRequest(token, method, path, body, index) {
  const response = http.request(
    method,
    `${config.baseUrl}${path}`,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'hey-hey-api-diagnostic/1',
        'x-correlation-id': `${config.runId}-setup-${index + 1}`,
      },
      tags: { action: 'session_setup', phase: 'setup' },
    },
  );
  const parsed = parseJsonBody(response);
  if (response.status >= 300 || !isRecord(parsed) || !('data' in parsed)) {
    throw new Error(
      `Session setup ${method} failed for identity ${index + 1} (HTTP ${response.status})`,
    );
  }
  return parsed.data;
}

// One persistent idle session per identity, reused across runs. The
// agent-session workflow is not Temporal-backed and NOT_STARTED sessions have
// no runner, so session traffic here never starts model or workflow execution.
function prepareSession(token, index) {
  const title = `Activity diagnostic session ${index + 1}`;
  const listed = setupRequest(
    token,
    'GET',
    projectPath('/agent-sessions'),
    undefined,
    index,
  );
  const sessions = Array.isArray(listed) ? listed : (listed?.items ?? []);
  const existing = sessions.find((session) => session.title === title);
  const session =
    existing ??
    setupRequest(
      token,
      'POST',
      projectPath('/agent-sessions'),
      {
        projectId: fixture.projectId,
        sessionDate: new Date().toISOString(),
        title,
        type: 'PROJECT_CONVERSATION',
      },
      index,
    );
  // Idempotent: an already-bound session returns its conversation.
  const bound = setupRequest(
    token,
    'POST',
    projectPath(`/agent-sessions/${session.id}/conversation`),
    { workflowType: 'agent-session' },
    index,
  );
  return { agentSessionId: session.id, conversationId: bound.conversation.id };
}

export function setup() {
  const tokens = users.slice(0, config.vus).map(login);
  if (distributed) {
    if (config.vus !== 50 || fixtureManifest.assignments.length !== 50)
      throw new Error('Distributed activity requires fifty users');
    return { tokens, sessions: fixtureManifest.assignments };
  }
  return {
    tokens,
    sessions: paced ? tokens.map(prepareSession) : undefined,
  };
}

let accessToken;
let session;
let requestSequence = 0;

function projectPath(suffix) {
  return `/api/v1/organizations/${fixture.organizationId}/projects/${fixture.projectId}${suffix}`;
}

function contextPath(entityId) {
  return projectPath(
    `/entities/TASK/${entityId}/context?includeRelatedEntities=true&includeFeatureHierarchy=true&includeProposals=true&includeAvailableMcpTools=false&includePlan=false`,
  );
}

function errorCode(body) {
  if (!isRecord(body)) return 'none';
  const code = body.error?.code ?? body.code ?? body.error;
  return typeof code === 'string' ? code.slice(0, 64) : 'none';
}

function send(action, method, path, body) {
  requestSequence += 1;
  const correlationId = `${config.runId}-vu${__VU}-it${__ITER}`;
  const params = () => ({
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'hey-hey-api-diagnostic/1',
      'x-correlation-id': correlationId,
      'x-request-id': `${correlationId}-r${requestSequence}`,
    },
    tags: { action, phase: 'measured' },
  });
  const payload = body === undefined ? null : JSON.stringify(body);
  let response = http.request(
    method,
    `${config.baseUrl}${path}`,
    payload,
    params(),
  );
  if (response.status === 401) {
    // Expired sessions are re-established and the action retried; the
    // retry, not the 401, is what the action is measured on.
    reauthentications.add(1, { action });
    accessToken = login(users[__VU - 1], __VU - 1);
    response = http.request(
      method,
      `${config.baseUrl}${path}`,
      payload,
      params(),
    );
  }
  return response;
}

// outcome separates rejected requests (4xx, including entitlement and rate
// limits) from failed ones (5xx, transport) and from 2xx responses whose
// payload was wrong, so rejected traffic is never counted as user activity.
function record(action, response, expectedStatus, payloadAssertion) {
  const body = parseJsonBody(response);
  const enveloped = isRecord(body) && body.success === true && 'data' in body;
  let outcome;
  if (response.status === 0 || response.status >= 500) outcome = 'error';
  else if (response.status >= 400) outcome = 'rejected';
  else if (response.status !== expectedStatus || !enveloped)
    outcome = 'incorrect';
  else outcome = payloadAssertion(body.data) ? 'ok' : 'incorrect';

  const cohort = cohortOf(__VU);
  const tags = {
    action,
    cohort,
    outcome,
    status: String(response.status),
    code: outcome === 'ok' ? 'none' : errorCode(body),
  };
  actionCount.add(1, tags);
  actionLatency.add(response.timings.duration, {
    action,
    cohort,
    outcome,
    requestId: `${config.runId}-vu${__VU}-it${__ITER}-r${requestSequence}`,
  });
  actionCorrectness.add(outcome === 'ok' ? 1 : 0, { action });
  check(response, { [`${action} ok`]: () => outcome === 'ok' });
}

let featureIds = fixture.features.map((feature) => feature.id);
let taskIds = fixture.tasks.map((task) => task.id);
let allIds = new Set([...featureIds, ...taskIds, fixture.hubFeatureId]);

function contextAssertion(entityId) {
  return (data) =>
    isRecord(data) &&
    data.entityId === entityId &&
    Array.isArray(data.relatedEntities) &&
    Array.isArray(data.featureHierarchy) &&
    data.featureHierarchy.length > 0 &&
    (entityId !== fixture.hubFeatureId ||
      (data.relatedEntities.length ===
        fixture.readiness.contextHubCounts.relatedEntities &&
        data.featureHierarchy.length ===
          fixture.readiness.contextHubCounts.featureHierarchy));
}

function searchAssertion(data) {
  return (
    isRecord(data) &&
    Array.isArray(data.results) &&
    data.results.some((result) => allIds.has(result.entityId))
  );
}

const actions = {
  context_feature() {
    const id = pick(featureIds);
    record(
      'context_feature',
      send('context_feature', 'GET', contextPath(id)),
      200,
      contextAssertion(id),
    );
  },
  context_task() {
    const id = pick(taskIds);
    record(
      'context_task',
      send('context_task', 'GET', contextPath(id)),
      200,
      contextAssertion(id),
    );
  },
  context_hub() {
    const id = fixture.hubFeatureId;
    record(
      'context_hub',
      send('context_hub', 'GET', contextPath(id)),
      200,
      contextAssertion(id),
    );
  },
  feature_list() {
    record(
      'feature_list',
      send('feature_list', 'GET', projectPath('/features?limit=500')),
      200,
      (data) =>
        isRecord(data) &&
        Array.isArray(data.items) &&
        data.items.length >= featureIds.length,
    );
  },
  children_list() {
    const id = pick(featureIds);
    record(
      'children_list',
      send(
        'children_list',
        'GET',
        projectPath(`/work-items?parentTaskId=${id}&limit=100`),
      ),
      200,
      (data) => Array.isArray(data) && data.length > 0,
    );
  },
  edges_list() {
    const id = Math.random() < 0.2 ? fixture.hubFeatureId : pick(featureIds);
    record(
      'edges_list',
      send(
        'edges_list',
        'GET',
        projectPath(`/agent-edges?sourceNodeId=${id}&size=100`),
      ),
      200,
      (data) =>
        Array.isArray(data) || (isRecord(data) && Array.isArray(data.content)),
    );
  },
  work_item_read() {
    const id = pick(taskIds);
    record(
      'work_item_read',
      send('work_item_read', 'GET', projectPath(`/work-items/${id}`)),
      200,
      (data) => isRecord(data) && data.id === id,
    );
  },
  search_hybrid() {
    const seed = pick(featureIds);
    record(
      'search_hybrid',
      send('search_hybrid', 'POST', projectPath('/search'), {
        intent: 'hybrid',
        query: pick(fixture.searchTerms),
        common: { types: ['TASK'] },
        embeddings: { maxResults: 10 },
        graph: {
          includeRelationships: true,
          seedEntityIds: [seed],
          size: 10,
          traversal: { depth: 1, direction: 'BOTH' },
        },
      }),
      201,
      searchAssertion,
    );
  },
  search_semantic() {
    record(
      'search_semantic',
      send('search_semantic', 'POST', projectPath('/search'), {
        intent: 'semantic',
        query: pick(fixture.searchTerms),
        embeddings: { maxResults: 10 },
      }),
      201,
      searchAssertion,
    );
  },
  write_scratch_edit() {
    const id = distributed
      ? fixtureManifest.assignments[__VU - 1].scratchTaskId
      : fixture.scratchTaskIds[(__VU - 1) % fixture.scratchTaskIds.length];
    const content = `Edited by ${config.runId} VU ${__VU} iteration ${__ITER}.`;
    record(
      'write_scratch_edit',
      send('write_scratch_edit', 'PATCH', projectPath(`/work-items/${id}`), {
        sections: [
          {
            key: 'description',
            order: 0,
            content,
          },
        ],
        reason: 'Activity diagnostic scratch edit',
      }),
      200,
      (data) =>
        isRecord(data) &&
        data.status === 'APPLIED' &&
        isRecord(data.task) &&
        data.task.id === id &&
        Array.isArray(data.task.sections) &&
        data.task.sections.some(
          (section) =>
            isRecord(section) &&
            section.key === 'description' &&
            section.materializedMarkdown === content,
        ),
    );
  },
  write_scratch_add() {
    const name = `Scratch addition ${config.runId} vu${__VU} it${__ITER}`;
    record(
      'write_scratch_add',
      send('write_scratch_add', 'POST', projectPath('/work-items'), {
        name,
        type: 'STANDARD',
        status: 'BACKLOG',
        priority: 'LOW',
        source: 'user',
        parentTaskId: fixture.scratchFeatureId,
        sections: [
          {
            key: 'description',
            order: 0,
            content: 'Added by a measured activity run.',
          },
        ],
      }),
      201,
      (data) => isRecord(data) && data.name === name,
    );
  },
  session_queued_inputs() {
    record(
      'session_queued_inputs',
      send(
        'session_queued_inputs',
        'GET',
        projectPath(`/conversations/${session.conversationId}/queued-inputs`),
      ),
      200,
      (data) => data !== undefined,
    );
  },
  conversation_read() {
    record(
      'conversation_read',
      send(
        'conversation_read',
        'GET',
        projectPath(`/conversations/${session.conversationId}`),
      ),
      200,
      (data) => isRecord(data) && data.id === session.conversationId,
    );
  },
  conversation_messages() {
    record(
      'conversation_messages',
      send(
        'conversation_messages',
        'GET',
        projectPath(
          `/messages?conversationId=${session.conversationId}&limit=50`,
        ),
      ),
      200,
      (data) =>
        Array.isArray(data) || (isRecord(data) && Array.isArray(data.items)),
    );
  },
  session_read() {
    record(
      'session_read',
      send(
        'session_read',
        'GET',
        projectPath(`/agent-sessions/${session.agentSessionId}`),
      ),
      200,
      (data) => isRecord(data) && data.id === session.agentSessionId,
    );
  },
  session_current_state() {
    record(
      'session_current_state',
      send(
        'session_current_state',
        'POST',
        projectPath('/agent-sessions/current-state:batch'),
        { agentSessionIds: [session.agentSessionId] },
      ),
      200,
      (data) => isRecord(data) && Array.isArray(data.items),
    );
  },
  // A passive SYSTEM projection: persisted like any message write but never
  // executable, so it cannot trigger an agent turn.
  session_message_write() {
    record(
      'session_message_write',
      send('session_message_write', 'POST', projectPath('/messages'), {
        conversationId: session.conversationId,
        projectId: fixture.projectId,
        type: 'SYSTEM',
        data: {
          type: 'NOOP',
          title: `Activity diagnostic ${config.runId} vu${__VU} it${__ITER}`,
        },
      }),
      201,
      (data) =>
        isRecord(data) && data.conversationId === session.conversationId,
    );
  },
};

function thinkTimeIteration(data) {
  const { min, max } = mix.thinkTimeSeconds;
  if (accessToken === undefined) {
    accessToken = data.tokens[__VU - 1];
    // Stagger first actions so users don't arrive in lockstep.
    sleep(Math.random() * max);
  }
  const action = pickAction(weightedActions);
  actions[action]();
  sleep(min + Math.random() * (max - min));
}

// Heavy users burst for one window per period; offsets are spread across
// heavy users so bursts are staggered rather than simultaneous.
function requestsPerMinuteAt(cohort, elapsedSeconds) {
  const profile = mix.cohorts[cohort];
  if (!profile.burst) return profile.requestsPerMinute;
  const { burst } = profile;
  const heavyUsers = Math.max(1, Math.floor(config.vus / profile.everyNthUser));
  const heavyIndex = __VU / profile.everyNthUser - 1;
  const offset =
    burst.firstAtSeconds + (heavyIndex * burst.periodSeconds) / heavyUsers;
  if (elapsedSeconds < offset) return profile.requestsPerMinute;
  const intoPeriod = (elapsedSeconds - offset) % burst.periodSeconds;
  return intoPeriod < burst.durationSeconds
    ? burst.requestsPerMinute
    : profile.requestsPerMinute;
}

let startedAt;
let nextSlotAt;
let nextSearchAt;

// Open-loop pacing per user: each slot is due at a scheduled time. When a
// response arrives after later slots were due, those slots are counted as
// missed, so a slowing API lowers completed—not offered—traffic.
function pacedIteration(data) {
  const cohort = cohortOf(__VU);
  const now = Date.now() / 1000;
  if (accessToken === undefined) {
    accessToken = data.tokens[__VU - 1];
    session = data.sessions[__VU - 1];
    startedAt = now;
    nextSlotAt = now + Math.random() * 2;
    nextSearchAt = now + Math.random() * (60 / mix.searchesPerMinute);
  }
  if (nextSlotAt > now) sleep(nextSlotAt - now);
  const slotAt = nextSlotAt;
  const interval = 60 / requestsPerMinuteAt(cohort, slotAt - startedAt);
  nextSlotAt = slotAt + interval;
  offeredSlots.add(1, { cohort });

  if (slotAt >= nextSearchAt) {
    nextSearchAt += 60 / mix.searchesPerMinute;
    actions[pickAction(weightedSearches)]();
  } else {
    actions[pickAction(weightedActions)]();
  }

  const finishedAt = Date.now() / 1000;
  while (nextSlotAt + interval <= finishedAt) {
    offeredSlots.add(1, { cohort });
    missedSlots.add(1, { cohort });
    nextSlotAt += interval;
  }
}

export default function (data) {
  if (distributed && accessToken === undefined) {
    const assignment = fixtureManifest.assignments[__VU - 1];
    fixture = fixtureManifest.projects[Math.floor(assignment.userIndex / 2)];
    featureIds = fixture.features.map((feature) => feature.id);
    taskIds = fixture.tasks.map((task) => task.id);
    allIds = new Set([...featureIds, ...taskIds, fixture.hubFeatureId]);
  }
  if (paced) pacedIteration(data);
  else thinkTimeIteration(data);
}
