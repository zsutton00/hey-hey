/**
 * Agent integration entrypoint.
 *
 * Typical node usage:
 *
 * ```ts
 * import { NodeAgentClient, toAgentSessionId } from "ui-common/agents";
 *
 * const client = new NodeAgentClient({
 *   adapterId: "claude",
 *   initOptions: { cwd: process.cwd() },
 * });
 *
 * const { stream, sessionIdPromise } = await client.runWithSession(
 *   "Draft a migration plan."
 * );
 * for await (const message of stream) {
 *   // Consume normalized agent messages.
 * }
 * const sessionId = await sessionIdPromise;
 *
 * if (sessionId) {
 *   const resumed = await client.resume(sessionId, "Continue from last step.");
 *   for await (const message of resumed) {
 *     // Continue consuming normalized messages.
 *   }
 * }
 * ```
 */
export * from "./core";
export * from "./coordination";
export * from "./credentials";
export * from "./node";
export * from "./session";
export * from "./tool-execution-hooks";
