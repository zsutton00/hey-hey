// One-time, idempotent setup for the activity diagnostic. Everything here runs
// outside the measurement window and uses only the public API with a dedicated
// user's credentials, so it exercises the same authorization users do.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FIXTURE_VERSION = 2;
const USER_AGENT = 'hey-hey-api-diagnostic-seed/1';
const HUB_EDGE_TARGET = 50;
const EDGE_TYPES = ['RELATED_TO', 'DEPENDS_ON', 'DERIVES_FROM', 'EVOLVES'];
const SCRATCH_TASK_COUNT = 10;

// Deterministic product shape: 12 product areas × (1 area + 4 sub-features) = 60
// features, 4 tasks under each sub-feature. Vocabulary is varied on purpose so
// search has distinct things to find.
const AREAS = [
  {
    name: 'Billing',
    terms: ['invoice', 'subscription', 'proration', 'refund'],
    subs: [
      'Invoice History',
      'Plan Upgrades',
      'Usage Metering',
      'Refund Requests',
    ],
  },
  {
    name: 'Notifications',
    terms: ['digest', 'webhook', 'mention', 'quiet hours'],
    subs: [
      'Email Digests',
      'Webhook Delivery',
      'Mention Alerts',
      'Quiet Hours',
    ],
  },
  {
    name: 'Reporting',
    terms: ['dashboard', 'export', 'cohort', 'burndown'],
    subs: [
      'Activity Dashboard',
      'CSV Export',
      'Cohort Analysis',
      'Burndown Charts',
    ],
  },
  {
    name: 'Team Collaboration',
    terms: ['comment', 'presence', 'handoff', 'review'],
    subs: [
      'Threaded Comments',
      'Live Presence',
      'Work Handoff',
      'Review Requests',
    ],
  },
  {
    name: 'Project Search',
    terms: ['ranking', 'synonym', 'facet', 'recency'],
    subs: [
      'Ranked Results',
      'Synonym Matching',
      'Faceted Filters',
      'Recent Items',
    ],
  },
  {
    name: 'Onboarding',
    terms: ['checklist', 'invite', 'template', 'tour'],
    subs: [
      'Setup Checklist',
      'Team Invites',
      'Starter Templates',
      'Guided Tour',
    ],
  },
];
AREAS.push(
  {
    name: 'Account Management',
    terms: ['profile', 'identity', 'session', 'preferences'],
    subs: [
      'Member Profiles',
      'Sign In',
      'Session History',
      'Personal Preferences',
    ],
  },
  {
    name: 'File Management',
    terms: ['attachment', 'folder', 'preview', 'version'],
    subs: [
      'Task Attachments',
      'Shared Folders',
      'File Previews',
      'Version History',
    ],
  },
  {
    name: 'Scheduling',
    terms: ['calendar', 'deadline', 'milestone', 'availability'],
    subs: [
      'Team Calendar',
      'Due Dates',
      'Project Milestones',
      'Team Availability',
    ],
  },
  {
    name: 'Customer Feedback',
    terms: ['survey', 'rating', 'interview', 'insight'],
    subs: [
      'Customer Surveys',
      'Product Ratings',
      'Research Interviews',
      'Feedback Insights',
    ],
  },
  {
    name: 'Automation',
    terms: ['trigger', 'rule', 'approval', 'execution'],
    subs: [
      'Event Triggers',
      'Automation Rules',
      'Approval Requests',
      'Execution History',
    ],
  },
  {
    name: 'Access Management',
    terms: ['role', 'permission', 'guest', 'audit'],
    subs: ['Team Roles', 'Project Permissions', 'Guest Access', 'Access Audit'],
  },
);
const TASK_VERBS = [
  ['Define', 'data model and validation rules'],
  ['Build', 'API endpoint with pagination'],
  ['Render', 'page states for empty, loading, and error'],
  ['Measure', 'adoption and failure rates'],
];
const HUB_SUB = 'Activity Dashboard';
const SCRATCH_FEATURE = 'Diagnostic Scratch Area';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(process.env[name]?.trim() || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function log(message, fields = {}) {
  console.log(
    JSON.stringify({ at: new Date().toISOString(), message, ...fields }),
  );
}

export function readAuthUsers() {
  const file = process.env.K6_AUTH_USERS_FILE?.trim();
  const raw = file
    ? readFileSync(file, 'utf8')
    : required('K6_AUTH_USERS_JSON');
  const users = JSON.parse(raw);
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('Dedicated users must be a non-empty JSON array');
  }
  return users;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

export class Api {
  constructor(baseUrl, browserOrigin) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.browserOrigin = browserOrigin;
    this.sequence = 0;
  }

  async login(user) {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: this.browserOrigin,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    const body = await response.json().catch(() => undefined);
    const auth = body?.data;
    if (response.status !== 200 || !auth?.accessToken || !auth?.user?.id) {
      throw new Error(
        `Login failed for a dedicated user (HTTP ${response.status})`,
      );
    }
    return {
      accessToken: auth.accessToken,
      organizationId: user.organizationId ?? auth.user.currentOrganizationId,
      userId: auth.user.id,
    };
  }

  async request(session, method, path, body, expected = [200, 201]) {
    this.sequence += 1;
    const correlationId = `activity-seed-${process.pid}-${this.sequence}`;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
        'x-correlation-id': correlationId,
        'x-request-id': correlationId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const parsed = await response.json().catch(() => undefined);
    if (!expected.includes(response.status) || parsed?.success !== true) {
      const code = parsed?.error?.code ?? parsed?.code ?? parsed?.message;
      throw new Error(
        `${method} ${path} failed (HTTP ${response.status}${code ? `, ${JSON.stringify(code)}` : ''})`,
      );
    }
    return parsed.data;
  }
}

