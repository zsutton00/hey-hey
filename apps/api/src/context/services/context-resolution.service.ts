import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  ContextFilters,
  ContextProvider,
  ContextRequest,
  ContextResult,
} from '../interfaces';
import { ProviderRegistryService } from '../registry/provider-registry.service';
import {
  ContextRequestId,
  ContextResolutionMetrics,
  ProviderId,
  ProviderMetrics,
} from '../types/context.types';

@Injectable()
export class ContextResolutionService {
  private readonly logger = new Logger(ContextResolutionService.name);
  private readonly providerMetrics = new Map<ProviderId, ProviderMetrics>();

  constructor(private readonly providerRegistry: ProviderRegistryService) {
    this.logger.log('[constructor] Initializing ContextResolutionService');
  }

  registerProvider(provider: ContextProvider): void {
    const providerId = provider.name as ProviderId;

    this.logger.log('[registerProvider] Delegating to provider registry', {
      providerId,
      priority: provider.priority,
      supportedTypes: provider.supportedTypes,
    });

    // Delegate to provider registry
    this.providerRegistry.registerProvider(provider);

    // Initialize metrics for this provider
    if (!this.providerMetrics.has(providerId)) {
      this.providerMetrics.set(providerId, {
        totalRequests: 0,
        averageExecutionTime: 0,
        successRate: 1.0,
        lastUsed: new Date(),
      });
    }
  }

  async resolveContext(
    request: ContextRequest,
    filters?: ContextFilters,
  ): Promise<ContextResult> {
    const requestId = uuidv4() as ContextRequestId;
    const startTime = Date.now();

    this.logger.log('[resolveContext] Starting context resolution', {
      requestId,
      requestType: request.type,
      scope: request.scope,
      organizationId: request.organizationId,
      projectId: request.projectId,
      conversationId: request.conversationId,
      initiativeId: request.initiativeId,
      maxTokens: request.maxTokens,
      maxResults: request.maxResults,
      correlationId: request.correlationId,
      availableProviders: this.providerRegistry.getAllProviders().length,
      filters: filters ? Object.keys(filters) : undefined,
    });

    try {
      // Find capable providers
      const capableProviders = this.findCapableProviders(request);

      if (capableProviders.length === 0) {
        this.logger.warn('[resolveContext] No capable providers found', {
          requestId,
          requestType: request.type,
          organizationId: request.organizationId,
          correlationId: request.correlationId,
        });

        return {
          artifacts: [],
          totalCount: 0,
          tokenEstimate: 0,
          providerName: 'none',
          executionTimeMs: Date.now() - startTime,
          metadata: {
            queryStrategy: 'no_providers_available',
            filters,
          },
        };
      }

      // Select best provider
      const selectedProvider = this.selectBestProvider(
        capableProviders,
        request,
      );
      const providerId = selectedProvider.name as ProviderId;

      this.logger.log('[resolveContext] Selected provider for execution', {
        requestId,
        providerId,
        providerPriority: selectedProvider.priority,
        capableProvidersCount: capableProviders.length,
        correlationId: request.correlationId,
      });

      // Execute provider
      const providerStartTime = Date.now();
      const result = await selectedProvider.resolve(request, filters);
      const providerExecutionTime = Date.now() - providerStartTime;

      // Update metrics
      this.updateProviderMetrics(providerId, providerExecutionTime, true);

      const totalExecutionTime = Date.now() - startTime;

      this.logger.log('[resolveContext] Context resolution completed', {
        requestId,
        providerId,
        artifactsReturned: result.artifacts.length,
        totalCount: result.totalCount,
        tokenEstimate: result.tokenEstimate,
        providerExecutionTime,
        totalExecutionTime,
        correlationId: request.correlationId,
      });

      const metrics: ContextResolutionMetrics = {
        requestId,
        totalProviders: this.providerRegistry.getAllProviders().length,
        selectedProvider: providerId,
        executionTime: totalExecutionTime,
        artifactsReturned: result.artifacts.length,
        tokenEstimate: result.tokenEstimate,
      };

      return {
        ...result,
        executionTimeMs: totalExecutionTime,
        metadata: {
          ...result.metadata,
          resolutionMetrics: metrics,
        },
      };
    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('[resolveContext] Context resolution failed', {
        requestId,
        requestType: request.type,
        organizationId: request.organizationId,
        error: error instanceof Error ? error.message : error,
        executionTime,
        correlationId: request.correlationId,
      });

      // Update metrics for failed request
      const providers = this.findCapableProviders(request);
      if (providers.length > 0) {
        const selectedProvider = this.selectBestProvider(providers, request);
        this.updateProviderMetrics(
          selectedProvider.name as ProviderId,
          executionTime,
          false,
        );
      }

      throw error;
    }
  }

  private findCapableProviders(request: ContextRequest): ContextProvider[] {
    // Get providers for this request type first
    const typeProviders = this.providerRegistry.getProvidersForType(
      request.type,
    );
    const capable: ContextProvider[] = [];

    for (const provider of typeProviders) {
      if (provider.canHandle(request)) {
        capable.push(provider);
      }
    }

    this.logger.debug('[findCapableProviders] Found capable providers', {
      requestType: request.type,
      typeProvidersCount: typeProviders.length,
      capableCount: capable.length,
      providerNames: capable.map((p) => p.name),
      correlationId: request.correlationId,
    });

    return capable;
  }

  private selectBestProvider(
    providers: ContextProvider[],
    request: ContextRequest,
  ): ContextProvider {
    if (providers.length === 0) {
      throw new Error('No providers available for selection');
    }
    // Sort by priority (lower number = higher priority)
    const sortedProviders = providers.sort((a, b) => a.priority - b.priority);

    // For now, use simple priority-based selection
    // TODO: Add health/circuit breaker logic later
    const selected = sortedProviders[0];
    if (!selected) {
      throw new Error('No providers available for selection');
    }

    this.logger.debug('[selectBestProvider] Provider selection completed', {
      selectedProvider: selected.name,
      selectedPriority: selected.priority,
      totalCandidates: providers.length,
      requestType: request.type,
      correlationId: request.correlationId,
    });

    return selected;
  }

  private updateProviderMetrics(
    providerId: ProviderId,
    executionTime: number,
    success: boolean,
  ): void {
    const current = this.providerMetrics.get(providerId);
    if (!current) return;

    const updated: ProviderMetrics = {
      totalRequests: current.totalRequests + 1,
      averageExecutionTime:
        (current.averageExecutionTime * current.totalRequests + executionTime) /
        (current.totalRequests + 1),
      successRate:
        (current.successRate * current.totalRequests + (success ? 1 : 0)) /
        (current.totalRequests + 1),
      lastUsed: new Date(),
    };

    this.providerMetrics.set(providerId, updated);

    this.logger.debug('[updateProviderMetrics] Updated provider metrics', {
      providerId,
      totalRequests: updated.totalRequests,
      averageExecutionTime: Math.round(updated.averageExecutionTime),
      successRate: Math.round(updated.successRate * 100) / 100,
      currentExecutionTime: executionTime,
      success,
    });
  }

  getProviderMetrics(): Map<ProviderId, ProviderMetrics> {
    return new Map(this.providerMetrics);
  }

  getRegisteredProviders(): string[] {
    return this.providerRegistry.getRegisteredProviderIds();
  }
}
