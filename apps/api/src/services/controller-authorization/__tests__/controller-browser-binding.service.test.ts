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
        credentialHash: createHash('sha256')
          .update(issued.secret, 'utf8')
          .digest('hex'),
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
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue(binding),
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
        where: expect.objectContaining({ id: 'binding-id', revokedAt: null }),
      }),
    );
  });

  it('retains exact controller selection after the authorization window expires', async () => {
    const expiredAt = new Date(now.getTime() - 1);
    const db = {
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue({
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
        }),
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
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue(binding),
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
      controllerBrowserBinding: {
        findUnique: jest.fn().mockResolvedValue({
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
        }),
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
});
