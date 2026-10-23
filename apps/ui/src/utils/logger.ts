/**
 * Production-safe logging service
 *
 * Provides structured logging with the ability to disable logs in production
 * and categorize different types of log messages.
 */

type LogLevel = "debug" | "info" | "warn" | "error";
export type LogMode = "verbose" | "minimal";
export type LogCategory =
  | "editor"
  | "content"
  | "ui"
  | "api"
  | "performance"
  | "conversation_viewer"
  | "task_generation_assistant"
  | "dynamic_form"
  | "lexical_editor"
  | "general"
  | "data_collections"
  | "data_core"
  | "data_websockets"
  | "data_hooks"
  | "services_websockets";

interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: unknown;
  emoji?: string;
}

class Logger {
  private enabled: boolean;
  private logMode: LogMode = "minimal";
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 1000;

  constructor() {
    // Enable logging in development, disable in production
    this.enabled = process.env.NODE_ENV === "development";
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Set logging mode (verbose or minimal)
   */
  setLogMode(mode: LogMode): void {
    this.logMode = mode;
  }

  /**
   * Get current logging mode
   */
  getLogMode(): LogMode {
    return this.logMode;
  }

  /**
   * Clear log history
   */
  clear(): void {
    this.logHistory = [];
  }

  /**
   * Get log history
   */
  getHistory(): LogEntry[] {
    return [...this.logHistory];
  }

  /**
   * Add entry to history (always, regardless of enabled state)
   */
  private addToHistory(entry: LogEntry): void {
    this.logHistory.push(entry);

    // Keep history size manageable
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory = this.logHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Safely serialize data to string, handling Maps, Sets, and other complex objects
   */
  private serializeData(data: unknown): string {
    try {
      return JSON.stringify(
        data,
        (_key, value) => {
          // Handle Map objects
          if (value instanceof Map) {
            return Object.fromEntries(value);
          }
          // Handle Set objects
          if (value instanceof Set) {
            return Array.from(value);
          }
          // Handle Date objects
          if (value instanceof Date) {
            return value.toISOString();
          }
          // Handle Error objects
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: value.stack,
            };
          }
          // Handle functions (convert to string representation)
          if (typeof value === "function") {
            return `[Function: ${value.name || "anonymous"}]`;
          }
          // Handle BigInt
          if (typeof value === "bigint") {
            return value.toString();
          }
          // Handle Symbol
          if (typeof value === "symbol") {
            return value.toString();
          }
          return value;
        },
        2,
      );
    } catch (error) {
      // Fallback for circular references or other serialization errors
      return `[Serialization Error: ${
        error instanceof Error ? error.message : "Unknown error"
      }]`;
    }
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: unknown,
    emoji?: string,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      category,
      message,
      data,
      emoji,
    };

    // Always add to history for debugging
    this.addToHistory(entry);

    // Only output to console if enabled
    if (!this.enabled) return;

    const prefix = emoji
      ? `${emoji} [${category.toUpperCase()}]`
      : `[${category.toUpperCase()}]`;
    const formattedMessage = `${prefix} ${message}`;

    // Choose serialization method based on log mode
    const serializedData =
      data !== undefined
        ? this.logMode === "minimal"
          ? data
          : this.serializeData(data)
        : undefined;

