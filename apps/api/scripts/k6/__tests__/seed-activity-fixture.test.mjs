import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureWorkItem,
  waitForReadiness,
  findOrCreateProject,
  fixtureSpec,
  edgeSpec,
  reuseActivityFixture,
} from '../seed-activity-fixture.mjs';

test('pinned fixture reuse resets only scratch additions without creating project or memberships', async () => {
  const requests = [];
  const manifest = {
    fixtureVersion: 2,
    organizationId: 'organization',
    projectId: 'project',
    scratchFeatureId: 'scratch',
    scratchTaskIds: ['keep'],
    hubFeatureId: 'hub',
    features: [{ id: 'hub' }],
    tasks: [],
    searchTerms: [],
    edgeCounts: { hub: 0 },
  };
  const api = {
    async request(session, method, path) {
      requests.push({ method, path });
      if (path.endsWith('/project'))
        return { id: 'project', organizationId: 'organization' };
      if (path.includes('/work-items?'))
        return [
          { id: 'extra', parentTaskId: 'scratch' },
          { id: 'keep', parentTaskId: 'scratch' },
        ];
      if (path.includes('/context?'))
        return { relatedEntities: [{}], featureHierarchy: [{}, {}] };
      if (path.includes('/edges')) return [];
      return {};
    },
  };
  const result = await reuseActivityFixture(
    api,
    { organizationId: 'organization' },
    manifest,
    1000,
  );
  assert.equal(result.scratchArchivedBeforeRun, 1);
  assert.equal(result.readiness.contextHubCounts.featureHierarchy, 2);
  assert.equal(requests.filter((r) => r.method === 'DELETE').length, 1);
  assert.equal(
    requests.some((r) => r.method === 'POST' || r.method === 'PATCH'),
    false,
  );
  assert.equal(manifest.readiness, undefined);
});

test('pinned fixture reuse refuses organization mismatch before reset', async () => {
  await assert.rejects(
    reuseActivityFixture(
      {
        request() {
          throw new Error('unexpected request');
        },
      },
      { organizationId: 'other' },
      { fixtureVersion: 2, organizationId: 'organization' },
      1000,
    ),
    /organization differs/,
  );
});

for (const existing of [true, false]) {
  test(`activates the ${existing ? 'existing' : 'new'} fixture outside measurement`, async () => {
    const requests = [];
    const api = {
      async request(session, method, path, body) {
        requests.push({ method, body });
        if (method === 'GET')
          return existing
            ? [{ id: 'fixture', name: 'diagnostic', status: 'ONBOARDING' }]
            : [];
        if (method === 'POST') return { id: 'fixture', status: 'ONBOARDING' };
        return { id: 'fixture', status: 'ACTIVE' };
      },
    };
    assert.equal(
      await findOrCreateProject(
        api,
        { organizationId: 'organization' },
        'diagnostic',
      ),
      'fixture',
    );
    assert.deepEqual(requests.at(-1), {
      method: 'PATCH',
      body: { status: 'ACTIVE' },
    });
  });
}

for (const type of ['FEATURE', 'STANDARD']) {
  test(`resumes a draft ${type} using its declared sections`, async () => {
    const requests = [];
    const api = {
      async request(session, method, path, body) {
        requests.push({ method, path, body });
        return {};
      },
    };
    const ids = new Map();
    await ensureWorkItem(
      api,
      { organizationId: 'organization' },
      'project',
      new Map([['Invoice History (draft)', { id: 'draft' }]]),
      {
        key: 'invoice-history',
        name: 'Invoice History',
        description: 'View searchable invoices.',
      },
      ids,
      type,
    );
    assert.equal(requests.length, 1, 'resume without creating a duplicate');
    assert.equal(requests[0].method, 'PATCH');
    assert.deepEqual(
      requests[0].body.sections.map((section) => section.key),
      type === 'FEATURE'
        ? ['description']
        : ['description', 'acceptanceCriteria'],
    );
    assert.equal(
      requests[0].body.sections[0].content,
      'View searchable invoices.',
    );
    assert.equal(ids.get('invoice-history'), 'draft');
  });
}

test('records actual context counts separately from stored edges and search readiness', async () => {
  const requests = [];
  const api = {
    async request(session, method, path) {
      requests.push(path);
      if (path.includes('/context?'))
        return {
          relatedEntities: Array(9).fill({}),
          featureHierarchy: Array(20).fill({}),
        };
      if (path.includes('/agent-edges?')) {
        assert.ok(path.endsWith('&size=100'));
        return { content: Array(50).fill({}) };
      }
      return { results: [{ entityId: 'hub' }] };
    },
  };
  const readiness = await waitForReadiness(
    api,
    { organizationId: 'organization' },
    'project',
    {
      features: [{ id: 'hub' }],
      tasks: [],
      hubFeatureId: 'hub',
      edgeCounts: { hub: 50 },
      searchTerms: ['invoice'],
    },
    1000,
  );
  assert.equal(readiness.graph, true);
  assert.equal(readiness.search, true);
  assert.equal(readiness.graphHubEdges, 50);
  assert.equal(readiness.graphRelatedEntities, 9);
  assert.deepEqual(readiness.contextHubCounts, {
    relatedEntities: 9,
    featureHierarchy: 20,
  });
  assert.equal(requests.length, 3);
});

test('v2 fixture has cross-branch feature edges and the requested persistent shape', () => {
  const spec = fixtureSpec();
  const { edges, hubKey } = edgeSpec(spec);
  assert.equal(spec.features.filter((f) => !f.scratch).length, 60);
  assert.equal(spec.tasks.filter((t) => !t.scratch).length, 192);
  assert.ok(edges.length >= 290);
  assert.equal(edges.filter((edge) => edge.source === hubKey).length, 50);
  const features = new Map(
    spec.features.map((feature) => [feature.key, feature]),
  );
  const crossBranch = edges.filter(
    (edge) => features.has(edge.source) && features.has(edge.target),
  );
  assert.ok(crossBranch.length >= 144);
  assert.ok(
    crossBranch.every(
      (edge) =>
        features.get(edge.source).parentKey !==
        features.get(edge.target).parentKey,
    ),
  );
});
