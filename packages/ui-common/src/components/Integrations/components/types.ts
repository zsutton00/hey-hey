import type { IntegrationType, IntegrationTargetType } from "../../../api";

// Base interface for all integration configs
interface BaseIntegrationConfig {
  type: IntegrationType;
}

// GitHub specific configuration
export interface GitHubIntegrationConfig extends BaseIntegrationConfig {
  type: "GITHUB";
  token: string;
  targetType: IntegrationTargetType;
  repositoryUrl?: string;
  organizationName?: string;
}

// Jira specific configuration
export interface JiraIntegrationConfig extends BaseIntegrationConfig {
  type: "JIRA";
  serverUrl: string;
  email: string;
  apiToken: string;
  projectKey?: string;
  instanceType: "cloud" | "server";
}

// Form data interfaces
export interface BaseFormData {
  name: string;
  description: string;
}

export interface GitHubFormData {
  token: string;
  targetType: (typeof IntegrationTargetType)[keyof typeof IntegrationTargetType];
  repositoryUrl: string;
  organizationName: string;
}

export interface JiraFormData {
  serverUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
  instanceType: "cloud" | "server";
}

// Test result interface
export interface TestResult {
  success: boolean;
  message: string;
}
