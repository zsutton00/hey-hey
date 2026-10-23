import type { StartupPlanSubmission } from "../types";

export const RESPONSE_ACTION_EVENT_TYPE = {
  startupPlanReplied: "startup_plan_v1.onReplied",
} as const;

export type ResponseActionEventType =
  (typeof RESPONSE_ACTION_EVENT_TYPE)[keyof typeof RESPONSE_ACTION_EVENT_TYPE];

export interface StartupPlanRepliedEvent {
  eventType: typeof RESPONSE_ACTION_EVENT_TYPE.startupPlanReplied;
  organizationId: string;
  serviceId: string;
  agentSessionId: string;
  submission: StartupPlanSubmission;
  // The replied-to run is identified by id only — runId === agentSession.id.
  // Plugins that need run state fetch it out-of-band; the event no longer
  // embeds full CodingRun snapshots.
  runId: string;
}

export type ResponseActionEvent = StartupPlanRepliedEvent;

export interface ResponseActionPluginSuccess {
  ok: true;
  message?: string;
  metrics?: Record<string, number>;
}

export interface ResponseActionPluginFailure {
  ok: false;
  error: string;
  retryable: boolean;
}

export type ResponseActionPluginResult =
  | ResponseActionPluginSuccess
  | ResponseActionPluginFailure;

type ResponseActionEventByType = {
  [RESPONSE_ACTION_EVENT_TYPE.startupPlanReplied]: StartupPlanRepliedEvent;
};

export type ResponseActionPluginDefinition<
  TEventType extends ResponseActionEventType
> = {
  pluginId: string;
  eventType: TEventType;
  run: (
    event: ResponseActionEventByType[TEventType]
  ) => Promise<ResponseActionPluginResult>;
};

export type AnyResponseActionPluginDefinition = {
  [TEventType in ResponseActionEventType]: ResponseActionPluginDefinition<TEventType>;
}[ResponseActionEventType];

export interface ResponseActionExecutionFailure {
  pluginId: string;
  error: string;
  retryable: boolean;
}

export interface ResponseActionExecutionSuccess {
  pluginId: string;
  message?: string;
  metrics?: Record<string, number>;
}

export interface ResponseActionExecutionSummary {
  eventType: ResponseActionEventType;
  totalPlugins: number;
  successful: ResponseActionExecutionSuccess[];
  failed: ResponseActionExecutionFailure[];
}
