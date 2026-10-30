import { resolveHandlerSessionRole } from '../prompt-type-handler';
import { SessionRole } from '../../shared/agent-bridge-contract/generated/api';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import { describe, expect, it } from 'vitest';
import { buildActivityResponsibilities } from '../prompts/knowledge-responsibilities';

import type { AgenticSession } from '../../session/types';
import type {
  AgentSessionConfig,
  ProjectModeSnapshot,
  RunCreatePayloadProjectMode,
} from '../../shared/agent-bridge-contract/generated/api';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { buildProjectModePrompt, projectModeHandler, validateProjectModeConfig } from './index';

const MODE_ID = '11111111-1111-4111-8111-111111111111';

const snapshot: ProjectModeSnapshot = {
  schemaVersion: 'project-mode-snapshot.v1',
  modeId: MODE_ID,
  catalogDescription: 'A careful coding mode.',
  applicableWorkItemTypeKeys: ['STANDARD'],
  files: {
    schemaVersion: 'project-mode-files.v1',
    files: {
      'MODE.md': 'Work carefully and verify every changed boundary.',
      'references/checklist.md': 'Run focused tests.',
    },
  },
  snapshotHash: 'a'.repeat(64),
};

const config: AgentSessionConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'test-model',
  projectModeSelection: {
    schemaVersion: 'project-mode-selection.v1',
    modeId: MODE_ID,
  },
  projectModeSnapshot: snapshot,
};

const payload: RunCreatePayloadProjectMode = {
  promptType: LocalPromptType.ProjectMode,
  entity: { entityType: 'TASK', entityId: '22222222-2222-4222-8222-222222222222' },
  userMessage: 'Implement the task.',
};

