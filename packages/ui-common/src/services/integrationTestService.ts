import axios, { type AxiosRequestConfig } from "axios";
import type {
  GitHubFormData,
  JiraFormData,
  TestResult,
} from "../components/Integrations/components/types";
import { IntegrationTargetType } from "../api";

export class IntegrationTestService {
  /**
   * Test GitHub integration configuration
   */
  static async testGitHubConnection(data: GitHubFormData): Promise<TestResult> {
    try {
      // Test the GitHub token by making a request to the GitHub API
      const config: AxiosRequestConfig = {
        headers: {
          Authorization: `Bearer ${data.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Hey-Hey-Integration-Test",
        },
        timeout: 10000, // 10 second timeout
      };

      const response = await axios.get("https://api.github.com/user", config);

      const user = response.data;

      // Additional validation based on target type
      if (
        data.targetType === IntegrationTargetType.Organization &&
        data.organizationName
      ) {
        // Test organization access
        try {
          await axios.get(
            `https://api.github.com/orgs/${data.organizationName}`,
            {
              ...config,
              timeout: 5000,
            }
          );
        } catch (orgError: unknown) {
          const error = orgError as { response?: { status?: number } };
          if (error.response?.status === 404) {
            return {
              success: false,
              message: `Organization "${data.organizationName}" not found or you don't have access to it.`,
            };
          }
          if (error.response?.status === 403) {
            return {
              success: false,
              message: `Access denied to organization "${data.organizationName}". Check your token permissions.`,
            };
          }
          throw orgError;
        }
      }

      if (
        data.targetType === IntegrationTargetType.User &&
        data.repositoryUrl
      ) {
        // Extract owner/repo from URL and test repository access
        const repoMatch = data.repositoryUrl.match(
          /github\.com\/([^/]+)\/([^/]+)/
        );
        if (repoMatch) {
          const [, owner, repo] = repoMatch;
          try {
            await axios.get(`https://api.github.com/repos/${owner}/${repo}`, {
              ...config,
              timeout: 5000,
            });
          } catch (repoError: unknown) {
            const error = repoError as { response?: { status?: number } };
            if (error.response?.status === 404) {
              return {
                success: false,
                message: `Repository "${owner}/${repo}" not found or you don't have access to it.`,
              };
            }
            if (error.response?.status === 403) {
              return {
                success: false,
                message: `Access denied to repository "${owner}/${repo}". Check your token permissions.`,
              };
            }
            throw error;
          }
        }
      }

      return {
        success: true,
        message: `✅ Successfully connected to GitHub as ${
          user?.login || "unknown user"
        }. Token permissions verified.`,
      };
    } catch (err: unknown) {
      const error = err as {
        response?: { status?: number; data?: { message?: string } };
        code?: string;
        message?: string;
      };
      console.error("GitHub connection test failed:", error);

      if (error.response?.status === 401) {
        return {
          success: false,
          message:
            "Invalid GitHub token. Please check your Personal Access Token.",
        };
      }

      if (error.response?.status === 403) {
        return {
          success: false,
          message:
            "GitHub token permissions insufficient. Ensure your token has the required scopes.",
        };
      }

      if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        return {
          success: false,
          message:
            "Unable to connect to GitHub. Please check your internet connection.",
        };
      }

      if (error.code === "ECONNABORTED") {
        return {
          success: false,
          message: "Connection timeout. GitHub might be experiencing issues.",
        };
      }

      // Handle CORS errors
      if (
        error.code === "ERR_NETWORK" ||
        error.message?.includes("CORS") ||
        error.message?.includes("Access-Control")
      ) {
        return {
          success: false,
          message:
            "Connection test blocked by browser security policy. The token appears valid but direct testing from browser is restricted. This integration should work when created.",
        };
      }

