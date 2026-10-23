import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaymentProviderWebhookController } from '../payment-provider-webhook.controller';
import type {
  NormalizedPaymentProviderEvent,
  PaymentProviderAdapterRequest,
} from '../../services/payment-entitlement/payment-provider-adapter';
import { PaymentProviderInputError } from '../../services/payment-entitlement/payment-provider-adapter';
import type { PaymentProviderAdapterRegistry } from '../../services/payment-entitlement/payment-provider-adapter.registry';
import type { PaymentEntitlementReconciliationOwner } from '../../services/payment-entitlement/payment-entitlement-reconciliation.owner';

const CONTROLLER_LOG_KEYS = [
  'event',
  'provider',
  'environment',
  'hasRawBody',
  'rawBodyLength',
  'providerEventId',
  'normalizedEventKind',
  'errorType',
] as const;

const expectSafeControllerLogs = (
  calls: unknown[][],
  forbiddenValues: string[],
) => {
  const entries = calls.map(([entry]) => entry);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry).toEqual(expect.any(Object));
    expect(
      Object.keys(entry as Record<string, unknown>).every((key) =>
        CONTROLLER_LOG_KEYS.includes(
          key as (typeof CONTROLLER_LOG_KEYS)[number],
        ),
      ),
    ).toBe(true);
  }

  const serialized = JSON.stringify(entries);
  for (const forbiddenValue of forbiddenValues) {
    expect(serialized).not.toContain(forbiddenValue);
  }
};

describe('PaymentProviderWebhookController', () => {
  const rawBody = Buffer.from('{"event":"paid","amount":1000}');
  const normalized: NormalizedPaymentProviderEvent = {
    provider: 'stripe',
    environment: 'sandbox',
    providerEventId: 'evt_123',
    normalizedEventKind: 'PAID_PERIOD_UPDATED',
    externalCustomerId: 'cus_123',
    externalSubscriptionId: 'sub_123',
    providerOccurredAt: null,
    providerEventVersion: '2',
    providerEventSequence: 2n,
    paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
    payloadHash: 'a'.repeat(64),
  };

  let verifyAndNormalize: jest.Mock;
  let reconcile: jest.Mock;
  let controller: PaymentProviderWebhookController;

  beforeEach(() => {
    verifyAndNormalize = jest.fn(
      async (request: PaymentProviderAdapterRequest) => {
        expect(request.rawBody).toBe(rawBody);
        return normalized;
      },
    );
    reconcile = jest.fn(async () => ({
      status: 'ACCEPTED',
      providerEventId: normalized.providerEventId,
      entitlementRevision: 2,
      duplicate: false,
    }));
    controller = new PaymentProviderWebhookController(
      { verifyAndNormalize } as unknown as PaymentProviderAdapterRegistry,
      { reconcile } as unknown as PaymentEntitlementReconciliationOwner,
    );
  });

  it('delegates the exact captured bytes and typed headers, then returns generic accepted', async () => {
    const logger = (
      controller as unknown as {
        logger: { debug: (...args: unknown[]) => void };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    const headers = {
      'content-type': 'application/json',
      'x-provider-signature': 'signature',
      'x-provider-attempt': ['one', 'two'],
    };
    const request = {
      rawBody,
      headers,
    } as unknown as import('@nestjs/common').RawBodyRequest<Request>;

    await expect(
      controller.receive(request, 'stripe', 'sandbox'),
    ).resolves.toEqual({ accepted: true });

    expect(verifyAndNormalize).toHaveBeenCalledWith({
      provider: 'stripe',
      environment: 'sandbox',
      rawBody,
      headers: expect.objectContaining(headers),
    });
    const delegated = reconcile.mock.calls[0]?.[0];
    expect(delegated.request.rawBody).toBe(rawBody);
    expect(delegated.request.headers).toEqual(headers);
    expect(delegated.event).toBe(normalized);
    expectSafeControllerLogs(debugSpy.mock.calls, [
      rawBody.toString(),
      'signature',
      'cus_123',
      'sub_123',
      'Bearer provider-credential',
    ]);
    expect(JSON.stringify(debugSpy.mock.calls)).toContain('evt_123');
  });

  it('fails generically before adapter or reconciliation delegation when bytes are missing', async () => {
    const logger = (
      controller as unknown as {
        logger: { debug: (...args: unknown[]) => void };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    const request = {
      rawBody: undefined,
      headers: { 'x-provider-signature': 'signature' },
    } as unknown as import('@nestjs/common').RawBodyRequest<Request>;

    await expect(
      controller.receive(request, 'stripe', 'sandbox'),
    ).rejects.toEqual(new BadRequestException('Invalid payment event'));
    expect(verifyAndNormalize).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expectSafeControllerLogs(debugSpy.mock.calls, [
      'signature',
      'provider-credential',
    ]);
  });

  it('maps provider input failures to a generic invalid response', async () => {
    const logger = (
      controller as unknown as {
        logger: { debug: (...args: unknown[]) => void };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    verifyAndNormalize.mockRejectedValueOnce(new PaymentProviderInputError());
    const request = {
      rawBody,
      headers: {},
    } as unknown as import('@nestjs/common').RawBodyRequest<Request>;

    await expect(
      controller.receive(request, 'stripe', 'sandbox'),
    ).rejects.toEqual(new BadRequestException('Invalid payment event'));
    expect(reconcile).not.toHaveBeenCalled();
    expectSafeControllerLogs(debugSpy.mock.calls, [
      rawBody.toString(),
      'signature',
      'cus_123',
      'sub_123',
      'provider-credential',
    ]);
    expect(debugSpy.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            event: 'payment_provider_webhook_invalid',
            errorType: 'PaymentProviderInputError',
          }),
        ],
      ]),
    );
  });

  it('maps unexpected reconciliation failures to a generic retryable server response', async () => {
    const logger = (
      controller as unknown as {
        logger: { debug: (...args: unknown[]) => void };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    reconcile.mockRejectedValueOnce(new Error('database details'));
    const request = {
      rawBody,
      headers: {},
    } as unknown as import('@nestjs/common').RawBodyRequest<Request>;

    await expect(
      controller.receive(request, 'stripe', 'sandbox'),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'Payment event processing is temporarily unavailable',
      ),
    );
    expectSafeControllerLogs(debugSpy.mock.calls, [
      rawBody.toString(),
      'database details',
      'signature',
      'cus_123',
      'sub_123',
      'Bearer provider-credential',
    ]);
    expect(debugSpy.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            event: 'payment_provider_webhook_retryable_failure',
            errorType: 'Error',
          }),
        ],
      ]),
    );
  });
});