const makeSession = (sessionConfig: AgentSessionConfig | null): AgenticSession => ({
  agentic_session_id: 'session-1',
  entity: payload.entity,
  services: [{ id: 'service-1', path: '/workspace/service-1' }],
  launchServiceId: 'service-1',
  provider: 'claude',
  provider_session_id: 'pending-session-1',
  provider_conversation_id: null,
  status: 'idle',
  conversationId: 'conversation-1',
  config: sessionConfig,
  contextMetadata: {
    capturedAt: '2026-09-11T00:00:00.000Z',
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId: 'session-1',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
  createdAt: '2026-09-11T00:00:00.000Z',
  updatedAt: '2026-09-11T00:00:00.000Z',
  events: [],
});

describe('project-mode snapshot validation', () => {
  it('accepts only a generated selection and matching captured snapshot', () => {
    expect(validateProjectModeConfig(config)).toEqual({
      ok: true,
      value: {
        selection: config.projectModeSelection,
        snapshot: { ...snapshot, projectAssistantEnabled: true },
      },
    });

    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId: '33333333-3333-4333-8333-333333333333',
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it('rejects absent, incomplete, and schema-invalid captured data', () => {
    expect(validateProjectModeConfig(null)).toMatchObject({ ok: false });
    expect(
      validateProjectModeConfig({
        type: 'CODING_SESSION',
        version: 'v2',
        model: 'test-model',
        projectModeSelection: {
          schemaVersion: 'project-mode-selection.v1',
          modeId: MODE_ID,
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSnapshot: { ...snapshot, snapshotHash: 'not-a-hash' },
      }),
    ).toMatchObject({ ok: false });
  });
});

const v2Config = (enabled: boolean): AgentSessionConfig => ({
  ...config,
  projectModeSnapshot: {
    ...snapshot,
    schemaVersion: 'project-mode-snapshot.v2',
    projectAssistant: { enabled },
  },
});

describe('project-mode snapshot Project Assistant setting', () => {
  it.each([true, false])('exposes the captured v2 setting enabled=%s', (enabled) => {
    const validated = validateProjectModeConfig(v2Config(enabled));

    expect(validated).toMatchObject({
      ok: true,
      value: { snapshot: { projectAssistant: { enabled }, projectAssistantEnabled: enabled } },
    });
  });

  it('reads a v1 snapshot captured before the setting existed as enabled', () => {
    expect(validateProjectModeConfig(config)).toMatchObject({
      ok: true,
      value: { snapshot: { projectAssistantEnabled: true } },
    });
  });

  it('rejects mismatched version and setting pairings', () => {
    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSnapshot: { ...snapshot, schemaVersion: 'project-mode-snapshot.v2' },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSnapshot: { ...snapshot, projectAssistant: { enabled: false } },
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSnapshot: {
          ...snapshot,
          schemaVersion: 'project-mode-snapshot.v2',
          projectAssistant: { enabled: true, allowEdgeUpdates: true },
        } as unknown as ProjectModeSnapshot,
      }),
    ).toMatchObject({ ok: false });
  });
});

describe('project-mode handler Project Assistant baseline', () => {
  const fixedPolicy = {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  };

  it('participates with the fixed authority policy when the captured setting is on', () => {
    const deps = createPromptTypeHandlerTestDeps();
    expect(
      projectModeHandler.resolveProjectAssistant!(makeSession(v2Config(true)), deps.logger),
    ).toEqual(fixedPolicy);
  });

  it('does not participate when the captured setting is off', () => {
    const deps = createPromptTypeHandlerTestDeps();
    expect(
      projectModeHandler.resolveProjectAssistant!(makeSession(v2Config(false)), deps.logger),
    ).toBeUndefined();
  });

  it('keeps v1 snapshots participating as they did at launch', () => {
    const deps = createPromptTypeHandlerTestDeps();
    expect(projectModeHandler.resolveProjectAssistant!(makeSession(config), deps.logger)).toEqual(
      fixedPolicy,
    );
  });

  it('does not participate when the captured config is invalid', () => {
    const deps = createPromptTypeHandlerTestDeps();
    expect(
      projectModeHandler.resolveProjectAssistant!(makeSession(null), deps.logger),
    ).toBeUndefined();
  });
});

describe('project-mode handler', () => {
  it('keeps logical identity and trusted coding policy fixed in code', () => {
    expect(projectModeHandler).toMatchObject({
      id: 'project_mode',
      promptType: LocalPromptType.ProjectMode,
      runnerKind: 'provider_session',
      mcpToolUseCase: 'coding',
      reports: [],
      requiresChangedFileReporting: true,
    });
    expect(projectModeHandler.submissionTools?.map((tool) => tool.name)).toEqual([
      'report_changed_files',
      'request_agent_session_service_scope',
    ]);
    expect(Object.isFrozen(projectModeHandler)).toBe(true);
  });

  it('maps captured MODE.md and a runtime-supplied bundle location into startup', () => {
    const prompt = buildProjectModePrompt({
      snapshot,
      bundleLocation: '/runtime/project-modes/session-1',
    });

    expect(prompt).toMatchSnapshot();
    expect(prompt).toContain('Work carefully and verify every changed boundary.');
    expect(prompt).toContain('Bundle location: /runtime/project-modes/session-1');
    expect(prompt).toContain('cannot add tools');
    expect(prompt).not.toContain('Run focused tests.');
  });

  it('keeps every activity responsibility on a launch with Project Assistant disabled', async () => {
    const disabledConfig: AgentSessionConfig = {
      ...config,
      projectModeSnapshot: {
        ...snapshot,
        schemaVersion: 'project-mode-snapshot.v2',
        projectAssistant: { enabled: false },
      },
    };
    const deps = createPromptTypeHandlerTestDeps();
    const session = makeSession(disabledConfig);
    expect(projectModeHandler.resolveProjectAssistant!(session, deps.logger)).toBeUndefined();
    const prepared = await projectModeHandler.prepare!(session, payload, deps, {
      recentUserReplies: [],
      triggerParentMessageId: null,
      projectModeBundleDirectory: '/runtime/project-modes/session-1',
    });
    const prompt = projectModeHandler.buildPrompt(prepared.payload);
    expect(prompt).toContain(buildActivityResponsibilities());
    expect(prompt.indexOf(buildActivityResponsibilities())).toBeLessThan(
      prompt.indexOf('## Captured MODE bundle'),
    );
    expect(prompt).toContain('cannot add tools, change repository or bootstrap authority');
    expect(prompt).toMatchSnapshot();
  });

  it('prepares one Turn from the persisted snapshot and rejects missing config', async () => {
    const deps = createPromptTypeHandlerTestDeps();
    const prepared = await projectModeHandler.prepare!(makeSession(config), payload, deps, {
      recentUserReplies: [],
      triggerParentMessageId: null,
      projectModeBundleDirectory: '/runtime/project-modes/session-1',
    });
    const prompt = projectModeHandler.buildPrompt(prepared.payload);

    expect(prompt).toContain('Work carefully and verify every changed boundary.');
    expect(prompt).toContain('/runtime/project-modes/session-1');
    await expect(projectModeHandler.prepare!(makeSession(null), payload, deps)).rejects.toThrow(
      /captured config is invalid/,
    );
  });
});

describe('handler-owned roles', () => {
  it.each(Object.values(SessionRole))(
    'retains captured %s independently of bootstrap and child handlers',
    (sessionRole) => {
      const captured = {
        ...config,
        projectModeSnapshot: {
          ...snapshot,
          schemaVersion: 'project-mode-snapshot.v3' as const,
          projectAssistant: { enabled: true },
          sessionRole,
        },
      };
      const session = makeSession(captured);
      const validated = validateProjectModeConfig(captured);
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error('invalid fixture');
      expect(Object.isFrozen(validated.value.snapshot)).toBe(true);
      expect(resolveHandlerSessionRole(projectModeHandler, session)).toBe(sessionRole);
      expect(
        resolveHandlerSessionRole(
          new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES).get(
            LocalPromptType.ProjectAssistant,
          )!,
          session,
        ),
      ).toBe(SessionRole.Research);
      const { resolveSessionRole: _resolver, ...childHandler } = projectModeHandler;
      expect(resolveHandlerSessionRole(childHandler, session)).toBe(SessionRole.Implementation);
      // Reconstructing from persisted JSON does not consult the mutable MODE.
      const resumed = makeSession(JSON.parse(JSON.stringify(captured)));
      expect(resolveHandlerSessionRole(projectModeHandler, resumed)).toBe(sessionRole);
    },
  );

  it.each(['project-mode-snapshot.v1', 'project-mode-snapshot.v2'] as const)(
    'defaults legacy %s to implementation',
    (schemaVersion) => {
      const session = makeSession({
        ...config,
        projectModeSnapshot: {
          ...snapshot,
          schemaVersion,
          ...(schemaVersion.endsWith('v2') ? { projectAssistant: { enabled: true } } : {}),
        },
      });
      expect(resolveHandlerSessionRole(projectModeHandler, session)).toBe(
        SessionRole.Implementation,
      );
    },
  );

  it.each([undefined, 'invalid'])('rejects a v3 snapshot with invalid role %s', (sessionRole) => {
    const invalid = {
      ...config,
      projectModeSnapshot: {
        ...snapshot,
        schemaVersion: 'project-mode-snapshot.v3',
        projectAssistant: { enabled: true },
        sessionRole,
      },
    };
    expect(validateProjectModeConfig(invalid)).toMatchObject({ ok: false });
  });

  it('rejects role declarations on legacy snapshots', () => {
    expect(
      validateProjectModeConfig({
        ...config,
        projectModeSnapshot: { ...snapshot, sessionRole: 'review' },
      }),
    ).toMatchObject({ ok: false });
  });
});