function projectsPath(session, suffix = '') {
  return `/api/v1/organizations/${session.organizationId}/projects${suffix}`;
}

function scoped(session, projectId, suffix) {
  return projectsPath(session, `/${projectId}${suffix}`);
}

export function fixtureSpec() {
  const features = [];
  const tasks = [];
  for (const area of AREAS) {
    features.push({
      key: area.name,
      name: area.name,
      parentKey: null,
      tag: 'product',
      description: `${area.name} is a product area covering ${area.terms.join(', ')} for teams of every size.`,
    });
    area.subs.forEach((sub, subIndex) => {
      const term = area.terms[subIndex];
      features.push({
        key: `${area.name}/${sub}`,
        name: sub,
        parentKey: area.name,
        tag: subIndex % 2 === 0 ? 'backend' : 'frontend',
        description: `${sub} lets a team manage ${term} work inside ${area.name}. It covers ${term} lifecycle, permissions, and audit history.`,
      });
      for (const [verb, object] of TASK_VERBS) {
        tasks.push({
          key: `${area.name}/${sub}/${verb}`,
          name: `${verb} ${sub.toLowerCase()} ${object}`,
          parentKey: `${area.name}/${sub}`,
          description: `${verb} the ${term} ${object} for ${sub}. Keep ${area.terms[(subIndex + 1) % 4]} behavior consistent with neighbouring ${area.name} work.`,
        });
      }
    });
  }
  features.push({
    key: SCRATCH_FEATURE,
    name: SCRATCH_FEATURE,
    parentKey: null,
    tag: 'infra',
    description:
      'Holds the work items the activity diagnostic edits and adds during measured runs, so the measured fixture stays comparable.',
    scratch: true,
  });
  for (let index = 1; index <= SCRATCH_TASK_COUNT; index += 1) {
    tasks.push({
      key: `${SCRATCH_FEATURE}/${index}`,
      name: `Diagnostic scratch item ${index}`,
      parentKey: SCRATCH_FEATURE,
      description: 'Edited by measured runs.',
      scratch: true,
    });
  }
  return { features, tasks };
}

