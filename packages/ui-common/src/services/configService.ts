import {
  getApiBaseUrl,
  getWsUrl,
  getRuntimeEnvironment,
} from "./runtimeConfig";

/**
 * Configuration Service
 *
 * Centralized configuration management for the application
 */

interface AppConfig {
  apiBaseUrl: string;
  wsUrl: string;
  environment: "development" | "staging" | "production";
  features: {
    workflowManagement: boolean;
    debugTools: boolean;
  };
}

class ConfigService {
  private static instance: ConfigService;
  private config: AppConfig;

  private constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  /**
   * Load configuration from environment variables
   */
  private loadConfig(): AppConfig {
    // Check for Vite environment variables
    const viteEnv =
      typeof import.meta !== "undefined" && import.meta.env
        ? (import.meta.env as Record<string, string | undefined>)
        : {};

    const runtimeEnvironment = getRuntimeEnvironment();
    const environment: AppConfig["environment"] =
      runtimeEnvironment === "development" || runtimeEnvironment === "staging"
        ? runtimeEnvironment
        : "production";
    const apiBaseUrl = getApiBaseUrl();
    const wsUrl = getWsUrl();

    return {
      apiBaseUrl,
      wsUrl,
      environment,
      features: {
        workflowManagement:
          viteEnv.VITE_FEATURE_WORKFLOW_MANAGEMENT !== "false",
        debugTools:
          environment === "development" ||
          viteEnv.VITE_FEATURE_DEBUG_TOOLS === "true",
      },
    };
  }

  /**
   * Get API base URL
   */
  getApiBaseUrl(): string {
    return this.config.apiBaseUrl;
  }

  /**
   * Get WebSocket URL
   */
  getWsUrl(): string {
    return this.config.wsUrl;
  }

  /**
   * Get current environment
   */
  getEnvironment(): AppConfig["environment"] {
    return this.config.environment;
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(feature: keyof AppConfig["features"]): boolean {
    return this.config.features[feature] ?? false;
  }

  /**
   * Get all configuration
   */
  getConfig(): Readonly<AppConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Update configuration (useful for testing)
   */
  updateConfig(updates: Partial<AppConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      features: {
        ...this.config.features,
        ...(updates.features || {}),
      },
    };
  }

  /**
   * Reset to default configuration
   */
  resetConfig(): void {
    this.config = this.loadConfig();
  }
}

// Export singleton instance
export const configService = ConfigService.getInstance();

// Export types
export type { AppConfig };

// Export for testing purposes
export { ConfigService };
