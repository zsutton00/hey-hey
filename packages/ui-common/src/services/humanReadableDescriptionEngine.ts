/**
 * Human-Readable Description Engine
 *
 * Generates context-aware, natural language descriptions of user actions
 * with support for Initiative workflows, business context, and smart templates
 */

import type { UserTrackingEvent } from "../types/userTracking";
import {
  isInitiativeEvent,
  isWorkflowEvent,
  isNavigationEvent,
  isFormEvent,
  isUIInteractionEvent,
  isCliTelemetryEvent,
} from "../types/userTracking";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

// Enhanced template system with conditional logic and context awareness
interface SmartTemplate {
  template: string;
  conditions?: {
    field: string;
    operator: "equals" | "contains" | "exists" | "greaterThan" | "lessThan";
    value?: unknown;
  }[];
  priority?: number; // Higher priority templates are preferred
  context?: ("initiative" | "workflow" | "organization" | "project")[];
}

// Smart templates with business context and conditional logic
const SMART_TEMPLATES: Record<string, SmartTemplate[]> = {
  // Initiative-specific templates
  "initiative:create": [
    {
      template:
        'User created high-priority initiative "{initiativeName}" to address urgent business needs',
      conditions: [
        { field: "data.priority", operator: "equals", value: "HIGH" },
      ],
      priority: 10,
      context: ["initiative", "organization"],
    },
    {
      template:
        'User created new initiative "{initiativeName}" in {organizationName} with {priority} priority',
      conditions: [{ field: "context.organization", operator: "exists" }],
      priority: 8,
      context: ["initiative", "organization"],
    },
    {
      template: 'User created new initiative "{initiativeName}"',
      priority: 5,
    },
  ],

  "initiative:add_requirement": [
    {
      template:
        'User added critical acceptance criteria to initiative "{initiativeName}": "{requirementText}"',
      conditions: [
        {
          field: "data.requirement.type",
          operator: "equals",
          value: "acceptanceCriteria",
        },
        { field: "data.requirement.text", operator: "contains", value: "must" },
      ],
      priority: 10,
      context: ["initiative"],
    },
    {
      template:
        'User refined initiative "{initiativeName}" by adding {requirementType}: "{requirementText}"',
      conditions: [{ field: "data.requirement.type", operator: "exists" }],
      priority: 8,
      context: ["initiative"],
    },
    {
      template:
        'User added requirement to initiative "{initiativeName}": "{requirementText}"',
      priority: 5,
    },
  ],

  "initiative:change_status": [
    {
      template:
        'User moved initiative "{initiativeName}" from refinement to execution phase',
      conditions: [
        {
          field: "data.previousValue",
          operator: "equals",
          value: "REFINING_ACCEPTANCE_CRITERIA",
        },
        { field: "data.newValue", operator: "equals", value: "ACTIVE" },
      ],
      priority: 10,
      context: ["initiative"],
    },
    {
      template:
        'User completed initiative "{initiativeName}" - moving to delivery',
      conditions: [
        { field: "data.newValue", operator: "equals", value: "COMPLETED" },
      ],
      priority: 9,
      context: ["initiative"],
    },
    {
      template:
        'User changed initiative "{initiativeName}" status from {previousValue} to {newValue}',
      priority: 5,
    },
  ],

  "initiative:link_project": [
    {
      template:
        'User connected development project "{projectName}" to strategic initiative "{initiativeName}"',
      conditions: [
        { field: "data.project.name", operator: "contains", value: "dev" },
      ],
      priority: 8,
      context: ["initiative", "project"],
    },
    {
      template:
        'User linked project "{projectName}" to initiative "{initiativeName}" for coordinated execution',
      priority: 6,
      context: ["initiative", "project"],
    },
  ],

  "initiative:start_conversation": [
    {
      template:
        'User initiated extensive discussion about initiative "{initiativeName}" ({messageCount} messages exchanged)',
      conditions: [
        {
          field: "data.conversation.messageCount",
          operator: "greaterThan",
          value: 10,
        },
      ],
      priority: 8,
      context: ["initiative"],
    },
    {
      template:
        'User started conversation about initiative "{initiativeName}" to clarify requirements',
      priority: 6,
    },
  ],

  // Workflow templates
  "workflow:execute": [
    {
      template:
        'User executed complex workflow "{workflowName}" starting from decision node "{nodeName}"',
      conditions: [
        { field: "data.nodeName", operator: "contains", value: "decision" },
      ],
      priority: 8,
      context: ["workflow"],
    },
    {
      template: 'User ran workflow "{workflowName}" from {nodeName} node',
      priority: 5,
    },
  ],

  "workflow:simulate": [
    {
      template:
        'User performed comprehensive simulation of workflow "{workflowName}" through {simulationStep} steps',
      conditions: [
        { field: "data.simulationStep", operator: "greaterThan", value: 5 },
      ],
      priority: 8,
      context: ["workflow"],
    },
    {
      template: 'User simulated workflow "{workflowName}" execution',
      priority: 5,
    },
  ],

  // Navigation templates
  "navigation:page_view": [
    {
      template:
        "User navigated to {toPage} initiative workspace from {fromPage}",
      conditions: [
        { field: "data.toPage", operator: "contains", value: "initiative" },
      ],
      priority: 8,
      context: ["initiative"],
    },
    {
      template: "User moved from {fromPage} to {toPage} section",
      conditions: [{ field: "data.fromPage", operator: "exists" }],
      priority: 6,
    },
    {
      template: "User accessed {toPage}",
      priority: 5,
    },
  ],

  // Form templates
  "form:submit_success": [
    {
      template:
        "User successfully completed {formName} form with excellent completion rate ({completionRate}%)",
      conditions: [
        { field: "data.completionRate", operator: "greaterThan", value: 90 },
      ],
      priority: 8,
    },
    {
      template: "User submitted {formName} form ({completionRate}% complete)",
      conditions: [{ field: "data.completionRate", operator: "exists" }],
      priority: 6,
    },
    {
      template: "User successfully submitted {formName}",
      priority: 5,
    },
  ],

  // UI interaction templates
  "ui_interaction:search": [
    {
      template:
        'User performed targeted search for "{searchQuery}" in initiatives (found {resultCount} matches)',
      conditions: [
        { field: "data.searchQuery", operator: "exists" },
        {
          field: "context.page.name",
          operator: "equals",
          value: "initiatives",
        },
      ],
      priority: 8,
      context: ["initiative"],
    },
    {
      template:
        'User searched for "{searchQuery}" and found {resultCount} results',
      conditions: [{ field: "data.searchQuery", operator: "exists" }],
      priority: 6,
    },
    {
      template: "User performed search operation",
      priority: 3,
    },
  ],

  "ui_interaction:filter": [
    {
      template:
        "User applied sophisticated filters to narrow down initiatives by {filterCriteria}",
      conditions: [
        {
          field: "context.page.name",
          operator: "equals",
          value: "initiatives",
        },
      ],
      priority: 8,
      context: ["initiative"],
    },
    {
      template: "User filtered results using criteria: {filterCriteria}",
      priority: 6,
    },
  ],

  // CLI telemetry templates
  "cli_telemetry:agent_session_created": [
    {
      template:
        "CLI created coding session {sessionId} with {status} status in {latencyMs}ms",
      priority: 8,
    },
  ],
  "cli_telemetry:implementation_hint_written": [
    {
      template:
        "CLI wrote implementation hint {hintId} for session {sessionId} with {status} status in {latencyMs}ms",
      priority: 8,
    },
  ],
  "cli_telemetry:final_recommendation_stored": [
    {
      template:
        "CLI stored final recommendation {recommendationId} for session {sessionId} with {status} status in {latencyMs}ms",
      priority: 8,
    },
  ],
  "cli_telemetry:agent_invocation": [
    {
      template:
        "CLI completed agent invocation {invocationId} for session {sessionId} with {status} status in {latencyMs}ms",
      priority: 8,
    },
  ],
};

