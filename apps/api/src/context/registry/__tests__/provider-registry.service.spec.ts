import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ContextProvider,
  ContextRequest,
  ContextScope,
  ContextType,
} from '../../interfaces';
import { OrganizationId } from '../../../types';
import { ProviderPriority, ProviderId } from '../../types/context.types';
import { ProviderRegistryService } from '../provider-registry.service';

describe('ProviderRegistryService', () => {
  let service: ProviderRegistryService;
  let loggerSpy: jest.SpyInstance;

  // Mock providers for testing
  const mockHighPriorityProvider: ContextProvider = {
    name: 'high-priority-provider',
    priority: ProviderPriority.HIGH,
    supportedTypes: [ContextType.CONVERSATION, ContextType.PROJECT],
    canHandle: jest.fn(() => true),
    resolve: jest.fn(),
    estimateTokens: jest.fn(() => 100),
  };

  const mockLowPriorityProvider: ContextProvider = {
    name: 'low-priority-provider',
    priority: ProviderPriority.LOW,
    supportedTypes: [ContextType.RELATED],
    canHandle: jest.fn(() => true),
    resolve: jest.fn(),
    estimateTokens: jest.fn(() => 50),
  };

  const mockMediumPriorityProvider: ContextProvider = {
    name: 'medium-priority-provider',
    priority: ProviderPriority.MEDIUM,
    supportedTypes: [ContextType.INITIATIVE, ContextType.PROJECT],
    canHandle: jest.fn(() => true),
    resolve: jest.fn(),
    estimateTokens: jest.fn(() => 75),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProviderRegistryService],
    }).compile();

    service = module.get<ProviderRegistryService>(ProviderRegistryService);

    // Spy on logger methods
    loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerProvider', () => {
    it('should register a provider successfully', () => {
      // Tests that registerProvider() adds provider to registry and logs registration details
      // Expects: provider is stored and can be retrieved, logs registration info
      service.registerProvider(mockHighPriorityProvider);

      const registeredIds = service.getRegisteredProviderIds();
      expect(registeredIds).toContain('high-priority-provider' as ProviderId);

      const provider = service.getProvider(
        'high-priority-provider' as ProviderId,
      );
      expect(provider).toBe(mockHighPriorityProvider);

      expect(loggerSpy).toHaveBeenCalledWith(
        '[registerProvider] Registering context provider',
        {
          providerId: 'high-priority-provider',
          priority: ProviderPriority.HIGH,
          supportedTypes: [ContextType.CONVERSATION, ContextType.PROJECT],
        },
      );
    });

    it('should update type-to-provider mapping correctly', () => {
      // Tests that registerProvider() creates proper mapping from context types to providers
      // Expects: providers can be found by their supported types
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);

      const conversationProviders = service.getProvidersForType(
        ContextType.CONVERSATION,
      );
      expect(conversationProviders).toHaveLength(1);
      expect(conversationProviders[0]).toBe(mockHighPriorityProvider);

      const relatedProviders = service.getProvidersForType(ContextType.RELATED);
      expect(relatedProviders).toHaveLength(1);
      expect(relatedProviders[0]).toBe(mockLowPriorityProvider);
    });

    it('should sort providers by priority within each type', () => {
      // Tests that registerProvider() maintains priority order (lower number = higher priority)
      // Expects: providers returned in correct priority order for shared types
      service.registerProvider(mockLowPriorityProvider);
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockMediumPriorityProvider);

      const projectProviders = service.getProvidersForType(ContextType.PROJECT);
      expect(projectProviders).toHaveLength(2);

      // Should be ordered by priority: HIGH (1), MEDIUM (2)
      expect(projectProviders[0]).toBe(mockHighPriorityProvider);
      expect(projectProviders[1]).toBe(mockMediumPriorityProvider);
    });

    it('should not duplicate providers when registered multiple times', () => {
      // Tests that registerProvider() handles duplicate registrations correctly
      // Expects: provider appears only once in registry and type mappings
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockHighPriorityProvider);

      const registeredIds = service.getRegisteredProviderIds();
      const highPriorityCount = registeredIds.filter(
        (id) => id === 'high-priority-provider',
      ).length;
      expect(highPriorityCount).toBe(1);

      const conversationProviders = service.getProvidersForType(
        ContextType.CONVERSATION,
      );
      expect(conversationProviders).toHaveLength(1);
    });
  });

  describe('getProvider', () => {
    beforeEach(() => {
      service.registerProvider(mockHighPriorityProvider);
    });

    it('should return provider when found', () => {
      // Tests that getProvider() returns correct provider instance for valid ID
      // Expects: returns the exact provider instance that was registered
      const provider = service.getProvider(
        'high-priority-provider' as ProviderId,
      );
      expect(provider).toBe(mockHighPriorityProvider);
    });

    it('should return undefined when provider not found', () => {
      // Tests that getProvider() handles missing providers gracefully
      // Expects: returns undefined for non-existent provider IDs
      const provider = service.getProvider(
        'nonexistent-provider' as ProviderId,
      );
      expect(provider).toBeUndefined();
    });

    it('should log provider lookup attempts', () => {
      // Tests that getProvider() logs lookup attempts with found/not found status
      // Expects: debug logs contain provider ID and lookup result
      service.getProvider('high-priority-provider' as ProviderId);

      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        '[getProvider] Provider lookup',
        {
          providerId: 'high-priority-provider',
          found: true,
          providerType: 'Object',
        },
      );
    });
  });

  describe('getProvidersForType', () => {
    beforeEach(() => {
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);
      service.registerProvider(mockMediumPriorityProvider);
    });

    it('should return providers for supported type', () => {
      // Tests that getProvidersForType() returns all providers supporting a context type
      // Expects: returns providers in priority order for the requested type
      const providers = service.getProvidersForType(ContextType.PROJECT);
      expect(providers).toHaveLength(2);
      expect(providers[0]).toBe(mockHighPriorityProvider);
      expect(providers[1]).toBe(mockMediumPriorityProvider);
    });

    it('should return empty array for unsupported type', () => {
      // Tests that getProvidersForType() handles types with no registered providers
      // Expects: returns empty array for types not supported by any provider
      const providers = service.getProvidersForType(
        'UNSUPPORTED_TYPE' as ContextType,
      );
      expect(providers).toHaveLength(0);
    });

    it('should return providers in priority order', () => {
      // Tests that getProvidersForType() maintains correct priority ordering
      // Expects: providers with lower priority numbers come first
      const providers = service.getProvidersForType(ContextType.PROJECT);
      const [firstProvider, secondProvider] = providers;
      if (!firstProvider || !secondProvider) {
        throw new Error('Expected at least two providers');
      }
      expect(firstProvider.priority).toBeLessThan(secondProvider.priority);
    });
  });

  describe('getAllProviders', () => {
    it('should return empty array when no providers registered', () => {
      // Tests that getAllProviders() returns empty array for new service instance
      // Expects: empty array when no providers have been registered yet
      const providers = service.getAllProviders();
      expect(providers).toHaveLength(0);
    });

    it('should return all registered providers', () => {
      // Tests that getAllProviders() returns complete list of registered providers
      // Expects: array containing all providers that have been registered
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);

      const providers = service.getAllProviders();
      expect(providers).toHaveLength(2);
      expect(providers).toContain(mockHighPriorityProvider);
      expect(providers).toContain(mockLowPriorityProvider);
    });
  });

  describe('getRegisteredProviderIds', () => {
    it('should return empty array when no providers registered', () => {
      // Tests that getRegisteredProviderIds() returns empty array for new service
      // Expects: empty array when no providers have been registered yet
      const providerIds = service.getRegisteredProviderIds();
      expect(providerIds).toHaveLength(0);
    });

    it('should return list of provider IDs', () => {
      // Tests that getRegisteredProviderIds() returns names of all registered providers
      // Expects: array of provider name strings for all registered providers
      service.registerProvider(mockHighPriorityProvider);
      service.registerProvider(mockLowPriorityProvider);

      const providerIds = service.getRegisteredProviderIds();
      expect(providerIds).toHaveLength(2);
      expect(providerIds).toContain('high-priority-provider');
      expect(providerIds).toContain('low-priority-provider');
    });
  });

  describe('Logging', () => {
    it('should log service initialization', () => {
      // Tests that constructor logs service initialization
      // Expects: log message indicating ProviderRegistryService is starting up
      expect(loggerSpy).toHaveBeenCalledWith(
        '[constructor] Initializing ProviderRegistryService',
      );
    });

    it('should log detailed registration information', () => {
      // Tests that registerProvider() logs comprehensive registration details
      // Expects: logs provider info, type mapping updates, and final registry state
      service.registerProvider(mockHighPriorityProvider);

      expect(Logger.prototype.debug).toHaveBeenCalledWith(
        '[registerProvider] Provider registration completed',
        expect.objectContaining({
          providerId: 'high-priority-provider',
          totalProviders: 1,
          typeMapping: expect.any(Object),
        }),
      );
    });
  });
});
