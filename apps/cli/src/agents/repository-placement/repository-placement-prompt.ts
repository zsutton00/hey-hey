import type { RepositoryPlacementPromptPayload } from './types';

export const buildRepositoryPlacementPrompt = (payload: RepositoryPlacementPromptPayload): string =>
  [
    '# Existing-project imported root placement',
    '',
    'Suggest one parent for every proposed root. Treat the proposed hierarchy and every existing Feature as immutable.',
    'Use only unified_search and get_context to discover the current project Feature graph. Search narrowly, then orient only on promising Features. Do not enumerate or preload the whole graph.',
    'A target may be PROJECT_ROOT or an active existing FEATURE in this project. Never target a proposed child, non-Feature entity, archived entity, or pending proposal.',
    'Do not create, edit, link, re-parent, or otherwise mutate project entities. These are suggestions for editable review.',
    '',
    `Project: ${payload.projectId}`,
    'Immutable candidates:',
    '```json',
    JSON.stringify(payload.candidates, null, 2),
    '```',
    'Root-only instructions:',
    '```json',
    JSON.stringify(payload.instructions, null, 2),
    '```',
    '',
    'Return exactly one JSON object and no prose. Success shape:',
    '```json',
    JSON.stringify(
      {
        outcome: 'success',
        placements: payload.candidates.map((root) => ({
          rootKey: root.rootKey,
          target: { kind: 'PROJECT_ROOT' },
          rationale: 'Why this parent best preserves the product capability hierarchy.',
          confidence: 0.8,
        })),
      },
      null,
      2,
    ),
    '```',
    'Every rootKey must appear exactly once. Never return a childKey. For an existing Feature target use {"kind":"EXISTING_FEATURE","featureId":"<uuid>"}.',
    'Retryable failure codes: provider_unavailable, provider_timeout, rate_limited, graph_unavailable.',
    'Terminal failure codes: invalid_request, unsupported_provider, unsupported_model, access_denied, invalid_completion.',
  ].join('\n');