// Context extractors for template variables
interface ContextExtractors {
  [key: string]: (event: UserTrackingEvent) => string | number | undefined;
}

const CONTEXT_EXTRACTORS: ContextExtractors = {
  // Basic event data
  initiativeName: (event) =>
    isInitiativeEvent(event) ? event.data.initiativeName : undefined,
  initiativeId: (event) =>
    isInitiativeEvent(event) ? event.data.initiativeId : undefined,
  workflowName: (event) =>
    isWorkflowEvent(event) ? event.data.workflowName : undefined,
  projectName: (event) =>
    isInitiativeEvent(event) ? event.data.project?.name : undefined,
  requirementText: (event) =>
    isInitiativeEvent(event)
      ? event.data.requirement?.text?.substring(0, 50) + "..."
      : undefined,
  requirementType: (event) =>
    isInitiativeEvent(event) ? "requirement" : undefined,
  previousValue: (event) =>
    isInitiativeEvent(event)
      ? String(event.data.previousValue || "unknown")
      : undefined,
  newValue: (event) =>
    isInitiativeEvent(event)
      ? String(event.data.newValue || "unknown")
      : undefined,
  messageCount: (event) =>
    isInitiativeEvent(event)
      ? event.data.conversation?.messageCount
      : undefined,
  nodeName: (event) =>
    isWorkflowEvent(event) ? event.data.nodeName : undefined,
  simulationStep: (event) =>
    isWorkflowEvent(event) ? event.data.simulationStep : undefined,

  // Navigation data
  fromPage: (event) =>
    isNavigationEvent(event) ? event.data.fromPage : undefined,
  toPage: (event) => (isNavigationEvent(event) ? event.data.toPage : undefined),

  // Form data
  formName: (event) => (isFormEvent(event) ? event.data.formName : undefined),
  completionRate: (event) =>
    isFormEvent(event) ? event.data.completionRate : undefined,

  // UI interaction data
  searchQuery: (event) =>
    isUIInteractionEvent(event) ? event.data.searchQuery : undefined,
  resultCount: (event) =>
    isUIInteractionEvent(event) ? event.data.resultCount : undefined,
  filterCriteria: (event) =>
    isUIInteractionEvent(event)
      ? JSON.stringify(event.data.filterCriteria)
      : undefined,

  // CLI telemetry data
  sessionId: (event) =>
    isCliTelemetryEvent(event) ? String(event.data.sessionId) : undefined,
  promptId: (event) =>
    isCliTelemetryEvent(event) && "promptId" in event.data
      ? String(event.data.promptId)
      : undefined,
  hintId: (event) =>
    isCliTelemetryEvent(event) && "hintId" in event.data
      ? String(event.data.hintId)
      : undefined,
  recommendationId: (event) =>
    isCliTelemetryEvent(event) && "recommendationId" in event.data
      ? String(event.data.recommendationId)
      : undefined,
  invocationId: (event) =>
    isCliTelemetryEvent(event) && "invocationId" in event.data
      ? String(event.data.invocationId)
      : undefined,
  status: (event) =>
    isCliTelemetryEvent(event) ? event.data.status : undefined,
  latencyMs: (event) =>
    isCliTelemetryEvent(event) ? event.data.latencyMs : undefined,

  // Context data
  organizationName: (event) => event.context.organization?.name,
  projectContextName: (event) => event.context.project?.name,
  priority: (event) =>
    isInitiativeEvent(event)
      ? String(event.context.initiative?.priority || "normal")
      : undefined,

  // Computed values
  timeOfDay: (event) => {
    const hour = new Date(event.timestamp).getHours();
    if (hour < 12) return "morning";
    if (hour < 17) return "afternoon";
    return "evening";
  },
  dayOfWeek: (event) => {
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return days[new Date(event.timestamp).getDay()];
  },
};