// Cross-hierarchy edges: each sub-feature relates to the matching sub-feature
// in the next area, each task's later steps depend on its first step, and the
// hub sub-feature fans out to HUB_EDGE_TARGET entities outside its subtree.
export function edgeSpec(spec) {
  const edges = [];
  const subs = spec.features.filter((f) => f.parentKey && !f.scratch);
  subs.forEach((sub, index) => {
    for (const offset of [4, 8, 12]) {
      const next = subs[(index + offset) % subs.length];
      edges.push({ source: sub.key, target: next.key, type: 'RELATED_TO' });
    }
  });
  for (const sub of subs) {
    const children = spec.tasks.filter((t) => t.parentKey === sub.key);
    for (const child of children.slice(1)) {
      edges.push({
        source: child.key,
        target: children[0].key,
        type: 'DEPENDS_ON',
      });
    }
  }
  const hubKey = `Reporting/${HUB_SUB}`;
  const hubTargets = [
    ...subs.filter((f) => f.parentKey !== 'Reporting'),
    ...spec.tasks.filter((t) => !t.scratch && t.parentKey !== hubKey),
  ].filter(
    (target) =>
      !edges.some(
        (edge) => edge.source === hubKey && edge.target === target.key,
      ),
  );
  const hubEdgeCount = edges.filter((edge) => edge.source === hubKey).length;
  hubTargets
    .filter((_, index) => index % 2 === 0)
    .slice(0, HUB_EDGE_TARGET - hubEdgeCount)
    .forEach((target, index) => {
      edges.push({
        source: hubKey,
        target: target.key,
        type: EDGE_TYPES[index % EDGE_TYPES.length],
      });
    });
  return { edges, hubKey };
}

function sections(description, acceptance) {
  return [
    { key: 'description', content: description, order: 0 },
    ...(acceptance
      ? [{ key: 'acceptanceCriteria', content: acceptance, order: 1 }]
      : []),
  ];
}

function draftName(name) {
  return `${name} (draft)`;
}

export async function findOrCreateProject(api, session, projectName) {
  const projects = await api.request(session, 'GET', projectsPath(session));
  const existing = projects.find((project) => project.name === projectName);
  if (existing) {
    await ensureActiveProject(api, session, existing);
    log('fixture project found', { projectId: existing.id });
    return existing.id;
  }
  const created = await api.request(session, 'POST', projectsPath(session), {
    name: projectName,
    description:
      'Persistent fixture for the authenticated activity diagnostic.',
  });
  log('fixture project created', { projectId: created.id });
  await ensureActiveProject(api, session, created);
  return created.id;
}

async function ensureActiveProject(api, session, project) {
  if (project.status === 'ACTIVE') return;
  const result = await api.request(
    session,
    'PATCH',
    projectsPath(session, `/${project.id}`),
    { status: 'ACTIVE' },
  );
  if (result.status !== 'ACTIVE') {
    throw new Error('Fixture project activation did not return ACTIVE');
  }
}

async function ensureMembers(api, owner, projectId, userIds) {
  const page = await api.request(
    owner,
    'GET',
    scoped(owner, projectId, '/members?limit=200'),
  );
  const members = new Set(page.members.map((member) => member.userId));
  for (const userId of userIds) {
    if (members.has(userId)) continue;
    await api.request(owner, 'POST', scoped(owner, projectId, '/members'), {
      userId,
      role: 'MEMBER',
    });
    log('fixture member added', { userId });
  }
}

async function approveIfPending(api, session, projectId, result) {
  if (result.status !== 'PENDING' || !result.proposal?.id) return;
  await api.request(
    session,
    'PATCH',
    scoped(session, projectId, `/proposals/${result.proposal.id}`),
    { status: 'APPROVED' },
  );
}

