import { LocalPromptType } from 'src/generated/local';
import { WORK_TRACKER_IMPORT_NODES } from '../constants';
import { createFlow } from './utils';

export const workTrackerImportFlow = createFlow({
  id: 'work-tracker-import',
  name: 'Work Tracker Import',
  description:
    'Read existing Jira or Linear work on the paired CLI and import a reviewable Feature hierarchy',
  version: 1,
  startNode: WORK_TRACKER_IMPORT_NODES.CONFIGURATION,
  terminalPromptType: LocalPromptType.free_form,
  nodes: {
    [WORK_TRACKER_IMPORT_NODES.CONFIGURATION]: {
      nextNode: WORK_TRACKER_IMPORT_NODES.CONNECT,
    },
    [WORK_TRACKER_IMPORT_NODES.CONNECT]: {
      transitions: {
        connected: {
          description: 'The runtime already exposes the source tools.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.START,
        },
        connection_required: {
          description: 'Show the connect command and wait for the user.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM,
        },
        default: {
          description: 'Reject unknown completions through confirmation.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM]: {
      transitions: {
        default: {
          description: 'Wait for an explicit connection confirmation.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM,
        },
        CONFIRM_CONNECTION: {
          description: 'Recheck access after the user connected the source.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT,
        },
        CHANGE_CHOICES: {
          description: 'Return to source and runtime choices.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONFIGURATION,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.START]: {
      transitions: {
        default: {
          description: 'Wait for an explicit start.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.START,
        },
        START_IMPORT: {
          description: 'Run the import in a fresh provider session.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.IMPORT,
        },
        CHANGE_CHOICES: {
          description: 'Return to source and runtime choices.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONFIGURATION,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.IMPORT]: {
      transitions: {
        success: {
          description: 'Review the candidate Feature outline.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES,
        },
        connection_required: {
          description: 'Source tools were missing; return to connect.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM,
        },
        default: {
          description: 'Keep unknown outcomes on the connect path.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES]: {
      transitions: {
        default: {
          description: 'Keep reviewing until the outline is approved.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.GENERATE_FEATURES,
        },
        placement: {
          description: 'Existing projects choose placement before approval.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
        finalize: {
          description: 'New projects finish after approval.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.FINALIZE,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY]: {
      transitions: {
        default: {
          description: 'Wait for a valid placement strategy.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.PLACEMENT_STRATEGY,
        },
        review: {
          description: 'The approved placement completes import.',
          nextNodeId: WORK_TRACKER_IMPORT_NODES.FINALIZE,
        },
      },
    },
    [WORK_TRACKER_IMPORT_NODES.FINALIZE]: {
      nextNode: WORK_TRACKER_IMPORT_NODES.END,
    },
    [WORK_TRACKER_IMPORT_NODES.END]: {},
  },
});
