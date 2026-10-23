import type { LocalOpenItemsTriageResponse } from '../../shared/agent-bridge-contract/generated';
import type { OpenItemsTriagePayload } from '../../shared/api/generated/api';

export const mapTriageResponse = (response: LocalOpenItemsTriageResponse): OpenItemsTriagePayload =>
  ({
    summary: response.summary,
    suggestions: response.suggestions.map((suggestion) => ({
      ...suggestion,
      evidence: suggestion.evidence.map((evidence) => ({ ...evidence })),
    })),
  }) satisfies OpenItemsTriagePayload;