// Each entity is created under a draft name, then renamed with its full
// sections through a PATCH. The PATCH goes through the proposal path, which
// leaves real proposal history on every fixture entity. A draft-named item
// on rerun means the PATCH never landed, so it is resumed rather than
// duplicated.
export async function ensureWorkItem(
  api,
  session,
  projectId,
  byName,
  item,
  ids,
  type,
) {
  const existing = byName.get(item.name);
  if (existing) {
    ids.set(item.key, existing.id);
    return;
  }
  let draft = byName.get(draftName(item.name));
  if (!draft) {
    draft = await api.request(
      session,
      'POST',
      scoped(session, projectId, '/work-items'),
      {
        name: draftName(item.name),
        type,
        status: 'BACKLOG',
        priority: 'MEDIUM',
        source: 'user',
        ...(item.parentKey ? { parentTaskId: ids.get(item.parentKey) } : {}),
        ...(item.tag ? { tag: item.tag } : {}),
        sections: sections(item.description),
      },
    );
  }
  const updated = await api.request(
    session,
    'PATCH',
    scoped(session, projectId, `/work-items/${draft.id}`),
    {
      name: item.name,
      sections: sections(
        item.description,
        type === 'STANDARD'
          ? `- ${item.name} is reachable from its parent and searchable by name.`
          : undefined,
      ),
      reason: 'Activity diagnostic fixture content',
    },
  );
  await approveIfPending(api, session, projectId, updated);
  ids.set(item.key, draft.id);
  log('fixture work item ready', { type, name: item.name });
}

async function listEdges(api, session, projectId, sourceId) {
  const page = await api.request(
    session,
    'GET',
    scoped(
      session,
      projectId,
      `/agent-edges?sourceNodeId=${sourceId}&size=100`,
    ),
  );
  return Array.isArray(page) ? page : (page.content ?? []);
}

async function ensureEdges(api, session, projectId, edges, ids) {
  const bySource = new Map();
  for (const edge of edges) {
    const sourceId = ids.get(edge.source);
    if (!bySource.has(sourceId)) {
      const existing = await listEdges(api, session, projectId, sourceId);
      bySource.set(
        sourceId,
        new Set(existing.map((e) => `${e.targetNodeId}:${e.type}`)),
      );
    }
    const targetId = ids.get(edge.target);
    const known = bySource.get(sourceId);
    if (known.has(`${targetId}:${edge.type}`)) continue;
    await api.request(
      session,
      'POST',
      scoped(session, projectId, '/agent-edges'),
      {
        sourceNodeId: sourceId,
        sourceEntityType: 'TASK',
        targetNodeId: targetId,
        targetEntityType: 'TASK',
        type: edge.type,
        category: 'meta',
        reasoning: `Activity diagnostic fixture: ${edge.source} ${edge.type} ${edge.target}`,
      },
    );
    known.add(`${targetId}:${edge.type}`);
  }
  log('fixture edges ready', { edges: edges.length });
}

// Measured runs add items under the scratch feature. Archiving them here
// returns the fixture to its seeded shape before the next run.
async function resetScratch(
  api,
  session,
  projectId,
  items,
  scratchFeatureId,
  keepIds,
) {
  const extras = items.filter(
    (item) =>
      item.parentTaskId === scratchFeatureId &&
      !keepIds.has(item.id) &&
      !item.archivedAt &&
      item.status !== 'ARCHIVED',
  );
  for (const extra of extras) {
    await api.request(
      session,
      'DELETE',
      scoped(session, projectId, `/work-items/${extra.id}`),
    );
  }
  log('scratch reset', { archived: extras.length });
  return extras.length;
}

