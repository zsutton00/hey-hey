import { SharedEnrollmentClaimService } from '../../services/machine-pairing/shared-enrollment-claim.service';
import { MachineEnrollmentClaimController } from '../machine-enrollment-claim.controller';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type { MachineEnrollmentClaimService } from '../../services/machine-pairing/machine-enrollment-claim.service';
import type { ControllerBindingCookieService } from '../../services/controller-authorization/controller-binding-cookie.service';
import type { Request, Response } from 'express';

describe('MachineEnrollmentClaimController', () => {
  it('uses the local display name for the pairing passkey account label', async () => {
    const service = {
      beginClaim: jest.fn().mockResolvedValue({ state: 'claimable' }),
      ensureBrowserContext: jest.fn().mockResolvedValue({
        secret: 'browser-binding',
        expiresAt: new Date(),
      }),
    } as unknown as MachineEnrollmentClaimService;
    const cookies = {
      set: jest.fn(),
    } as unknown as ControllerBindingCookieService;
    const controller = new MachineEnrollmentClaimController(
      service,
      cookies,
      {} as SharedEnrollmentClaimService,
    );
    const user = {
      userId: 'local-user',
      email: 'local-installation@local.invalid',
      name: 'Ada Lovelace',
      currentOrgId: 'local-org',
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
      isLocalAccount: true,
    } as unknown as AuthenticatedUser;

    await controller.beginClaim(
      {} as never,
      user,
      { headers: {}, cookies: {}, ip: '127.0.0.1' } as Request,
      {} as Response,
    );

    expect(service.beginClaim).toHaveBeenCalledWith(
      {},
      user.userId,
      user.orgMemberships,
      '127.0.0.1',
      { email: 'Ada Lovelace', name: 'Ada Lovelace' },
    );
  });

  it('uses a neutral local label before a display name is saved', async () => {
    const service = {
      beginClaim: jest.fn().mockResolvedValue({ state: 'claimable' }),
      ensureBrowserContext: jest.fn().mockResolvedValue({
        secret: 'browser-binding',
        expiresAt: new Date(),
      }),
    } as unknown as MachineEnrollmentClaimService;
    const cookies = {
      set: jest.fn(),
    } as unknown as ControllerBindingCookieService;
    const controller = new MachineEnrollmentClaimController(
      service,
      cookies,
      {} as SharedEnrollmentClaimService,
    );
    const user = {
      userId: 'local-user',
      email: 'local-installation@local.invalid',
      name: '',
      currentOrgId: 'local-org',
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
      isLocalAccount: true,
    } as unknown as AuthenticatedUser;

    await controller.beginClaim(
      {} as never,
      user,
      { headers: {}, cookies: {}, ip: '127.0.0.1' } as Request,
      {} as Response,
    );

    expect(service.beginClaim).toHaveBeenCalledWith(
      {},
      user.userId,
      user.orgMemberships,
      '127.0.0.1',
      { email: 'Local Hey Hey', name: 'Local Hey Hey' },
    );
  });
});
