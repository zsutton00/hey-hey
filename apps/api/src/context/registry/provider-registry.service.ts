import { Injectable, Logger } from '@nestjs/common';
import { ContextProvider, ContextType } from '../interfaces';
import { ProviderId } from '../types/context.types';

@Injectable()
export class ProviderRegistryService {
  private readonly logger = new Logger(ProviderRegistryService.name);
  private readonly providers = new Map<ProviderId, ContextProvider>();
  private readonly typeToProviders = new Map<ContextType, ProviderId[]>();

  constructor() {
    this.logger.log('[constructor] Initializing ProviderRegistryService');
  }

  registerProvider(provider: ContextProvider): void {
    const providerId = provider.name as ProviderId;

    this.logger.log('[registerProvider] Registering context provider', {
      providerId,
      priority: provider.priority,
      supportedTypes: provider.supportedTypes,
    });

    this.providers.set(providerId, provider);

    // Update type-to-provider mapping
    provider.supportedTypes.forEach((typeStr) => {
      const type = typeStr as ContextType;
      if (!this.typeToProviders.has(type)) {
        this.typeToProviders.set(type, []);
      }
      const providerList = this.typeToProviders.get(type);
      if (providerList && !providerList.includes(providerId)) {
        providerList.push(providerId);
        // Sort by priority (lower number = higher priority)
        providerList.sort((a, b) => {
          const providerA = this.providers.get(a);
          const providerB = this.providers.get(b);
          return (providerA?.priority || 999) - (providerB?.priority || 999);
        });
      }
    });

    this.logger.debug('[registerProvider] Provider registration completed', {
      providerId,
      totalProviders: this.providers.size,
      typeMapping: Object.fromEntries(this.typeToProviders),
    });
  }

  getProvider(providerId: ProviderId): ContextProvider | undefined {
    const provider = this.providers.get(providerId);

    this.logger.debug('[getProvider] Provider lookup', {
      providerId,
      found: !!provider,
      providerType: provider?.constructor.name,
    });

    return provider;
  }

  getProvidersForType(type: ContextType): ContextProvider[] {
    const providerIds = this.typeToProviders.get(type) || [];
    const providers = providerIds
      .map((id) => this.providers.get(id))
      .filter(
        (provider): provider is ContextProvider => provider !== undefined,
      );

    this.logger.debug('[getProvidersForType] Provider lookup by type', {
      type,
      providerIds,
      providersFound: providers.length,
      providerNames: providers.map((p) => p.name),
    });

    return providers;
  }

  getAllProviders(): ContextProvider[] {
    const providers = Array.from(this.providers.values());

    this.logger.debug('[getAllProviders] All providers retrieved', {
      totalProviders: providers.length,
      providerNames: providers.map((p) => p.name),
    });

    return providers;
  }

  getRegisteredProviderIds(): ProviderId[] {
    const providerIds = Array.from(this.providers.keys());

    this.logger.debug('[getRegisteredProviderIds] Provider IDs retrieved', {
      providerIds,
      totalCount: providerIds.length,
    });

    return providerIds;
  }

  // TODO: Add circuit breaker pattern for provider failures
  // TODO: Implement caching layer for context results
  // TODO: Add health checks and provider availability monitoring
  // TODO: Implement fallback provider chain
  // TODO: Add provider performance metrics and load balancing
}
