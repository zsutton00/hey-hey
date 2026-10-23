import type {
  AnyResponseActionPluginDefinition,
  ResponseActionEvent,
  ResponseActionExecutionSummary,
} from "./types.js";

export interface ResponseActionRegistry {
  execute(event: ResponseActionEvent): Promise<ResponseActionExecutionSummary>;
}

type ResponseActionRegistryLogLevel = "info" | "warn" | "error";

type ResponseActionRegistryLogEvent =
  | "dispatch_started"
  | "dispatch_completed"
  | "no_plugins_registered"
  | "plugin_started"
  | "plugin_succeeded"
  | "plugin_failed"
  | "plugin_threw";

interface ResponseActionRegistryLogEntry {
  level: ResponseActionRegistryLogLevel;
  event: ResponseActionRegistryLogEvent;
  eventType: ResponseActionEvent["eventType"];
  pluginId?: string;
  details?: Record<string, unknown>;
}

interface ResponseActionRegistryDependencies {
  log: (entry: ResponseActionRegistryLogEntry) => void;
}

const defaultDependencies: ResponseActionRegistryDependencies = {
  log: (entry) => {
    const logFn =
      entry.level === "error"
        ? console.error
        : entry.level === "warn"
        ? console.warn
        : console.info;
    logFn("[response-actions]", entry);
  },
};

const toUnknownErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unexpected response action failure.";

export const createResponseActionRegistry = (
  plugins: readonly AnyResponseActionPluginDefinition[],
  dependencies: ResponseActionRegistryDependencies = defaultDependencies
): ResponseActionRegistry => {
  return {
    async execute(
      event: ResponseActionEvent
    ): Promise<ResponseActionExecutionSummary> {
      const matchingPlugins = plugins.filter(
        (plugin) => plugin.eventType === event.eventType
      );
      const summary: ResponseActionExecutionSummary = {
        eventType: event.eventType,
        totalPlugins: matchingPlugins.length,
        successful: [],
        failed: [],
      };

      dependencies.log({
        level: "info",
        event: "dispatch_started",
        eventType: event.eventType,
        details: {
          totalPlugins: matchingPlugins.length,
        },
      });

      if (matchingPlugins.length === 0) {
        dependencies.log({
          level: "warn",
          event: "no_plugins_registered",
          eventType: event.eventType,
        });
      }

      for (const plugin of matchingPlugins) {
        dependencies.log({
          level: "info",
          event: "plugin_started",
          eventType: event.eventType,
          pluginId: plugin.pluginId,
        });

        try {
          const result = await (() => {
            if (event.eventType === plugin.eventType) {
              return plugin.run(event);
            }
            throw new Error(
              `Response action registry event mismatch: ${event.eventType} vs ${plugin.eventType}`
            );
          })();
          if (result.ok) {
            summary.successful.push({
              pluginId: plugin.pluginId,
              ...(result.message ? { message: result.message } : {}),
              ...(result.metrics ? { metrics: result.metrics } : {}),
            });
            dependencies.log({
              level: "info",
              event: "plugin_succeeded",
              eventType: event.eventType,
              pluginId: plugin.pluginId,
              details: {
                ...(result.message ? { message: result.message } : {}),
                ...(result.metrics ? { metrics: result.metrics } : {}),
              },
            });
            continue;
          }

          summary.failed.push({
            pluginId: plugin.pluginId,
            error: result.error,
            retryable: result.retryable,
          });
          dependencies.log({
            level: "warn",
            event: "plugin_failed",
            eventType: event.eventType,
            pluginId: plugin.pluginId,
            details: {
              error: result.error,
              retryable: result.retryable,
            },
          });
        } catch (error) {
          const message = toUnknownErrorMessage(error);
          summary.failed.push({
            pluginId: plugin.pluginId,
            error: message,
            retryable: true,
          });
          dependencies.log({
            level: "error",
            event: "plugin_threw",
            eventType: event.eventType,
            pluginId: plugin.pluginId,
            details: {
              error: message,
            },
          });
        }
      }

      dependencies.log({
        level: "info",
        event: "dispatch_completed",
        eventType: event.eventType,
        details: {
          totalPlugins: matchingPlugins.length,
          successCount: summary.successful.length,
          failureCount: summary.failed.length,
        },
      });

      return summary;
    },
  };
};
