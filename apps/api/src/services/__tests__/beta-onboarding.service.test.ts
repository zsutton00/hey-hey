import { BetaOnboardingService } from '../beta-onboarding.service';
import type { PrivateBetaAccessRequestId } from '../../types';
import { PrivateBetaProvisioningError } from '../private-beta-provisioning-error';

describe('BetaOnboardingService', () => {
  it.each(['PENDING', 'REJECTED'])(
    'refuses %s requests before any provisioning or activation email',
    async (status) => {
      const userService = {
        getBetaOnboardingRequest: jest.fn().mockResolvedValue({ status }),
        createOrResumeBetaUserForRequest: jest.fn(),
      };
      const emailService = { sendWelcomeEmail: jest.fn() };
      const service = new BetaOnboardingService(
        userService as never,
        emailService as never,
        {} as never,
      );
      await expect(
        service.onboardApprovedRequest(
          'request-id' as PrivateBetaAccessRequestId,
          {},
        ),
      ).rejects.toThrow('not ready');
      expect(
        userService.createOrResumeBetaUserForRequest,
      ).not.toHaveBeenCalled();
      expect(emailService.sendWelcomeEmail).not.toHaveBeenCalled();
    },
  );

  it('delivers the password-change credential without exposing the bootstrap password', async () => {
    const userService = {
      findByEmail: jest.fn().mockResolvedValue(null),
      createBetaUser: jest.fn().mockResolvedValue({
        user: { id: 'user-1' },
        organizationId: 'organization-1',
        passwordChangeCredential: 'welcome-token',
      }),
    };
    const emailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    const apiKeyService = {
      createOrganizationApiKey: jest.fn().mockResolvedValue(undefined),
    };
    const service = new BetaOnboardingService(
      userService as never,
      emailService as never,
      apiKeyService as never,
    );

    const requestMetadata = {
      ipAddress: '203.0.113.10',
      userAgent: 'beta-onboarding-test',
    };
    await service.onboardBetaUser(
      {
        email: 'invitee@example.com',
        name: 'Invitee',
        organizationName: 'Example Org',
      },
      requestMetadata,
    );

    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith({
      to: 'invitee@example.com',
      name: 'Invitee',
      passwordChangeCredential: 'welcome-token',
    });
    expect(emailService.sendWelcomeEmail.mock.calls[0][0]).not.toHaveProperty(
      'temporaryPassword',
    );
    expect(userService.createBetaUser).toHaveBeenCalledWith(
      {
        email: 'invitee@example.com',
        name: 'Invitee',
        organizationName: 'Example Org',
      },
      requestMetadata,
    );
  });

  it('provisions an approved request once and replays the completed outcome', async () => {
    const requestId =
      '550e8400-e29b-41d4-a716-446655440026' as PrivateBetaAccessRequestId;
    const initialRequest = {
      id: requestId,
      normalizedEmail: 'invitee@example.com',
      name: 'Invitee',
      organizationName: 'Example Org',
      status: 'APPROVAL_IN_PROGRESS',
      provisionedUserId: null,
      provisionedOrganizationId: null,
      provisioningOrganizationApiKeyId: null,
      welcomeEmailIdempotencyKey: null,
      welcomeEmailSentAt: null,
    };
    const provisionedRequest = {
      ...initialRequest,
      provisionedUserId: 'user-1',
      provisionedOrganizationId: 'organization-1',
    };
    const completedRequest = {
      ...provisionedRequest,
      provisioningOrganizationApiKeyId: 'api-key-1',
      welcomeEmailIdempotencyKey: `private-beta-welcome:${requestId}`,
      welcomeEmailSentAt: new Date('2026-08-12T12:00:00.000Z'),
    };
    const userService = {
      getBetaOnboardingRequest: jest
        .fn()
        .mockResolvedValueOnce(initialRequest)
        .mockResolvedValueOnce(provisionedRequest)
        .mockResolvedValueOnce(completedRequest),
      createOrResumeBetaUserForRequest: jest.fn().mockResolvedValue({
        request: provisionedRequest,
        user: { id: 'user-1' },
        organizationId: 'organization-1',
        passwordChangeCredential: 'opaque-token',
      }),
      recordBetaOnboardingApiKey: jest.fn().mockResolvedValue(undefined),
      markBetaWelcomeEmailSent: jest.fn().mockResolvedValue(undefined),
    };
    const emailService = {
      sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
    };
    const apiKeyService = {
      findOrganizationApiKey: jest.fn().mockResolvedValue(null),
      createOrganizationApiKey: jest
        .fn()
        .mockResolvedValue({ id: 'api-key-1' }),
    };
    const service = new BetaOnboardingService(
      userService as never,
      emailService as never,
      apiKeyService as never,
    );

    const metadata = { ipAddress: '203.0.113.10', userAgent: 'test' };
    await expect(
      service.onboardApprovedRequest(requestId, metadata),
    ).resolves.toEqual({
      userId: 'user-1',
      organizationId: 'organization-1',
      email: 'invitee@example.com',
    });
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith({
      to: 'invitee@example.com',
      name: 'Invitee',
      passwordChangeCredential: 'opaque-token',
      providerIdempotencyKey: `private-beta-welcome:${requestId}`,
    });

    await expect(
      service.onboardApprovedRequest(requestId, metadata),
    ).resolves.toEqual({
      userId: 'user-1',
      organizationId: 'organization-1',
      email: 'invitee@example.com',
    });
    expect(userService.createOrResumeBetaUserForRequest).toHaveBeenCalledTimes(
      1,
    );
    expect(apiKeyService.createOrganizationApiKey).toHaveBeenCalledTimes(1);
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('records a retryable failure when welcome delivery fails after resource checkpoints', async () => {
    const requestId =
      '550e8400-e29b-41d4-a716-446655440027' as PrivateBetaAccessRequestId;
    const request = {
      id: requestId,
      normalizedEmail: 'invitee@example.com',
      name: 'Invitee',
      organizationName: 'Example Org',
      status: 'APPROVAL_IN_PROGRESS',
      provisionedUserId: 'user-1',
      provisionedOrganizationId: 'organization-1',
      provisioningOrganizationApiKeyId: null,
      welcomeEmailIdempotencyKey: null,
      welcomeEmailSentAt: null,
    };
    const userService = {
      getBetaOnboardingRequest: jest.fn().mockResolvedValue(request),
      createOrResumeBetaUserForRequest: jest.fn().mockResolvedValue({
        request,
        user: { id: 'user-1' },
        organizationId: 'organization-1',
        passwordChangeCredential: 'opaque-token',
      }),
      recordBetaOnboardingApiKey: jest.fn().mockResolvedValue(undefined),
      markBetaWelcomeEmailSent: jest.fn(),
    };
    const emailError = new Error('recipient@example.com provider unavailable');
    const emailService = {
      sendWelcomeEmail: jest.fn().mockRejectedValue(emailError),
    };
    const apiKeyService = {
      findOrganizationApiKey: jest.fn().mockResolvedValue({ id: 'api-key-1' }),
      createOrganizationApiKey: jest.fn(),
    };
    const service = new BetaOnboardingService(
      userService as never,
      emailService as never,
      apiKeyService as never,
    );

    await expect(
      service.onboardApprovedRequest(requestId, {}),
    ).rejects.toMatchObject<Partial<PrivateBetaProvisioningError>>({
      code: 'WELCOME_EMAIL',
      message: 'Private-beta provisioning could not be completed.',
      errorType: 'Error',
    });
    expect(userService.recordBetaOnboardingApiKey).toHaveBeenCalledWith(
      requestId,
      'api-key-1',
    );
    expect(emailService.sendWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        providerIdempotencyKey: `private-beta-welcome:${requestId}`,
      }),
    );
  });
});
