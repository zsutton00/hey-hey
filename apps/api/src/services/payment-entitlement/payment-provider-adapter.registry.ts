import { Injectable } from '@nestjs/common';
import {
  NormalizedPaymentProviderEvent,
  PaymentProviderAdapter,
  PaymentProviderAdapterRequest,
  PaymentProviderInputError,
} from './payment-provider-adapter';

export class UnsupportedPaymentProviderError extends Error {
  constructor(provider: string, environment: string) {
    super(
      `Unsupported payment provider environment: ${provider}/${environment}`,
    );
    this.name = 'UnsupportedPaymentProviderError';
  }
}

@Injectable()
export class PaymentProviderAdapterRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();

  register(adapter: PaymentProviderAdapter): void {
    const provider = this.normalize(adapter.provider, 'adapter.provider');
    if (!adapter.environments.length) {
      throw new Error('A payment provider adapter must declare environments');
    }

    for (const environmentValue of adapter.environments) {
      const environment = this.normalize(
        environmentValue,
        'adapter.environment',
      );
      const key = this.key(provider, environment);
      if (this.adapters.has(key)) {
        throw new Error(
          `Payment provider adapter already registered for ${provider}/${environment}`,
        );
      }
      this.adapters.set(key, adapter);
    }
  }

  resolve(provider: string, environment: string): PaymentProviderAdapter {
    const normalizedProvider = this.normalize(provider, 'provider');
    const normalizedEnvironment = this.normalize(environment, 'environment');
    const adapter = this.adapters.get(
      this.key(normalizedProvider, normalizedEnvironment),
    );
    if (!adapter) {
      throw new UnsupportedPaymentProviderError(
        normalizedProvider,
        normalizedEnvironment,
      );
    }
    return adapter;
  }

  async verifyAndNormalize(
    request: PaymentProviderAdapterRequest,
  ): Promise<NormalizedPaymentProviderEvent> {
    if (!Buffer.isBuffer(request.rawBody)) {
      throw new PaymentProviderInputError();
    }
    const provider = this.normalizeInput(request.provider);
    const environment = this.normalizeInput(request.environment);
    let adapter: PaymentProviderAdapter;
    try {
      adapter = this.resolve(provider, environment);
    } catch {
      throw new PaymentProviderInputError();
    }
    const scopedRequest: PaymentProviderAdapterRequest = {
      ...request,
      provider,
      environment,
    };
    try {
      await adapter.verifySignature(scopedRequest);
      const normalized = await adapter.normalizeVerifiedEvent(scopedRequest);

      if (
        normalized.provider !== provider ||
        normalized.environment !== environment ||
        !normalized.providerEventId.trim() ||
        !normalized.normalizedEventKind.trim() ||
        !/^[0-9a-f]{64}$/i.test(normalized.payloadHash)
      ) {
        throw new PaymentProviderInputError(
          'Payment provider adapter returned invalid normalized data',
        );
      }
      return normalized;
    } catch (error) {
      if (error instanceof PaymentProviderInputError) throw error;
      throw new PaymentProviderInputError();
    }
  }

  private key(provider: string, environment: string): string {
    return `${provider}\u0000${environment}`;
  }

  private normalize(value: string, field: string): string {
    if (!value?.trim()) throw new Error(`${field} is required`);
    return value.trim().toLowerCase();
  }

  private normalizeInput(value: string): string {
    if (!value?.trim()) throw new PaymentProviderInputError();
    return value.trim().toLowerCase();
  }
}