// Main description engine class
export class HumanReadableDescriptionEngine {
  /**
   * Generate context-aware human-readable description for any event
   */
  static generateDescription(event: UserTrackingEvent): string {
    const eventKey = `${event.category}:${event.action}`;
    const templates = SMART_TEMPLATES[eventKey] || [];

    // Find the best matching template based on conditions and priority
    const bestTemplate = this.findBestTemplate(event, templates);

    if (bestTemplate) {
      return this.populateTemplate(bestTemplate.template, event);
    }

    // Fallback to basic description
    return this.generateFallbackDescription(event);
  }

  /**
   * Generate a summary of multiple events with pattern recognition
   */
  static generateEventSummary(events: UserTrackingEvent[]): string {
    if (events.length === 0) return "No activity recorded";
    if (events.length === 1) return this.generateDescription(events[0]);

    const patterns = this.detectPatterns(events);
    return this.generatePatternSummary(patterns, events);
  }

  /**
   * Generate activity timeline with context awareness
   */
  static generateActivityTimeline(
    events: UserTrackingEvent[],
    timeWindow: "hour" | "day" | "week" = "day"
  ): string[] {
    const sortedEvents = events.sort((a, b) => a.timestamp - b.timestamp);
    const timeline: string[] = [];

    let currentTimeGroup = "";

    sortedEvents.forEach((event) => {
      const timeGroup = this.getTimeGroup(event.timestamp, timeWindow);

      if (timeGroup !== currentTimeGroup) {
        timeline.push(`\n--- ${timeGroup} ---`);
        currentTimeGroup = timeGroup;
      }

      const description = this.generateDescription(event);
      const timeStamp = new Date(event.timestamp).toLocaleTimeString();
      timeline.push(`${timeStamp}: ${description}`);
    });

    return timeline;
  }

