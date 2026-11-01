import { LocalPromptType } from 'src/generated/local';
import { REPOSITORY_IMPORT_NODES, SHARED_NODES } from '../constants';
import { createFlow } from './utils';

export const repositoryImportFlow = createFlow({
  id: 'repository-import',
  name: 'Repository Import',
  description:
    'Analyze an existing repository and import a reviewable Feature hierarchy',
  version: 1,
  startNode: REPOSITORY_IMPORT_NODES.PREREQUISITES,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [REPOSITORY_IMPORT_NODES.PREREQUISITES]: {
      nextNode: REPOSITORY_IMPORT_NODES.CONFIGURATION,
    },
    [REPOSITORY_IMPORT_NODES.CONFIGURATION]: {
      nextNode: REPOSITORY_IMPORT_NODES.START,
    },
    [REPOSITORY_IMPORT_NODES.START]: {
      nextNode: REPOSITORY_IMPORT_NODES.ANALYSIS,
    },
    [REPOSITORY_IMPORT_NODES.ANALYSIS]: {
      transitions: {
        success: {
          description: 'Review the initial Feature outline.',
          nextNodeId: REPOSITORY_IMPORT_NODES.GENERATE_FEATURES,
        },
        retryable_failure: {
          description: 'Retain accepted choices and recover.',
          nextNodeId: REPOSITORY_IMPORT_NODES.RECOVERY,
        },
        terminal_failure: {
          description: 'Expose the typed failure for recovery.',
          nextNodeId: REPOSITORY_IMPORT_NODES.RECOVERY,
        },
        default: {
          description: 'Reject unknown completions through recovery.',
          nextNodeId: REPOSITORY_IMPORT_NODES.RECOVERY,
        },
      },
    },
    [REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE]: {
      transitions: {
        default: {
          description: 'Wait for an explicit enrichment choice.',
          nextNodeId: REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE,
        },
        ENRICH: {
          description: 'Enrich the reviewed outline.',
          nextNodeId: REPOSITORY_IMPORT_NODES.ENRICHMENT,
        },
        SKIP: {
          description: 'Continue with the reviewed outline.',
          nextNodeId: REPOSITORY_IMPORT_NODES.END,
        },
      },
    },
    // A one-shot handoff completes the workflow. Further replies belong to the CLI.
    [REPOSITORY_IMPORT_NODES.ENRICHMENT]: {},
    [REPOSITORY_IMPORT_NODES.RECOVERY]: {
      nextNode: REPOSITORY_IMPORT_NODES.START,
    },
    [REPOSITORY_IMPORT_NODES.GENERATE_FEATURES]: {
      nextNode: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
    },
    // Persisted pre-cutover imports can be parked on the former shared id.
    [SHARED_NODES.GENERATE_FEATURES]: {
      nextNode: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
    },
    [REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY]: {
      transitions: {
        review: {
          description: 'The approved deterministic placement completes import.',
          nextNodeId: REPOSITORY_IMPORT_NODES.FINALIZE,
        },
        intelligent: {
          description: 'Request typed intelligent placement.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_AGENT,
        },
        default: {
          description: 'Wait for a valid placement strategy.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
      },
    },
    [REPOSITORY_IMPORT_NODES.PLACEMENT_AGENT]: {
      transitions: {
        success: {
          description: 'Review complete intelligent suggestions.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_REVIEW,
        },
        retryable_failure: {
          description: 'Retry from placement strategy.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
        terminal_failure: {
          description: 'Choose another placement strategy.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
        default: {
          description: 'Reject an unknown placement outcome.',
          nextNodeId: REPOSITORY_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
      },
    },
    [REPOSITORY_IMPORT_NODES.PLACEMENT_REVIEW]: {
      nextNode: REPOSITORY_IMPORT_NODES.FINALIZE,
    },
    [REPOSITORY_IMPORT_NODES.FINALIZE]: {
      nextNode: REPOSITORY_IMPORT_NODES.ENRICHMENT_CHOICE,
    },
    [REPOSITORY_IMPORT_NODES.FIRST_WORK_QUESTION]: {
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK,
    },
    [REPOSITORY_IMPORT_NODES.FIRST_WORK]: {
      transitions: {
        questions: {
          description: 'Ask the single follow-up round.',
          nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_FOLLOW_UP,
        },
        success: {
          description: 'First-work proposals exist; the import is complete.',
          nextNodeId: REPOSITORY_IMPORT_NODES.END,
        },
        retryable_failure: {
          description: 'Retry without losing answers.',
          nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY,
        },
        terminal_failure: {
          description: 'Expose the typed failure for retry.',
          nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY,
        },
        default: {
          description: 'Keep unknown outcomes on the recovery path.',
          nextNodeId: REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY,
        },
      },
    },
    [REPOSITORY_IMPORT_NODES.FIRST_WORK_FOLLOW_UP]: {
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK,
    },
    [REPOSITORY_IMPORT_NODES.FIRST_WORK_RECOVERY]: {
      nextNode: REPOSITORY_IMPORT_NODES.FIRST_WORK,
    },
    [REPOSITORY_IMPORT_NODES.END]: {},
  },
});
