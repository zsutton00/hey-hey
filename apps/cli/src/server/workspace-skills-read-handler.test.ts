import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RepoMappingStore } from '../repo';
import { CodexSkillCatalog } from '../agents/providers/codex/codex-skill-catalog';
import { WorkspaceSkillsReadHandler } from './workspace-skills-read-handler';
import { NOOP_LOGGER } from './logger';
import { guardCliReadResponse, MAX_CLI_READ_ACK_BYTES } from './cli-read-response-size-guard';
import type { CliReadWorkspaceSkillsListEnvelopeBody } from '../shared/agent-bridge-contract/generated/api';
const body: CliReadWorkspaceSkillsListEnvelopeBody = {
  requestId: '11111111-1111-4111-8111-111111111111',
  operation: 'workspace.skills.list',
  organizationId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  machineId: '44444444-4444-4444-8444-444444444444',
  authorizationRequestId: '55555555-5555-4555-8555-555555555555',
  provider: 'codex',
  catalogContext: { policy: 'non_repository' },
};
afterEach(() => vi.restoreAllMocks());
describe('WorkspaceSkillsReadHandler', () => {
  it('reads without a Service binding or session and preserves provider errors', async () => {
    const repositories = new RepoMappingStore();
    const binding = vi.spyOn(repositories, 'resolvePathForService');
    const list = vi
      .spyOn(CodexSkillCatalog.prototype, 'list')
      .mockResolvedValue({
        provider: 'codex',
        skills: [],
        errors: [{ provider: 'codex', message: 'Unreadable Skill' }],
      });
    const result = await new WorkspaceSkillsReadHandler(repositories, NOOP_LOGGER).read(
      body,
      'user',
    );
    expect(result).toMatchObject({
      operation: 'workspace.skills.list',
      status: 'success',
      result: { errors: [{ message: 'Unreadable Skill' }] },
    });
    expect(binding).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledWith({
      policy: 'non_repository',
      authorityId: expect.any(String),
    });
  });
  it('resolves only the explicitly selected Service on this machine', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'workspace-catalog-test-'));
    try {
      const repositories = new RepoMappingStore();
      const binding = vi.spyOn(repositories, 'resolvePathForService').mockResolvedValue(cwd);
      const list = vi
        .spyOn(CodexSkillCatalog.prototype, 'list')
        .mockResolvedValue({ provider: 'codex', skills: [], errors: [] });
      const serviceId = '66666666-6666-4666-8666-666666666666';
      const result = await new WorkspaceSkillsReadHandler(repositories, NOOP_LOGGER).read(
        { ...body, catalogContext: { policy: 'service_workspace', serviceId } },
        'user',
      );
      expect(result.status).toBe('success');
      expect(binding).toHaveBeenCalledWith(serviceId);
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({
          policy: 'service_workspace',
          cwd: expect.stringContaining('workspace-catalog-test-'),
        }),
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it('rejects an inaccessible binding without provider discovery', async () => {
    const repositories = new RepoMappingStore();
    vi.spyOn(repositories, 'resolvePathForService').mockRejectedValue(new Error('missing'));
    const list = vi.spyOn(CodexSkillCatalog.prototype, 'list');
    expect(
      await new WorkspaceSkillsReadHandler(repositories, NOOP_LOGGER).read(
        { ...body, catalogContext: { policy: 'service_workspace', serviceId: 'service' } },
        'user',
      ),
    ).toMatchObject({ status: 'error', error: { code: 'INVALID_WORKSPACE' } });
    expect(list).not.toHaveBeenCalled();
  });
  it.each([
    ['provider failed', 'PROVIDER_FAILURE'],
    ['request timed out', 'TIMEOUT'],
  ])('preserves %s and retries after failure', async (message, code) => {
    const list = vi
      .spyOn(CodexSkillCatalog.prototype, 'list')
      .mockRejectedValueOnce(new Error(message))
      .mockResolvedValue({ provider: 'codex', skills: [], errors: [] });
    const handler = new WorkspaceSkillsReadHandler(new RepoMappingStore(), NOOP_LOGGER);
    expect(await handler.read(body, 'user')).toMatchObject({ status: 'error', error: { code } });
    expect(await handler.read(body, 'user')).toMatchObject({ status: 'success' });
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('returns an unsupported provider error without invoking Codex', async () => {
    const list = vi.spyOn(CodexSkillCatalog.prototype, 'list');
    expect(
      await new WorkspaceSkillsReadHandler(new RepoMappingStore(), NOOP_LOGGER).read(
        { ...body, provider: 'claude' },
        'user',
      ),
    ).toMatchObject({ status: 'error', error: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(list).not.toHaveBeenCalled();
  });
  it('bounds workspace acknowledgements with the same operation identity', () => {
    const guarded = guardCliReadResponse({
      requestId: body.requestId,
      operation: body.operation,
      status: 'success',
      result: {
        provider: 'codex',
        skills: [],
        errors: [{ provider: 'codex', message: 'x'.repeat(MAX_CLI_READ_ACK_BYTES) }],
      },
    });
    expect(guarded.response).toMatchObject({
      requestId: body.requestId,
      operation: body.operation,
      status: 'error',
      error: { code: 'RESULT_TOO_LARGE' },
    });
  });
});
