import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  distributionHash,
  validateDistribution,
} from '../distributed-activity-fixture.mjs';

function fixture() {
  const projects = Array.from({ length: 25 }, (_, index) => ({
    projectId: `project-${index}`,
    organizationId: 'organization',
    fixtureVersion: 2,
    contentHash: 'equivalent-content',
    features: Array(60).fill({}),
    tasks: Array(192).fill({}),
    edgeCounts: { total: 335 },
    scratchTaskIds: [`scratch-${index}-0`, `scratch-${index}-1`],
  }));
  const assignments = Array.from({ length: 50 }, (_, userIndex) => ({
    userIndex,
    userId: `user-${userIndex}`,
    projectId: projects[Math.floor(userIndex / 2)].projectId,
    scratchTaskId:
      projects[Math.floor(userIndex / 2)].scratchTaskIds[userIndex % 2],
    agentSessionId: `session-${userIndex}`,
    conversationId: `conversation-${userIndex}`,
  }));
  return {
    distributionVersion: 1,
    organizationId: 'organization',
    projects,
    assignments,
    contentHash: distributionHash(projects, assignments),
  };
}

test('stable pairs retain separate scratch/session records and equivalent projects', () => {
  const manifest = fixture();
  assert.equal(validateDistribution(manifest), manifest);
  const reorderedProperties = manifest.assignments.map((a) => ({
    conversationId: a.conversationId,
    ...a,
  }));
  assert.equal(
    distributionHash(manifest.projects, reorderedProperties),
    manifest.contentHash,
  );
});

for (const [name, mutate] of [
  [
    'cross-project routing',
    (m) => {
      m.assignments[0].projectId = m.projects[1].projectId;
    },
  ],
  [
    'shared scratch targets',
    (m) => {
      m.assignments[1].scratchTaskId = m.assignments[0].scratchTaskId;
    },
  ],
  [
    'shared sessions',
    (m) => {
      m.assignments[1].agentSessionId = m.assignments[0].agentSessionId;
    },
  ],
  [
    'different fixture content',
    (m) => {
      m.projects[1].contentHash = 'different';
    },
  ],
  [
    'organization drift',
    (m) => {
      m.projects[1].organizationId = 'different';
    },
  ],
  [
    'changed identity order',
    (m) => {
      m.assignments[0].userIndex = 1;
    },
  ],
  [
    'modified routing hash',
    (m) => {
      m.contentHash = 'different';
    },
  ],
]) {
  test(`refuses ${name} before reuse`, () => {
    const manifest = fixture();
    mutate(manifest);
    assert.throws(() => validateDistribution(manifest));
  });
}