    switch (level) {
      case "debug":
        if (serializedData !== undefined) {
          console.debug(formattedMessage, serializedData);
        } else {
          console.debug(formattedMessage);
        }
        break;
      case "info":
        if (serializedData !== undefined) {
          console.info(formattedMessage, serializedData);
        } else {
          console.info(formattedMessage);
        }
        break;
      case "warn":
        if (serializedData !== undefined) {
          console.warn(formattedMessage, serializedData);
        } else {
          console.warn(formattedMessage);
        }
        break;
      case "error":
        if (serializedData !== undefined) {
          console.error(formattedMessage, serializedData);
        } else {
          console.error(formattedMessage);
        }
        break;
    }
  }

  /**
   * Debug level logging
   */
  debug(
    category: LogCategory,
    message: string,
    data?: unknown,
    emoji?: string,
  ): void {
    this.log("debug", category, message, data, emoji);
  }

  /**
   * Info level logging
   */
  info(
    category: LogCategory,
    message: string,
    data?: unknown,
    emoji?: string,
  ): void {
    this.log("info", category, message, data, emoji);
  }

  /**
   * Warning level logging
   */
  warn(
    category: LogCategory,
    message: string,
    data?: unknown,
    emoji?: string,
  ): void {
    this.log("warn", category, message, data, emoji);
  }

  /**
   * Error level logging
   */
  error(
    category: LogCategory,
    message: string,
    data?: unknown,
    emoji?: string,
  ): void {
    this.log("error", category, message, data, emoji);
  }

  /**
   * Specialized logging methods for common use cases
   */

  // Editor-specific logging
  editorChange(message: string, data?: unknown): void {
    this.debug("editor", message, data, "🔄");
  }

  editorInit(message: string, data?: unknown): void {
    this.info("editor", message, data, "🏗️");
  }

  editorRender(message: string, data?: unknown): void {
    this.debug("editor", message, data, "🎭");
  }

  // Content-specific logging
  contentParse(message: string, data?: unknown): void {
    this.debug("content", message, data, "🔍");
  }

  contentSerialize(message: string, data?: unknown): void {
    this.debug("content", message, data, "🔄");
  }

  // UI-specific logging
  uiRender(message: string, data?: unknown): void {
    this.debug("ui", message, data, "🎭");
  }

  uiInteraction(message: string, data?: unknown): void {
    this.info("ui", message, data, "🎯");
  }

  // Performance logging
  perfStart(operation: string): void {
    this.debug("performance", `Starting: ${operation}`, undefined, "⏱️");
  }

  perfEnd(operation: string, duration?: number): void {
    const message = duration
      ? `Completed: ${operation} (${duration}ms)`
      : `Completed: ${operation}`;
    this.debug("performance", message, undefined, "✅");
  }

  // API logging
  apiRequest(message: string, data?: unknown): void {
    this.info("api", message, data, "🚀");
  }

  apiResponse(message: string, data?: unknown): void {
    this.debug("api", message, data, "📥");
  }

  apiError(message: string, data?: unknown): void {
    this.error("api", message, data, "❌");
  }
}

// Export singleton instance
export const logger = new Logger();

// Export convenience methods for common usage patterns
export const log = {
  // Editor logging
  editorChange: (message: string, data?: unknown) =>
    logger.editorChange(message, data),
  editorInit: (message: string, data?: unknown) =>
    logger.editorInit(message, data),
  editorRender: (message: string, data?: unknown) =>
    logger.editorRender(message, data),

  // Content logging
  contentParse: (message: string, data?: unknown) =>
    logger.contentParse(message, data),
  contentSerialize: (message: string, data?: unknown) =>
    logger.contentSerialize(message, data),

  // UI logging
  uiRender: (message: string, data?: unknown) => logger.uiRender(message, data),
  uiInteraction: (message: string, data?: unknown) =>
    logger.uiInteraction(message, data),

  // Performance logging
  perfStart: (operation: string) => logger.perfStart(operation),
  perfEnd: (operation: string, duration?: number) =>
    logger.perfEnd(operation, duration),

  // API logging
  apiRequest: (message: string, data?: unknown) =>
    logger.apiRequest(message, data),
  apiResponse: (message: string, data?: unknown) =>
    logger.apiResponse(message, data),
  apiError: (message: string, data?: unknown) => logger.apiError(message, data),

  // Generic logging
  debug: (category: LogCategory, message: string, data?: unknown) =>
    logger.debug(category, message, data),
  info: (category: LogCategory, message: string, data?: unknown) =>
    logger.info(category, message, data),
  warn: (category: LogCategory, message: string, data?: unknown) =>
    logger.warn(category, message, data),
  error: (category: LogCategory, message: string, data?: unknown) =>
    logger.error(category, message, data),

  // Utility methods
  setEnabled: (enabled: boolean) => logger.setEnabled(enabled),
  isEnabled: () => logger.isEnabled(),
  setLogMode: (mode: LogMode) => logger.setLogMode(mode),
  getLogMode: () => logger.getLogMode(),
  clear: () => logger.clear(),
  getHistory: () => logger.getHistory(),
};
