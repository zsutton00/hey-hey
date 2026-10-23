import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import type { PaymentProviderWebhookAcceptedResponseDto } from '../generated';
import type {
  PaymentProviderAdapterRequest,
  PaymentProviderHeaders,
} from '../services/payment-entitlement/payment-provider-adapter';
import { PaymentProviderInputError } from '../services/payment-entitlement/payment-provider-adapter';
import { PaymentProviderAdapterRegistry } from '../services/payment-entitlement/payment-provider-adapter.registry';
import { PaymentEntitlementReconciliationOwner } from '../services/payment-entitlement/payment-entitlement-reconciliation.owner';

const ACCEPTED_RESPONSE = {
  accepted: true,
} satisfies PaymentProviderWebhookAcceptedResponseDto;
const INVALID_RESPONSE_MESSAGE = 'Invalid payment event';
const RETRYABLE_RESPONSE_MESSAGE =
  'Payment event processing is temporarily unavailable';

@ApiTags('Payment Provider Webhooks')
@Controller('api/v1/payment-providers')
export class PaymentProviderWebhookController {
  private readonly logger = new Logger(PaymentProviderWebhookController.name);

  constructor(
    private readonly adapterRegistry: PaymentProviderAdapterRegistry,
    private readonly reconciliationOwner: PaymentEntitlementReconciliationOwner,
  ) {}

  @Post(':provider/:environment/webhook')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive a payment-provider event',
    description:
      'Verifies the captured request bytes, normalizes provider facts, and durably reconciles the event without disclosing binding or entitlement state.',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'The verified event was accepted for generic processing.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'The event is invalid.',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'The event may be retried later.',
  })
  async handlePaymentProviderWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Param('provider') provider: string,
    @Param('environment') environment: string,
  ): Promise<PaymentProviderWebhookAcceptedResponseDto> {
    try {
      const rawBody = request.rawBody;
      if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
        this.logger.debug({
          event: 'payment_provider_webhook_raw_body_invalid',
          provider,
          environment,
          hasRawBody: Buffer.isBuffer(rawBody),
          rawBodyLength: Buffer.isBuffer(rawBody) ? rawBody.length : null,
        });
        throw new PaymentProviderInputError();
      }

      const headers = Object.freeze({
        ...request.headers,
      }) as PaymentProviderHeaders;
      const adapterRequest: PaymentProviderAdapterRequest = {
        provider,
        environment,
        rawBody,
        headers,
      };

      this.logger.debug({
        event: 'payment_provider_webhook_adapter_selection',
        provider,
        environment,
        rawBodyLength: rawBody.length,
      });
      const normalized =
        await this.adapterRegistry.verifyAndNormalize(adapterRequest);

      this.logger.debug({
        event: 'payment_provider_webhook_reconciliation_delegation',
        provider: normalized.provider,
        environment: normalized.environment,
        providerEventId: normalized.providerEventId,
        normalizedEventKind: normalized.normalizedEventKind,
      });
      await this.reconciliationOwner.reconcile({
        request: adapterRequest,
        event: normalized,
      });

      this.logger.debug({
        event: 'payment_provider_webhook_accepted',
        provider: normalized.provider,
        environment: normalized.environment,
        providerEventId: normalized.providerEventId,
      });
      return ACCEPTED_RESPONSE;
    } catch (error) {
      const isProviderInput = error instanceof PaymentProviderInputError;
      this.logger.debug({
        event: isProviderInput
          ? 'payment_provider_webhook_invalid'
          : 'payment_provider_webhook_retryable_failure',
        provider,
        environment,
        errorType:
          error instanceof Error ? error.constructor.name : typeof error,
      });
      if (isProviderInput) {
        throw new BadRequestException(INVALID_RESPONSE_MESSAGE);
      }
      throw new ServiceUnavailableException(RETRYABLE_RESPONSE_MESSAGE);
    }
  }

  /** Compatibility-friendly direct-call name for controller-level tests. */
  async receive(
    request: RawBodyRequest<Request>,
    provider: string,
    environment: string,
  ): Promise<PaymentProviderWebhookAcceptedResponseDto> {
    return this.handlePaymentProviderWebhook(request, provider, environment);
  }
}
