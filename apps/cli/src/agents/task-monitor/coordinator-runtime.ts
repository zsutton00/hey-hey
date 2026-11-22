import type {
  ImplementRuntimeSelection,
  TaskMonitorRuntimeSelection,
} from '@hey-hey/contracts/api/models';
import type { TaskMonitorReviewRuntime } from './state-machine/context';
import {
  listEfforts,
  listModels,
  supportsFastMode,
} from '../../shared/runtime/components/AgentSession/capabilityCatalog';

/**
 * Why a monitor's saved coordinator runtime is not valid in this machine's runtime catalog, or
 * null when it is valid. A model the catalog no longer lists is rejected so the choice is
 * surfaced before launch instead of reaching the provider.
 */
export const coordinatorRuntimeCatalogIssue = (
  runtime: TaskMonitorRuntimeSelection,
): string | null => monitorRuntimeCatalogIssue(runtime, 'Monitor runs on');

/**
 * Why a monitor's saved Review runtime is not valid in this machine's runtime catalog, or null
 * when it is valid. Checked before a Review request is sent, so a stale choice never reaches a
 * provider.
 */
export const reviewRuntimeCatalogIssue = (runtime: TaskMonitorReviewRuntime): string | null =>
  monitorRuntimeCatalogIssue(runtime, 'Review runs on');

/** The per-Turn runtime a saved Review runtime selects for the Review sub-agent. */
export const reviewTurnRuntime = (runtime: TaskMonitorReviewRuntime): ImplementRuntimeSelection =>
  ({
    provider: runtime.provider,
    model: runtime.model,
    ...(runtime.reasoningEffort === undefined ? {} : { reasoningEffort: runtime.reasoningEffort }),
    ...(runtime.fastMode === undefined ? {} : { fastMode: runtime.fastMode }),
  }) satisfies ImplementRuntimeSelection;

const monitorRuntimeCatalogIssue = (
  runtime: TaskMonitorReviewRuntime,
  label: string,
): string | null => {
  const models = listModels(runtime.provider);
  if (!models.some((model) => model.id === runtime.model)) {
    return `${label}: ${runtime.provider} ${runtime.model} is not available on this machine. Choose another model.`;
  }

  const efforts = listEfforts(runtime.provider, runtime.model);
  const effortIsValid =
    runtime.reasoningEffort === undefined
      ? efforts.length === 0
      : efforts.includes(runtime.reasoningEffort);
  if (!effortIsValid) {
    return `${label}: effort "${runtime.reasoningEffort ?? 'none'}" is not supported by ${runtime.provider} ${runtime.model}. Supported efforts: ${efforts.join(', ') || 'none'}.`;
  }

  if (runtime.fastMode === true && !supportsFastMode(runtime.provider, runtime.model)) {
    return `${label}: Fast mode is not supported by ${runtime.provider} ${runtime.model}. Turn Fast mode off or choose a model that supports it.`;
  }

  return null;
};
