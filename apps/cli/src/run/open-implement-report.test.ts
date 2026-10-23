import { describe, expect, it, vi } from 'vitest';

import type { PassThroughSubmissionToolDeclaration } from '../agents/submission-tools/types';
import { ReportType } from '../shared/api/index';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { ReportChainEntry } from './types';
import { createTestRun } from './run.test-support';
import { emitChangedWorkspaceImplementReportIfNeeded } from './open-implement-report';

const makeLogger = () => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
});

const makeRun = () => {
  const run = createTestRun({ runId: 'run-1' });
  Object.assign(run.session, {
    entity: { entityType: 'TASK', entityId: 'task-1' },
    agentic_session_id: 'session-1',
  });
  return run;
};

const makeReport = (reportType: ReportChainEntry['reportType']): ReportChainEntry => ({
  createdAt: '2026-07-01T00:00:00.000Z',
  phase: LocalPromptType.FreeForm,
  reportId: `report-${reportType}`,
  reportType,
  summary: 'summary',
  audience: 'EXTERNAL',
});

const makeCreateReportTool = () => {
  const execute = vi.fn().mockResolvedValue({ content: [] });
  const tool: PassThroughSubmissionToolDeclaration = {
    kind: 'pass_through',
    name: 'create_report',
    description: 'Persist a report.',
    inputSchema: {},
    execute,
  };
  return { tool, execute };
};

describe('emitChangedWorkspaceImplementReportIfNeeded', () => {
  it('skips prompt types that do not use changed-workspace IMPLEMENT reports', async () => {
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run: makeRun(),
      logger: makeLogger(),
      promptType: LocalPromptType.Implement,
      fileChanges: [{ serviceId: 'service-1', repoRelativePath: 'src/foo.ts' }],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'unsupported-prompt' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('skips Open turns with no changed files', async () => {
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run: makeRun(),
      logger: makeLogger(),
      promptType: LocalPromptType.FreeForm,
      fileChanges: [],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'no-files-changed' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('skips Task Only turns with no changed files', async () => {
    const { tool, execute } = makeCreateReportTool();
    const logger = makeLogger();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run: makeRun(),
      logger,
      promptType: LocalPromptType.Quick,
      fileChanges: [],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'no-files-changed' });
    expect(execute).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(
      'local.run.open_implement_report.skipped',
      expect.objectContaining({
        promptType: LocalPromptType.Quick,
        reason: 'no-files-changed',
      }),
    );
  });

  it('skips when the Open turn already emitted an IMPLEMENT report', async () => {
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run: makeRun(),
      logger: makeLogger(),
      promptType: LocalPromptType.CodingFreeform,
      fileChanges: [{ serviceId: 'service-1', repoRelativePath: 'src/foo.ts' }],
      reportsSinceTurnStart: [makeReport(ReportType.Implement)],
      createReportTool: tool,
    });

    expect(result).toEqual({ status: 'skipped', reason: 'implement-report-already-emitted' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('emits an IMPLEMENT report through the create_report wrapper for changed Open turns', async () => {
    const run = makeRun();
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run,
      logger: makeLogger(),
      promptType: LocalPromptType.FreeForm,
      fileChanges: [
        { serviceId: 'service-1', repoRelativePath: 'src/z.ts' },
        { serviceId: 'service-1', repoRelativePath: 'src/a.ts' },
        { serviceId: 'service-1', repoRelativePath: 'src/a.ts' },
      ],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({
      status: 'emitted',
      reports: [{ serviceId: 'service-1', filesChanged: ['src/a.ts', 'src/z.ts'] }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      runId: 'run-1',
      run,
      args: {
        reportType: ReportType.Implement,
        audience: 'PROJECT_VISIBLE',
        payload: {
          reportType: ReportType.Implement,
          filesChanged: ['src/a.ts', 'src/z.ts'],
          decisions: [],
        },
        entities: [
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'AGENT_SESSION', entityId: 'session-1', relation: 'CONTEXT' },
          { entityType: 'SERVICE', entityId: 'service-1', relation: 'CONTEXT' },
        ],
      },
    });
  });

  it('emits one IMPLEMENT report per touched service', async () => {
    const run = makeRun();
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run,
      logger: makeLogger(),
      promptType: LocalPromptType.FreeForm,
      fileChanges: [
        { serviceId: 'service-b', repoRelativePath: 'src/shared.ts' },
        { serviceId: 'service-a', repoRelativePath: 'src/shared.ts' },
      ],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({
      status: 'emitted',
      reports: [
        { serviceId: 'service-a', filesChanged: ['src/shared.ts'] },
        { serviceId: 'service-b', filesChanged: ['src/shared.ts'] },
      ],
    });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls.map((call) => call[0]!.args)).toMatchObject([
      {
        payload: { filesChanged: ['src/shared.ts'] },
        entities: expect.arrayContaining([
          { entityType: 'SERVICE', entityId: 'service-a', relation: 'CONTEXT' },
        ]),
      },
      {
        payload: { filesChanged: ['src/shared.ts'] },
        entities: expect.arrayContaining([
          { entityType: 'SERVICE', entityId: 'service-b', relation: 'CONTEXT' },
        ]),
      },
    ]);
  });

  it('emits a Task Only IMPLEMENT report through the create_report wrapper for changed turns', async () => {
    const run = makeRun();
    const { tool, execute } = makeCreateReportTool();

    const result = await emitChangedWorkspaceImplementReportIfNeeded({
      run,
      logger: makeLogger(),
      promptType: LocalPromptType.Quick,
      fileChanges: [{ serviceId: 'service-1', repoRelativePath: 'src/task-only.ts' }],
      reportsSinceTurnStart: [],
      createReportTool: tool,
    });

    expect(result).toEqual({
      status: 'emitted',
      reports: [{ serviceId: 'service-1', filesChanged: ['src/task-only.ts'] }],
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toMatchObject({
      runId: 'run-1',
      run,
      args: {
        reportType: ReportType.Implement,
        audience: 'PROJECT_VISIBLE',
        payload: {
          reportType: ReportType.Implement,
          summary: expect.stringContaining('Task Only completed the requested work'),
          filesChanged: ['src/task-only.ts'],
          decisions: [],
        },
        entities: [
          { entityType: 'TASK', entityId: 'task-1', relation: 'PRIMARY' },
          { entityType: 'AGENT_SESSION', entityId: 'session-1', relation: 'CONTEXT' },
          { entityType: 'SERVICE', entityId: 'service-1', relation: 'CONTEXT' },
        ],
      },
    });
  });
});
