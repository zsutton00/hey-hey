import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrivateBetaAccessRequestId, UserId } from 'src/types';
import type {
  OnboardBetaUserResponseDto,
  PrivateBetaAccessProvisioningFailureCode,
} from '../generated';
import { BrowserSessionRequestMetadata } from '../auth/browser-session.types';
import { ApiKeyService } from './api-key.service';
import { UserService } from './user.service';
import { EmailService } from './email.service';
import { toPrivateBetaProvisioningError } from './private-beta-provisioning-error';

@Injectable()
export class BetaOnboardingService {
  private readonly logger = new Logger(BetaOnboardingService.name);

  constructor(
    private userService: UserService,
    private emailService: EmailService,
    private apiKeyService: ApiKeyService,
  ) {}

  async onboardBetaUser(
    params: {
      email: string;
      name: string;
      organizationName: string;
    },
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<OnboardBetaUserResponseDto> {
    const existing = await this.userService.findByEmail(params.email);
    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    this.logger.log('Beta-user onboarding started');

    const { user, organizationId, passwordChangeCredential } =
      await this.userService.createBetaUser(params, requestMetadata);

    try {
      await this.apiKeyService.createOrganizationApiKey(
        organizationId,
        user.id as UserId,
      );
    } catch (error) {
      this.logger.error('Failed to create beta-user organization API key', {
        organizationId,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }

    await this.emailService.sendWelcomeEmail({
      to: params.email,
      name: params.name,
      passwordChangeCredential,
    });

    this.logger.log(
      `Beta user onboarded: userId=${user.id}, orgId=${organizationId}`,
    );

    return {
      userId: user.id as UserId,
      organizationId,
      email: params.email,
    };
  }

  async onboardApprovedRequest(
    requestId: PrivateBetaAccessRequestId,
    requestMetadata: BrowserSessionRequestMetadata,
  ): Promise<OnboardBetaUserResponseDto> {
    let request = await this.userService.getBetaOnboardingRequest(requestId);
    if (
      request.status !== 'APPROVAL_IN_PROGRESS' &&
      request.status !== 'PROVISIONING_FAILED' &&
      request.status !== 'APPROVED'
    ) {
      throw new ConflictException(
        'Private-beta access request is not ready for approved onboarding',
      );
    }
    this.logger.debug('Private-beta approved-request provisioning entered', {
      requestId,
      hasUser: request.provisionedUserId !== null,
      hasOrganization: request.provisionedOrganizationId !== null,
      hasWelcomeEmail: request.welcomeEmailSentAt !== null,
    });

    if (
      request.welcomeEmailSentAt &&
      request.provisionedUserId &&
      request.provisionedOrganizationId
    ) {
      this.logger.debug('Private-beta approved-request outcome replayed', {
        requestId,
        userId: request.provisionedUserId,
        organizationId: request.provisionedOrganizationId,
      });
      return {
        userId: request.provisionedUserId,
        organizationId: request.provisionedOrganizationId,
        email: request.normalizedEmail,
      };
    }

    let provisioned: Awaited<
      ReturnType<UserService['createOrResumeBetaUserForRequest']>
    >;
    try {
      provisioned = await this.userService.createOrResumeBetaUserForRequest(
        requestId,
        requestMetadata,
      );
    } catch (error) {
      throw toPrivateBetaProvisioningError('USER_PROVISIONING', error);
    }

    const userId = provisioned.user.id as UserId;
    const organizationId = provisioned.organizationId;
    request = provisioned.request;

    let failureCode: PrivateBetaAccessProvisioningFailureCode =
      'API_KEY_PROVISIONING';
    try {
      let apiKeyId = request.provisioningOrganizationApiKeyId;
      if (!apiKeyId) {
        this.logger.debug('Private-beta organization API-key checkpoint read', {
          requestId,
          organizationId,
          hasApiKey: false,
        });
        const existingApiKey =
          await this.apiKeyService.findOrganizationApiKey(organizationId);
        if (existingApiKey) {
          apiKeyId = existingApiKey.id;
          this.logger.debug(
            'Private-beta organization API-key resource reused',
            {
              requestId,
              organizationId,
              apiKeyId,
            },
          );
        } else {
          try {
            const createdApiKey =
              await this.apiKeyService.createOrganizationApiKey(
                organizationId,
                userId,
              );
            apiKeyId = createdApiKey.id;
            this.logger.debug(
              'Private-beta organization API-key resource created',
              {
                requestId,
                organizationId,
                apiKeyId,
              },
            );
          } catch (error) {
            const racedApiKey =
              await this.apiKeyService.findOrganizationApiKey(organizationId);
            if (!racedApiKey) {
              throw error;
            }
            apiKeyId = racedApiKey.id;
            this.logger.debug(
              'Private-beta organization API-key creation race resolved by reuse',
              { requestId, organizationId, apiKeyId },
            );
          }
        }
        await this.userService.recordBetaOnboardingApiKey(requestId, apiKeyId);
      } else {
        this.logger.debug(
          'Private-beta organization API-key checkpoint reused',
          {
            requestId,
            organizationId,
            apiKeyId,
          },
        );
      }

      failureCode = 'WELCOME_EMAIL';
      request = await this.userService.getBetaOnboardingRequest(requestId);
      if (request.welcomeEmailSentAt) {
        this.logger.debug('Private-beta welcome-email checkpoint reused', {
          requestId,
          userId,
          organizationId,
        });
        return {
          userId,
          organizationId,
          email: request.normalizedEmail,
        };
      }

      const providerIdempotencyKey =
        request.welcomeEmailIdempotencyKey ??
        this.welcomeEmailIdempotencyKey(requestId);
      this.logger.debug('Private-beta welcome-email delivery attempt started', {
        requestId,
        userId,
        organizationId,
        providerIdempotencyKey,
      });
      await this.emailService.sendWelcomeEmail({
        to: request.normalizedEmail,
        name: request.name,
        passwordChangeCredential: provisioned.passwordChangeCredential,
        providerIdempotencyKey,
      });
      await this.userService.markBetaWelcomeEmailSent(
        requestId,
        providerIdempotencyKey,
      );
      this.logger.debug(
        'Private-beta welcome-email delivery outcome recorded',
        {
          requestId,
          userId,
          organizationId,
          providerIdempotencyKey,
        },
      );
    } catch (error) {
      throw toPrivateBetaProvisioningError(failureCode, error);
    }

    return {
      userId,
      organizationId,
      email: request.normalizedEmail,
    };
  }

  private welcomeEmailIdempotencyKey(
    requestId: PrivateBetaAccessRequestId,
  ): string {
    return `private-beta-welcome:${requestId}`;
  }
}
