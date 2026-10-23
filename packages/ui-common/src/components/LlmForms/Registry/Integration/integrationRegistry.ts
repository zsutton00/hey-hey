import React from "react";
import GitHubIcon from "@mui/icons-material/GitHub";
import JiraIcon from "@mui/icons-material/BugReport";
import type { AvailableIntegration } from "./types";

export const AVAILABLE_INTEGRATIONS: AvailableIntegration[] = [
  {
    type: "github",
    name: "GitHub",
    description:
      "Connect your GitHub repositories for issue tracking and code management. Uses advanced API-driven configuration.",
    icon: React.createElement(GitHubIcon),
    configFields: [
      {
        key: "accessToken",
        label: "Personal Access Token",
        type: "password",
        required: true,
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        description:
          "Generate a personal access token from GitHub Settings > Developer settings",
      },
      {
        key: "organization",
        label: "Organization/Username",
        type: "text",
        required: true,
        placeholder: "your-org-name",
        description: "GitHub organization or username to access repositories",
      },
      {
        key: "repositories",
        label: "Repositories (comma-separated)",
        type: "text",
        required: false,
        placeholder: "repo1, repo2, repo3",
        description:
          "Specific repositories to monitor. Leave empty to access all repositories",
      },
    ],
    // Mark this as API-driven for enhanced handling
    isApiDriven: true,
  },
  {
    type: "jira",
    name: "Jira",
    description: "Connect your Jira instance for project and issue tracking",
    icon: React.createElement(JiraIcon),
    configFields: [
      {
        key: "serverUrl",
        label: "Jira Server URL",
        type: "text",
        required: true,
        placeholder: "https://your-company.atlassian.net",
        description: "The URL of your Jira Cloud instance.",
      },
      {
        key: "email",
        label: "Jira Email Address",
        type: "text",
        required: true,
        placeholder: "your-email@example.com",
        description: "The email address associated with your Jira account.",
      },
      {
        key: "apiToken",
        label: "API Token",
        type: "password",
        required: true,
        placeholder: "your-api-token",
        description:
          "Create an API token from your Atlassian account settings.",
      },
      {
        key: "projectKeys",
        label: "Project Keys (comma-separated)",
        type: "text",
        required: false,
        placeholder: "PROJ, ANOTHERPROJ",
        description:
          "Specific project keys to monitor. Leave empty to access all projects.",
      },
    ],
  },
];