  // Private helper methods

  private static findBestTemplate(
    event: UserTrackingEvent,
    templates: SmartTemplate[]
  ): SmartTemplate | null {
    const matchingTemplates = templates.filter((template) =>
      this.templateMatches(event, template)
    );

    if (matchingTemplates.length === 0) return null;

    // Sort by priority (higher first)
    return matchingTemplates.sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    )[0];
  }

  private static templateMatches(
    event: UserTrackingEvent,
    template: SmartTemplate
  ): boolean {
    if (!template.conditions) return true;

    return template.conditions.every((condition) => {
      const value = this.extractValue(event, condition.field);

      switch (condition.operator) {
        case "equals":
          return value === condition.value;
        case "contains":
          return String(value)
            .toLowerCase()
            .includes(String(condition.value).toLowerCase());
        case "exists":
          return value !== undefined && value !== null;
        case "greaterThan":
          return Number(value) > Number(condition.value);
        case "lessThan":
          return Number(value) < Number(condition.value);
        default:
          return false;
      }
    });
  }

  private static extractValue(
    event: UserTrackingEvent,
    fieldPath: string
  ): unknown {
    const parts = fieldPath.split(".");
    let value: unknown = event;

    for (const part of parts) {
      if (isRecord(value) && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private static populateTemplate(
    template: string,
    event: UserTrackingEvent
  ): string {
    let result = template;

    // Replace all variables in the template
    const variableRegex = /\{([^}]+)\}/g;
    result = result.replace(variableRegex, (match, variableName) => {
      const extractor = CONTEXT_EXTRACTORS[variableName];
      if (extractor) {
        const value = extractor(event);
        return String(value || "unknown");
      }
      return match; // Keep original if no extractor found
    });

    return result;
  }

  private static generateFallbackDescription(event: UserTrackingEvent): string {
    const article = this.getArticle(event.action);
    const actionText = event.action.replace(/_/g, " ");

    if (isInitiativeEvent(event)) {
      return `User ${actionText} ${article} initiative "${event.data.initiativeName}"`;
    }

    if (isWorkflowEvent(event)) {
      return `User ${actionText} ${article} workflow "${event.data.workflowName}"`;
    }

    if (isNavigationEvent(event)) {
      return `User navigated to ${event.data.toPage}`;
    }

    if (isFormEvent(event)) {
      return `User ${actionText} ${event.data.formName} form`;
    }

    if (isUIInteractionEvent(event)) {
      return `User performed ${actionText} on ${event.data.elementType}`;
    }

    if (isCliTelemetryEvent(event)) {
      return `CLI telemetry ${actionText} for session ${event.data.sessionId}`;
    }

    return `User performed ${actionText} in ${event.category}`;
  }

  private static getArticle(action: string): string {
    const vowels = ["a", "e", "i", "o", "u"];
    return vowels.includes(action[0]) ? "an" : "a";
  }

  private static detectPatterns(
    events: UserTrackingEvent[]
  ): Array<{ type: string; count: number; events: UserTrackingEvent[] }> {
    const patterns = new Map<string, UserTrackingEvent[]>();

    events.forEach((event) => {
      const patternKey = `${event.category}:${event.action}`;
      if (!patterns.has(patternKey)) {
        patterns.set(patternKey, []);
      }
      patterns.get(patternKey)!.push(event);
    });

    return Array.from(patterns.entries())
      .map(([type, events]) => ({ type, count: events.length, events }))
      .sort((a, b) => b.count - a.count);
  }

  private static generatePatternSummary(
    patterns: Array<{
      type: string;
      count: number;
      events: UserTrackingEvent[];
    }>,
    allEvents: UserTrackingEvent[]
  ): string {
    const totalEvents = allEvents.length;
    const timeSpan = this.getTimeSpan(allEvents);

    let summary = `User activity summary (${totalEvents} actions over ${timeSpan}):\n`;

    patterns.slice(0, 3).forEach((pattern) => {
      const percentage = Math.round((pattern.count / totalEvents) * 100);
      const actionName = pattern.type.replace(/[_:]/g, " ");
      summary += `• ${percentage}% ${actionName} (${pattern.count} times)\n`;
    });

    // Add context-specific insights
    const initiativeEvents = allEvents.filter(isInitiativeEvent);
    if (initiativeEvents.length > 0) {
      const uniqueInitiatives = new Set(
        initiativeEvents.map((e) => e.data.initiativeName)
      );
      summary += `• Worked on ${uniqueInitiatives.size} initiative(s)\n`;
    }

    return summary.trim();
  }

  private static getTimeSpan(events: UserTrackingEvent[]): string {
    if (events.length === 0) return "0 minutes";

    const timestamps = events.map((e) => e.timestamp).sort((a, b) => a - b);
    const spanMs = timestamps[timestamps.length - 1] - timestamps[0];
    const spanMinutes = Math.round(spanMs / (1000 * 60));

    if (spanMinutes < 60) return `${spanMinutes} minutes`;
    if (spanMinutes < 1440) return `${Math.round(spanMinutes / 60)} hours`;
    return `${Math.round(spanMinutes / 1440)} days`;
  }

  private static getTimeGroup(
    timestamp: number,
    window: "hour" | "day" | "week"
  ): string {
    const date = new Date(timestamp);

    switch (window) {
      case "hour":
        return date.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          hour12: true,
        });
      case "day":
        return date.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
      case "week": {
        const startOfWeek = new Date(date);
        startOfWeek.setDate(date.getDate() - date.getDay());
        return `Week of ${startOfWeek.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}`;
      }
      default:
        return date.toLocaleDateString();
    }
  }
}

// Export convenience functions
export const generateDescription =
  HumanReadableDescriptionEngine.generateDescription;
export const generateEventSummary =
  HumanReadableDescriptionEngine.generateEventSummary;
export const generateActivityTimeline =
  HumanReadableDescriptionEngine.generateActivityTimeline;

export default HumanReadableDescriptionEngine;