export async function waitForReadiness(
  api,
  session,
  projectId,
  manifest,
  timeoutMs,
) {
  const deadline = Date.now() + timeoutMs;
  const readiness = { graph: false, search: false };
  const knownIds = new Set([
    ...manifest.features.map((f) => f.id),
    ...manifest.tasks.map((t) => t.id),
  ]);
  while (Date.now() < deadline) {
    if (!readiness.graph) {
      const context = await api.request(
        session,
        'GET',
        scoped(
          session,
          projectId,
          `/entities/TASK/${manifest.hubFeatureId}/context?includeRelatedEntities=true&includeFeatureHierarchy=true&includeProposals=true&includeAvailableMcpTools=false&includePlan=false`,
        ),
      );
      const related = context.relatedEntities?.length ?? 0;
      const hubEdges = await listEdges(
        api,
        session,
        projectId,
        manifest.hubFeatureId,
      );
      readiness.graph =
        hubEdges.length === manifest.edgeCounts.hub && related > 0;
      readiness.graphHubEdges = hubEdges.length;
      readiness.graphRelatedEntities = related;
      readiness.contextHubCounts = {
        relatedEntities: related,
        featureHierarchy: context.featureHierarchy.length,
      };
    }
    if (!readiness.search) {
      let hits = 0;
      for (const term of manifest.searchTerms) {
        const result = await api.request(
          session,
          'POST',
          scoped(session, projectId, '/search'),
          { intent: 'semantic', query: term, embeddings: { maxResults: 5 } },
        );
        const ids = (result.results ?? []).map((r) => r.entityId);
        if (ids.some((id) => knownIds.has(id))) hits += 1;
      }
      readiness.search = hits === manifest.searchTerms.length;
      readiness.searchTermsHit = hits;
    }
    if (readiness.graph && readiness.search) {
      return { ...readiness, readyAt: new Date().toISOString() };
    }
    log('waiting for projection and embeddings', readiness);
    await sleep(10_000);
  }
  throw new Error(
    `Fixture not ready after ${timeoutMs}ms: ${JSON.stringify(readiness)}`,
  );
}

function contentHash(spec, edges) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ version: FIXTURE_VERSION, spec, edges }));
  return hash.digest('hex');
}

export async function reuseActivityFixture(api, owner, manifest, timeoutMs) {
  if (
    manifest.fixtureVersion !== FIXTURE_VERSION ||
    manifest.organizationId !== owner.organizationId
  ) {
    throw new Error('Pinned fixture version or organization differs');
  }
  const project = await api.request(
    owner,
    'GET',
    scoped(owner, manifest.projectId, ''),
  );
  if (
    project.id !== manifest.projectId ||
    project.organizationId !== manifest.organizationId
  ) {
    throw new Error('Pinned fixture project ownership differs');
  }
  const items = await api.request(
    owner,
    'GET',
    scoped(owner, manifest.projectId, '/work-items?limit=1000'),
  );
  const scratchArchivedBeforeRun = await resetScratch(
    api,
    owner,
    manifest.projectId,
    items,
    manifest.scratchFeatureId,
    new Set(manifest.scratchTaskIds),
  );
  const readiness = await waitForReadiness(
    api,
    owner,
    manifest.projectId,
    manifest,
    timeoutMs,
  );
  return {
    ...manifest,
    scratchArchivedBeforeRun,
    readiness,
    reusedAt: new Date().toISOString(),
  };
}

