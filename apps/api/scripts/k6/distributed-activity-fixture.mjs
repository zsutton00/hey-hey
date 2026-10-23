import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Api,
  readAuthUsers,
  seedActivityFixture,
} from './seed-activity-fixture.mjs';

export function validateDistribution(manifest) {
  if (
    manifest.distributionVersion !== 1 ||
    manifest.projects.length !== 25 ||
    manifest.assignments.length !== 50
  ) {
    throw new Error(
      'Distributed fixture requires version 1, 25 projects and 50 users',
    );
  }
  const projectIds = new Set(manifest.projects.map((p) => p.projectId));
  if (projectIds.size !== 25)
    throw new Error('Distributed project IDs must be unique');
  for (const [index, assignment] of manifest.assignments.entries()) {
    const project = manifest.projects[Math.floor(index / 2)];
    if (
      assignment.userIndex !== index ||
      assignment.projectId !== project.projectId ||
      !assignment.userId ||
      !assignment.agentSessionId ||
      !assignment.conversationId ||
      !project.scratchTaskIds.includes(assignment.scratchTaskId)
    ) {
      throw new Error(
        'Distributed assignment is incomplete or differs from its stable pair',
      );
    }
    if (
      project.organizationId !== manifest.organizationId ||
      project.fixtureVersion !== 2 ||
      project.features.length !== 60 ||
      project.tasks.length !== 192 ||
      project.edgeCounts.total !== 335 ||
      project.contentHash !== manifest.projects[0].contentHash
    ) {
      throw new Error(
        'Distributed projects must have equivalent v2 content in one organization',
      );
    }
  }
  for (const key of [
    'userId',
    'scratchTaskId',
    'agentSessionId',
    'conversationId',
  ]) {
    if (new Set(manifest.assignments.map((a) => a[key])).size !== 50)
      throw new Error(`Distributed ${key} values must be unique`);
  }
  if (
    manifest.contentHash !==
    distributionHash(manifest.projects, manifest.assignments)
  )
    throw new Error('Distributed routing hash differs');
  return manifest;
}

export function distributionHash(projects, assignments) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        distributionVersion: 1,
        projects: projects.map((p) => ({
          projectId: p.projectId,
          contentHash: p.contentHash,
        })),
        assignments: assignments.map(
          ({
            userIndex,
            userId,
            projectId,
            scratchTaskId,
            agentSessionId,
            conversationId,
          }) => ({
            userIndex,
            userId,
            projectId,
            scratchTaskId,
            agentSessionId,
            conversationId,
          }),
        ),
      }),
    )
    .digest('hex');
}

