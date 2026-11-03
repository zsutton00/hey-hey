import type { LocalOpenItemsTriageResponse } from '@hey-hey/contracts/agent-bridge';
import type { OpenItemsTriagePayload } from '@hey-hey/contracts/api/models';

export const mapTriageResponse = (response: LocalOpenItemsTriageResponse): OpenItemsTriagePayload =>
  ({
    summary: response.summary,
    suggestions: response.suggestions.map((suggestion) => ({
      ...suggestion,
      evidence: suggestion.evidence.map((evidence) => ({ ...evidence })),
    })),
  }) satisfies OpenItemsTriagePayload;
