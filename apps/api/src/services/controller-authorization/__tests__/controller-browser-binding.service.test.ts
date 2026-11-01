import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ControllerBrowserBindingService } from '../controller-browser-binding.service';
import type { OrganizationId, UserId } from '../../../types';

describe('ControllerBrowserBindingService', () => {
  const userId = '11111111-1111-4111-8111-111111111111' as UserId;
  const organizationId =
    '22222222-2222-4222-8222-222222222222' as OrganizationId;
  const installationId = '33333333-3333-4333-8333-333333333333';
  const credentialId = '44444444-4444-4444-8444-444444444444';
  const now = new Date('2026-08-28T12:00:00.000Z');
  const expiresAt = new Date('2026-08-28T13:00:00.000Z');

  it('rotates the exact active identity and persists only a SHA-256 hash', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'context' }]),
      controllerBrowserContext: {
        update: jest.fn(),
        upsert: jest.fn().mockResolvedValue({
          id: 'context',
          expiresAt: new Date('2099-01-01'),
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'context',
          expiresAt: new Date('2099-01-01'),
        }),
      },
      controllerBrowserBinding: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new ControllerBrowserBindingService({} as any);

    const issued = await service.issueOrRotate(
      tx as any,
      {
        controllerInstallationId: installationId,
        controllerCredentialId: credentialId,
        userId,
        organizationId,
        expiresAt,
      },
      now,
    );

    expect(issued.secret).toHaveLength(43);
    expect(tx.controllerBrowserBinding.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        browserContextId: 'context',
        credentialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        controllerInstallationId: installationId,
        controllerCredentialId: credentialId,
        userId,
        organizationId,
        expiresAt,
      }),
    });
    expect(
      JSON.stringify(tx.controllerBrowserBinding.create.mock.calls),
    ).not.toContain(issued.secret);
  });

  it('resolves only an active exact identity and records use', async () => {
    const binding = {
      id: 'binding-id',
      controllerInstallationId: installationId,
      controllerCredentialId: credentialId,
      userId,
      organizationId,
      expiresAt,
      revokedAt: null,
      controllerCredential: {
        credentialId: 'public-credential-id',
        machineId: '55555555-5555-4555-8555-555555555555',
        userId,
        organizationId,
        controllerInstallationId: installationId,
        revokedAt: null,
      },
    };
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      controllerBrowserBinding: {
        findMany: jest.fn().mockResolvedValue(binding ? [binding] : []),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);

    await expect(
      service.resolveForAdmission({
        secret: 'opaque-secret',
        userId,
        organizationId,
        now,
        required: true,
      }),
    ).resolves.toMatchObject({
      controllerInstallationId: installationId,
      controllerCredentialId: credentialId,
      controllerCredentialPublicId: 'public-credential-id',
    });
    expect(db.controllerBrowserBinding.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          controllerCredentialId: credentialId,
          revokedAt: null,
        }),
      }),
    );
  });

  it('retains exact controller selection after the authorization window expires', async () => {
    const expiredAt = new Date(now.getTime() - 1);
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      controllerBrowserBinding: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'binding-id',
            controllerInstallationId: installationId,
            controllerCredentialId: credentialId,
            userId,
            organizationId,
            expiresAt: expiredAt,
            revokedAt: null,
            controllerCredential: {
              credentialId: 'public-credential-id',
              machineId: '55555555-5555-4555-8555-555555555555',
              userId,
              organizationId,
              controllerInstallationId: installationId,
              revokedAt: null,
            },
          },
        ]),
        updateMany: jest.fn(),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);

    await expect(
      service.resolveForAdmission({
        secret: 'opaque-secret',
        userId,
        organizationId,
        now,
      }),
    ).resolves.toBeNull();
    await expect(
      service.resolveForSelection({
        secret: 'opaque-secret',
        userId,
        organizationId,
      }),
    ).resolves.toMatchObject({
      controllerCredentialId: credentialId,
      controllerCredentialPublicId: 'public-credential-id',
    });
    expect(db.controllerBrowserBinding.updateMany).not.toHaveBeenCalled();
  });

  it('creates an enrollment identity without exposing its raw secret in persistence', () => {
    const service = new ControllerBrowserBindingService({} as any);
    const pending = service.issuePending(now);

    expect(pending.secret).toHaveLength(43);
    expect(pending.credentialHash).toBe(
      createHash('sha256').update(pending.secret, 'utf8').digest('hex'),
    );
    expect(pending.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it.each([
    ['missing', undefined],
    ['unknown', null],
    [
      'revoked',
      {
        id: 'binding-id',
        userId,
        organizationId,
        expiresAt,
        revokedAt: now,
        controllerInstallationId: installationId,
        controllerCredentialId: credentialId,
        controllerCredential: {
          revokedAt: null,
          userId,
          organizationId,
          controllerInstallationId: installationId,
        },
      },
    ],
  ])('denies a %s required binding', async (_name, binding) => {
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      controllerBrowserBinding: {
        findMany: jest.fn().mockResolvedValue(binding ? [binding] : []),
        updateMany: jest.fn(),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);

    await expect(
      service.resolveForAdmission({
        secret: binding === undefined ? undefined : 'opaque-secret',
        userId,
        organizationId,
        now,
        required: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies when revocation wins the admission race', async () => {
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      controllerBrowserBinding: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'binding-id',
            userId,
            organizationId,
            expiresAt,
            revokedAt: null,
            controllerInstallationId: installationId,
            controllerCredentialId: credentialId,
            controllerCredential: {
              credentialId: 'public-credential-id',
              machineId: '55555555-5555-4555-8555-555555555555',
              revokedAt: null,
              userId,
              organizationId,
              controllerInstallationId: installationId,
            },
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);

    await expect(
      service.resolveForAdmission({
        secret: 'opaque-secret',
        userId,
        organizationId,
        now,
        required: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('keeps machine selection and admission independent for two bindings in one browser', async () => {
    const bindings = ['linux', 'mac'].map((machineId, index) => ({
      controllerInstallationId: `installation-${machineId}`,
      controllerCredentialId: `credential-${machineId}`,
      userId,
      organizationId,
      expiresAt,
      revokedAt: null,
      controllerCredential: {
        credentialId: `public-${machineId}`,
        machineId,
        userId,
        organizationId,
        revokedAt: null,
        controllerInstallationId: `installation-${machineId}`,
      },
    }));
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'context',
          userId,
          expiresAt: new Date('2099-01-01'),
          revokedAt: null,
        }),
      },
      controllerBrowserBinding: {
        findMany: jest.fn().mockResolvedValue(bindings),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);
    const params = { secret: 'browser-secret', userId, organizationId, now };
    expect(await service.resolveForSelection(params)).toBeNull();
    for (const machineId of ['linux', 'mac', 'linux']) {
      expect(
        await service.resolveForAdmission({
          ...params,
          machineId,
          controllerCredentialId: `public-${machineId}`,
        }),
      ).toMatchObject({
        machineId,
        controllerCredentialId: `credential-${machineId}`,
      });
    }
    expect(
      await service.resolveForSelection({
        ...params,
        machineId: 'linux',
        controllerCredentialId: 'public-mac',
      }),
    ).toBeNull();
    bindings[0]!.controllerCredential.machineId = 'mac';
    expect(
      await service.resolveForAdmission({ ...params, machineId: 'mac' }),
    ).toBeNull();
    expect(
      await service.resolveForAdmission({
        ...params,
        machineId: 'mac',
        controllerCredentialId: 'public-mac',
      }),
    ).toMatchObject({ controllerCredentialId: 'credential-mac' });
    bindings[0]!.controllerCredential.machineId = 'linux';
    bindings[0]!.expiresAt = new Date(now.getTime() - 1);
    expect(
      await service.resolveForAdmission({ ...params, machineId: 'linux' }),
    ).toBeNull();
    expect(
      await service.resolveForSelection({ ...params, machineId: 'linux' }),
    ).toMatchObject({ machineId: 'linux' });
    expect(
      await service.resolveForAdmission({ ...params, machineId: 'mac' }),
    ).toMatchObject({ machineId: 'mac' });
    bindings[0]!.controllerCredential.revokedAt = now as any;
    expect(
      await service.resolveForSelection({ ...params, machineId: 'linux' }),
    ).toBeNull();
    expect(
      await service.resolveForSelection({ ...params, machineId: 'mac' }),
    ).toMatchObject({ machineId: 'mac' });
    expect(
      await service.resolveForSelection({
        ...params,
        userId: 'foreign' as UserId,
      }),
    ).toBeNull();
    expect(
      await service.resolveForSelection({
        ...params,
        organizationId: 'foreign' as OrganizationId,
      }),
    ).toBeNull();
    expect(
      await service.resolveForSelection({ ...params, secret: undefined }),
    ).toBeNull();
  });
  it('keeps a valid context stable but creates an empty context after expiry or account switching', async () => {
    const context = {
      id: 'context',
      userId,
      expiresAt: new Date('2099-01-01'),
      revokedAt: null,
    };
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(context),
        upsert: jest.fn().mockResolvedValue({ id: 'new-context' }),
      },
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn(),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);
    expect((await service.ensureContext('original', userId, db)).secret).toBe(
      'original',
    );
    const switched = await service.ensureContext(
      'original',
      'other-user' as UserId,
      db,
    );
    expect(switched.secret).not.toBe('original');
    expect(db.controllerBrowserBinding.updateMany).not.toHaveBeenCalled();
    context.expiresAt = new Date('2020-01-01');
    expect(
      (await service.ensureContext('original', userId, db)).secret,
    ).not.toBe('original');
    expect(
      await service.resolveInventory({ secret: 'original', userId }),
    ).toEqual({ hasIdentity: false, bindings: [] });
  });

  it('adopts only the legacy binding actually proven by the presented cookie', async () => {
    const legacy = {
      id: 'legacy',
      userId,
      organizationId,
      revokedAt: null,
      controllerInstallationId: installationId,
      controllerCredential: {
        userId,
        organizationId,
        revokedAt: null,
        controllerInstallationId: installationId,
      },
    };
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({
          id: 'context',
          expiresAt: new Date('2099-01-01'),
        }),
      },
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue(legacy),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);
    expect(
      (await service.ensureContext('legacy-secret', userId, db)).secret,
    ).toBe('legacy-secret');
    expect(db.controllerBrowserBinding.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'legacy',
        revokedAt: null,
        controllerCredential: { revokedAt: null },
      },
      data: { browserContextId: 'context' },
    });
  });
  it('resolves Linux from the retained browser cookie after Mac enrollment', async () => {
    const rows = ['linux', 'mac'].map((machineId) => ({
      id: `binding-${machineId}`,
      userId,
      organizationId,
      controllerInstallationId: `installation-${machineId}`,
      controllerCredentialId: `credential-${machineId}`,
      expiresAt: new Date('2099-01-01'),
      revokedAt: null,
      controllerCredential: {
        userId,
        organizationId,
        controllerInstallationId: `installation-${machineId}`,
        credentialId: `public-${machineId}`,
        machineId,
        revokedAt: null,
      },
    }));
    const db = {
      controllerBrowserContext: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'browser',
          userId,
          expiresAt: new Date('2099-01-01'),
          revokedAt: null,
        }),
      },
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue(rows[1]),
        findMany: jest.fn().mockResolvedValue(rows),
      },
    };
    const service = new ControllerBrowserBindingService({ db } as any);
    for (const machineId of ['linux', 'mac', 'linux']) {
      expect(
        await service.resolveForSelection({
          secret: 'retained-cookie',
          userId,
          organizationId,
          machineId,
          controllerCredentialId: `public-${machineId}`,
        }),
      ).toMatchObject({
        machineId,
        controllerCredentialPublicId: `public-${machineId}`,
      });
    }
  });
});