      return {
        success: false,
        message: `Connection failed: ${
          error.response?.data?.message || error.message || "Unknown error"
        }`,
      };
    }
  }

  /**
   * Test Jira integration configuration
   */
  static async testJiraConnection(data: JiraFormData): Promise<TestResult> {
    try {
      // Normalize server URL
      const baseUrl = data.serverUrl.replace(/\/$/, ""); // Remove trailing slash

      // Test the Jira credentials by making a request to get user info
      const auth = Buffer.from(`${data.email}:${data.apiToken}`).toString(
        "base64"
      );

      const response = await axios.get(`${baseUrl}/rest/api/2/myself`, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
        },
        timeout: 15000, // 15 second timeout for potentially slower servers
      });

      const user = response.data;

      // Test project access if project key is specified
      if (data.projectKey) {
        try {
          await axios.get(`${baseUrl}/rest/api/2/project/${data.projectKey}`, {
            headers: {
              Authorization: `Basic ${auth}`,
              Accept: "application/json",
            },
            timeout: 10000,
          });
        } catch (projectError: unknown) {
          const error = projectError as { response?: { status?: number } };
          if (error.response?.status === 404) {
            return {
              success: false,
              message: `Project "${data.projectKey}" not found or you don't have access to it.`,
            };
          }
          if (error.response?.status === 403) {
            return {
              success: false,
              message: `Access denied to project "${data.projectKey}". Check your permissions.`,
            };
          }
          throw error;
        }
      }

      const instanceType =
        data.instanceType === "cloud" ? "Jira Cloud" : "Jira Server";
      const projectMessage = data.projectKey
        ? ` Access to project "${data.projectKey}" verified.`
        : "";

      return {
        success: true,
        message: `✅ Successfully connected to ${instanceType} as ${
          user?.displayName || user?.name || "unknown user"
        }. ${projectMessage}`,
      };
    } catch (err: unknown) {
      const error = err as {
        response?: {
          status?: number;
          data?: { errorMessages?: string[]; message?: string };
        };
        code?: string;
        message?: string;
      };
      console.error("Jira connection test failed:", error);

      if (error.response?.status === 401) {
        return {
          success: false,
          message:
            "Invalid Jira credentials. Please check your email and API token/password.",
        };
      }

      if (error.response?.status === 403) {
        return {
          success: false,
          message:
            "Access denied. Your account may not have sufficient permissions.",
        };
      }

      if (error.code === "ENOTFOUND") {
        return {
          success: false,
          message: `Unable to connect to ${data.serverUrl}. Please verify the server URL is correct.`,
        };
      }

      if (error.code === "ECONNREFUSED") {
        return {
          success: false,
          message:
            "Connection refused. The Jira server may be down or not accessible.",
        };
      }

      if (error.code === "ECONNABORTED") {
        return {
          success: false,
          message:
            "Connection timeout. The Jira server may be slow or experiencing issues.",
        };
      }

      // Handle SSL/TLS errors for self-hosted instances
      if (
        error.code === "CERT_HAS_EXPIRED" ||
        error.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
      ) {
        return {
          success: false,
          message:
            "SSL certificate error. Please contact your Jira administrator.",
        };
      }

      // Handle CORS errors
      if (
        error.code === "ERR_NETWORK" ||
        error.message?.includes("CORS") ||
        error.message?.includes("Access-Control")
      ) {
        return {
          success: false,
          message:
            "Connection test blocked by browser security policy. The credentials appear valid but direct testing from browser is restricted. This integration should work when created.",
        };
      }

      return {
        success: false,
        message: `Connection failed: ${
          error.response?.data?.errorMessages?.[0] ||
          error.response?.data?.message ||
          error.message ||
          "Unknown error"
        }`,
      };
    }
  }

  /**
   * Test integration connection for existing integrations
   */
  static async testExistingIntegration(
    projectId: string,
    integrationId: string,
    organizationId: string
  ): Promise<TestResult> {
    try {
      // Import apiClient dynamically to avoid circular dependencies
      const { apiClient } = await import("../clients");

      const response = await apiClient.testIntegrationConnection({
        organizationId: organizationId,
        projectId: projectId,
        integrationId: integrationId,
      });

      const testData = response.data.data as {
        status?: string;
        success?: boolean;
        message?: string;
        details?: { message?: string };
      };

      return {
        success: testData?.status === "success" || testData?.success === true,
        message:
          testData?.message ||
          testData?.details?.message ||
          "Connection test completed.",
      };
    } catch (err: unknown) {
      const error = err as {
        response?: { data?: { message?: string } };
        message?: string;
      };
      console.error("Integration connection test failed:", error);

      return {
        success: false,
        message: `Connection test failed: ${
          error.response?.data?.message || error.message || "Unknown error"
        }`,
      };
    }
  }
}