export async function seedActivityFixture(options = {}) {
  const baseUrl = required('K6_BASE_URL');
  const browserOrigin = required('K6_BROWSER_ORIGIN');
  const projectName =
    options.projectName ||
    process.env.ACTIVITY_FIXTURE_PROJECT_NAME?.trim() ||
    `diag-activity-fixture-v${FIXTURE_VERSION}`;
  const manifestPath = resolve(
    options.manifestPath ||
      process.env.ACTIVITY_FIXTURE_MANIFEST?.trim() ||
      'artifacts/api-diagnostic/activity-fixture-manifest.json',
  );
  const readinessTimeoutMs = positiveInteger(
    'ACTIVITY_FIXTURE_READINESS_TIMEOUT_MS',
    600_000,
  );

  const api = new Api(baseUrl, browserOrigin);
  const users = options.users ?? readAuthUsers();
  const sessions = [];
  for (const user of users) sessions.push(await api.login(user));
  const owner = sessions[0];
  if (sessions.some((s) => s.organizationId !== owner.organizationId)) {
    throw new Error('All dedicated users must share one organization');
  }

  if (options.pinned || process.env.ACTIVITY_EXISTING_FIXTURE_MANIFEST) {
    const sourcePath = options.pinned
      ? undefined
      : resolve(process.env.ACTIVITY_EXISTING_FIXTURE_MANIFEST);
    if (sourcePath === manifestPath)
      throw new Error('Reuse output must not overwrite the pinned manifest');
    const pinned =
      options.pinned ?? JSON.parse(readFileSync(sourcePath, 'utf8'));
    const manifest = await reuseActivityFixture(
      api,
      owner,
      pinned,
      readinessTimeoutMs,
    );
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return { manifest, manifestPath };
  }

  const projectId = await findOrCreateProject(api, owner, projectName);
  await ensureMembers(
    api,
    owner,
    projectId,
    sessions.slice(1).map((s) => s.userId),
  );

  const spec = fixtureSpec();
  const { edges, hubKey } = edgeSpec(spec);
  const items = (
    await api.request(
      owner,
      'GET',
      scoped(owner, projectId, '/work-items?limit=1000'),
    )
  ).filter((item) => item.projectId === projectId);
  const byName = new Map(
    items
      .filter((item) => !item.archivedAt && item.status !== 'ARCHIVED')
      .map((item) => [item.name, item]),
  );
  const ids = new Map();
  for (const feature of spec.features) {
    await ensureWorkItem(
      api,
      owner,
      projectId,
      byName,
      feature,
      ids,
      'FEATURE',
    );
  }
  for (const task of spec.tasks) {
    await ensureWorkItem(api, owner, projectId, byName, task, ids, 'STANDARD');
  }
  await ensureEdges(api, owner, projectId, edges, ids);

  const scratchFeatureId = ids.get(SCRATCH_FEATURE);
  const scratchTaskIds = spec.tasks
    .filter((t) => t.scratch)
    .map((t) => ids.get(t.key));
  const scratchArchived = await resetScratch(
    api,
    owner,
    projectId,
    items,
    scratchFeatureId,
    new Set(scratchTaskIds),
  );

  const manifest = {
    fixtureVersion: FIXTURE_VERSION,
    contentHash: contentHash(spec, edges),
    organizationId: owner.organizationId,
    projectId,
    projectName,
    hubFeatureId: ids.get(hubKey),
    scratchFeatureId,
    scratchTaskIds,
    features: spec.features
      .filter((f) => !f.scratch)
      .map((f) => ({
        id: ids.get(f.key),
        name: f.name,
        parentId: f.parentKey ? ids.get(f.parentKey) : null,
      })),
    tasks: spec.tasks
      .filter((t) => !t.scratch)
      .map((t) => ({
        id: ids.get(t.key),
        name: t.name,
        featureId: ids.get(t.parentKey),
      })),
    searchTerms: AREAS.flatMap((area) => area.terms.slice(0, 2)),
    edgeCounts: {
      total: edges.length,
      hub: edges.filter((e) => e.source === hubKey).length,
    },
    scratchArchivedBeforeRun: scratchArchived,
  };
  manifest.readiness = await waitForReadiness(
    api,
    owner,
    projectId,
    manifest,
    readinessTimeoutMs,
  );
  manifest.seededAt = new Date().toISOString();

  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  log('fixture manifest written', {
    manifestPath,
    features: manifest.features.length,
    tasks: manifest.tasks.length,
    edges: manifest.edgeCounts,
  });
  return { manifest, manifestPath };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  seedActivityFixture().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
