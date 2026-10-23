import { AgentAdapterRegistry, type AgentAdapter } from "../core";
import {
  ClaudeCodeAdapter,
  type ClaudeCodeAdapterConfig,
} from "./ClaudeCodeAdapter";
import { CodexAdapter, type CodexAdapterConfig } from "./CodexAdapter";

export const BUILTIN_NODE_ADAPTER_IDS = ["claude", "codex"] as const;

export type BuiltinNodeAdapterId = (typeof BUILTIN_NODE_ADAPTER_IDS)[number];

export interface NodeAdapterFactoryOptions {
  claude?: ClaudeCodeAdapterConfig;
  codex?: CodexAdapterConfig;
}

export const createNodeAdapterRegistry = (
  options: NodeAdapterFactoryOptions = {}
): AgentAdapterRegistry => {
  const registry = new AgentAdapterRegistry();
  registry.register("claude", () => new ClaudeCodeAdapter(options.claude));
  registry.register("codex", () => new CodexAdapter(options.codex));
  return registry;
};

export const createNodeAdapter = (
  adapterId: BuiltinNodeAdapterId,
  options: NodeAdapterFactoryOptions = {}
): AgentAdapter => createNodeAdapterRegistry(options).create(adapterId);
