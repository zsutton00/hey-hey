import { describe, expect, it, vi } from 'vitest';

import type { AgenticSessionEvent } from '../session';
import type { AgentSessionConfig } from '../shared/agent-bridge-contract/generated/api';
import {
  runProjectModeLaunchResumeProbe,
  serializeProjectModeLaunchResumeOutcome,
  type ProjectModeLaunchResumeProbeDependencies,
} from './probe-project-mode-launch-resume';
import type { ProjectModeLaunchResumeProbeArgs } from './probe-project-mode-launch-resume-args';

const MODE_ID = '10000000-0000-4000-8000-000000000004';
const RUN_ID = '10000000-0000-4000-8000-000000000006';
const MODE_ENTRY = 'fixture-mode-secret';
const EDITED_SENTINEL = 'fixture-edited-secret';
const BUNDLE = '/tmp/project-mode-proof/bundle';

const args: ProjectModeLaunchResumeProbeArgs = {
  apiBaseUrl: 'http://127.0.0.1:3000',
  organizationId: '10000000-0000-4000-8000-000000000001',
  projectId: '10000000-0000-4000-8000-000000000002',
  taskId: '10000000-0000-4000-8000-000000000003',
  modeId: MODE_ID,
  serviceId: '10000000-0000-4000-8000-000000000005',
  repositoryPath: '/work/cli',
  provider: 'codex',
  model: 'gpt-5',
  reasoningEffort: 'high',
  timeoutMs: 1_000,
  maxOutputBytes: 4_096,
};

const config: AgentSessionConfig = {
  type: 'CODING_SESSION',
  version: 'v2',
  model: 'gpt-5',
  projectModeSelection: { schemaVersion: 'project-mode-selection.v1', modeId: MODE_ID },
  projectModeSnapshot: {
    schemaVersion: 'project-mode-snapshot.v1',
    modeId: MODE_ID,
    catalogDescription: 'Local verification mode',
    applicableWorkItemTypeKeys: ['STANDARD'],
    files: {
      schemaVersion: 'project-mode-files.v1',
      files: { 'MODE.md': MODE_ENTRY, 'references/checklist.md': 'fixture-checklist-secret' },
    },
    snapshotHash: 'a'.repeat(64),
  },
};

const event = (
  seq: number,
  eventType: AgenticSessionEvent['event_type'],
  body: Record<string, unknown>,
): AgenticSessionEvent => ({
  seq,
  ts: `2026-09-20T00:00:0${String(seq)}.000Z`,
  app_session_id: RUN_ID,
  run_id: RUN_ID,
  actor: 'agent',
  event_type: eventType,
  state_version: 1,
  payload: body,
});

const turnEvents = (turnIndex: number, startupInput = MODE_ENTRY): AgenticSessionEvent[] => [
  event(turnIndex * 3 + 1, 'run_started', {
    kind: 'run_started',
    provider: 'codex',
    prompt: `${startupInput}\nBundle location: ${BUNDLE}`,
    providerSessionId: 'provider-session',
    providerSessionAgentId: 'project_mode',
  }),
  event(turnIndex * 3 + 2, 'agent_output', {
    kind: 'tool_use',
    blocks: [
      {
        toolUseId: 'read-checklist',
        toolName: 'read_file',
        input: { path: `${BUNDLE}/references/checklist.md`, secret: 'fixture-tool-input-secret' },
      },
    ],
  }),
  event(turnIndex * 3 + 3, 'run_completed', { kind: 'run_completed', outcome: 'succeeded' }),
];

const dependencies = (
  overrides: Partial<ProjectModeLaunchResumeProbeDependencies> = {},
): ProjectModeLaunchResumeProbeDependencies => ({
  captureSession: vi.fn(async () => ({
    agentSessionId: '10000000-0000-4000-8000-000000000007',
    conversationId: '10000000-0000-4000-8000-000000000008',
    config,
  })),
  startRun: vi.fn(async () => RUN_ID),
  readDurableEvents: vi
    .fn()
    .mockResolvedValueOnce(turnEvents(0))
    .mockResolvedValueOnce([...turnEvents(0), ...turnEvents(1)]),
  editCanonicalMode: vi.fn(async () => ({
    restoreToken: 'review-backed-restore-token',
    editedSentinel: EDITED_SENTINEL,
  })),
  resumeRun: vi.fn(async () => {}),
  restoreCanonicalMode: vi.fn(async () => {}),
  dispose: vi.fn(async () => {}),
  ...overrides,
});

describe('project MODE launch and resume probe', () => {
  it('proves launch snapshot continuity and emits bounded non-secret evidence', async () => {
    const seams = dependencies();
    const outcome = await runProjectModeLaunchResumeProbe(args, seams);
    expect(outcome.exitCode).toBe(0);
    expect(outcome.summary.continuity).toEqual({
      run: true,
      providerSession: true,
      logicalHandler: true,
      snapshot: true,
      materializedBundle: true,
    });
    expect(outcome.summary.restoration).toBe('succeeded');
    const output = serializeProjectModeLaunchResumeOutcome(outcome, args.maxOutputBytes);
    for (const secret of [
      MODE_ENTRY,
      EDITED_SENTINEL,
      'fixture-checklist-secret',
      'fixture-tool-input-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(seams.restoreCanonicalMode).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'edited-content leakage',
      turnEvents(1, `${MODE_ENTRY}\n${EDITED_SENTINEL}`),
      'editedContentExcluded',
    ],
    ['missing startup', turnEvents(1).slice(1), 'missing startup evidence'],
    ['missing checklist read', [turnEvents(1)[0]!, turnEvents(1)[2]!], 'resumedChecklistRead'],
    [
      'provider failure',
      [
        turnEvents(1)[0]!,
        turnEvents(1)[1]!,
        event(6, 'run_completed', { kind: 'run_completed', outcome: 'failed' }),
      ],
      'resumedCompletion',
    ],
  ])('fails %s and restores canonical content', async (_label, secondTurn, expected) => {
    const seams = dependencies({
      readDurableEvents: vi
        .fn()
        .mockResolvedValueOnce(turnEvents(0))
        .mockResolvedValueOnce([...turnEvents(0), ...secondTurn]),
    });
    const outcome = await runProjectModeLaunchResumeProbe(args, seams);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain(expected);
    expect(seams.restoreCanonicalMode).toHaveBeenCalledOnce();
  });

  it('attempts restoration when the proposal-backed edit may have failed after applying', async () => {
    const seams = dependencies({
      editCanonicalMode: vi.fn(async () => {
        throw new Error('edit failed');
      }),
    });
    const outcome = await runProjectModeLaunchResumeProbe(args, seams);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.error).toContain('edit failed');
    expect(seams.restoreCanonicalMode).toHaveBeenCalledOnce();
    expect(seams.restoreCanonicalMode).toHaveBeenCalledWith(args, null);
  });

  it('makes restoration failure nonzero and always disposes', async () => {
    const seams = dependencies({
      restoreCanonicalMode: vi.fn(async () => {
        throw new Error('restore failed');
      }),
    });
    const outcome = await runProjectModeLaunchResumeProbe(args, seams);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.summary.restoration).toBe('failed');
    expect(seams.dispose).toHaveBeenCalledOnce();
  });
});