export async function prepareDistributedFixture({ provision = false } = {}) {
  if (
    provision &&
    process.env.ACTIVITY_DISTRIBUTED_PROVISION_CONFIRMED !== 'yes'
  ) {
    throw new Error(
      'One-time project and membership provisioning requires explicit staging confirmation',
    );
  }
  const output = resolve(
    process.env.ACTIVITY_FIXTURE_MANIFEST ||
      'artifacts/api-diagnostic/distributed-fixture-manifest.json',
  );
  const source = process.env.ACTIVITY_EXISTING_FIXTURE_MANIFEST;
  if (!provision && !source)
    throw new Error('Daily distributed runs require a pinned manifest');
  if (source && resolve(source) === output)
    throw new Error('Reuse output must not overwrite the pinned manifest');
  const pinned = source
    ? validateDistribution(JSON.parse(readFileSync(source, 'utf8')))
    : undefined;
  const users = readAuthUsers().slice(0, 50);
  if (users.length !== 50)
    throw new Error('Fifty existing diagnostic users are required');
  const api = new Api(process.env.K6_BASE_URL, process.env.K6_BROWSER_ORIGIN);
  const sessions = [];
  for (const user of users) sessions.push(await api.login(user));
  const owner = sessions[0];
  if (sessions.some((s) => s.organizationId !== owner.organizationId))
    throw new Error('Diagnostic users must share one organization');
  if (provision) {
    if (
      new URL(process.env.K6_BASE_URL).origin !== 'https://staging.heyhey.dev'
    )
      throw new Error('Distributed provisioning is scoped to the staging API');
    const root = `/api/v1/organizations/${owner.organizationId}`;
    const entitlement = await api.request(
      owner,
      'GET',
      `${root}/project-entitlement`,
    );
    const existing = await api.request(owner, 'GET', `${root}/projects`);
    const names = new Set(existing.map((project) => project.name));
    const missing = Array.from(
      { length: 25 },
      (_, pair) =>
        `diag-activity-distributed-v1-${String(pair + 1).padStart(2, '0')}`,
    ).filter((name) => !names.has(name)).length;
    const requiredLimit = entitlement.usage.projectCount + missing;
    if (entitlement.projectLimit < requiredLimit)
      throw new Error(
        `Project limit ${entitlement.projectLimit} is insufficient; confirmed headroom of ${requiredLimit} is required before provisioning`,
      );
  }
  // Verify all routing and access before resetting any project on daily reuse.
  if (pinned) {
    for (const assignment of pinned.assignments) {
      const user = sessions[assignment.userIndex];
      if (
        user.userId !== assignment.userId ||
        user.organizationId !== pinned.organizationId
      )
        throw new Error(
          'Credential ordering or organization differs from pinned routing',
        );
      const prefix = `/api/v1/organizations/${user.organizationId}/projects/${assignment.projectId}`;
      await api.request(user, 'GET', prefix);
      const session = await api.request(
        user,
        'GET',
        `${prefix}/agent-sessions/${assignment.agentSessionId}`,
      );
      const conversation = await api.request(
        user,
        'GET',
        `${prefix}/conversations/${assignment.conversationId}`,
      );
      if (
        session.id !== assignment.agentSessionId ||
        conversation.id !== assignment.conversationId
      )
        throw new Error('Pinned session records differ');
    }
  }
  const projects = [];
  const assignments = [];
  for (let pair = 0; pair < 25; pair++) {
    const pairUsers = users.slice(pair * 2, pair * 2 + 2);
    const { manifest: project } = await seedActivityFixture({
      users: [users[0], ...pairUsers.filter((u) => u !== users[0])],
      projectName: `diag-activity-distributed-v1-${String(pair + 1).padStart(2, '0')}`,
      manifestPath: `${output}.projects/${pair + 1}.json`,
      pinned: pinned?.projects[pair],
    });
    projects.push(project);
    for (let member = 0; member < 2; member++) {
      const userIndex = pair * 2 + member;
      const user = sessions[userIndex];
      const prefix = `/api/v1/organizations/${user.organizationId}/projects/${project.projectId}`;
      await api.request(user, 'GET', prefix);
      if (pinned) {
        assignments.push(pinned.assignments[userIndex]);
        continue;
      }
      const title = `Activity diagnostic session ${userIndex + 1}`;
      const listed = await api.request(user, 'GET', `${prefix}/agent-sessions`);
      const existing = (Array.isArray(listed) ? listed : listed.items).find(
        (s) => s.title === title,
      );
      const session =
        existing ??
        (await api.request(user, 'POST', `${prefix}/agent-sessions`, {
          projectId: project.projectId,
          sessionDate: new Date().toISOString(),
          title,
          type: 'PROJECT_CONVERSATION',
        }));
      const bound = await api.request(
        user,
        'POST',
        `${prefix}/agent-sessions/${session.id}/conversation`,
        { workflowType: 'agent-session' },
      );
      assignments.push({
        userIndex,
        userId: user.userId,
        projectId: project.projectId,
        scratchTaskId: project.scratchTaskIds[member],
        agentSessionId: session.id,
        conversationId: bound.conversation.id,
      });
    }
  }
  const manifest = validateDistribution({
    ...projects[0],
    distributionVersion: 1,
    projects,
    assignments,
    contentHash: distributionHash(projects, assignments),
  });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath: output };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  prepareDistributedFixture({
    provision: process.argv.includes('--provision'),
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
