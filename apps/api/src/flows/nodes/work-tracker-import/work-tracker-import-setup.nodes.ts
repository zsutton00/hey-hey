import { Injectable, Logger } from '@nestjs/common';
import {
  WorkTrackerImportAction,
  WorkTrackerImportConfiguration,
  type UIElement,
} from '../../../generated';
import { MachinePairingService } from '../../../services/machine-pairing/machine-pairing.service';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  QuestionsNodeBase,
  WorkTrackerImportFlowContext,
} from '../../../types/flow-internal.types';
import { WORK_TRACKER_IMPORT_NODES } from '../../constants/node-ids';
import {
  getWorkTrackerAnswers,
  parseWorkTrackerAction,
  parseWorkTrackerConfigurationAnswers,
  sourceLabel,
  WORK_TRACKER_FIELDS,
  WorkTrackerImportInputError,
} from './work-tracker-import.contract';

function readAction(
  userMessage: FlowUserMessage,
): WorkTrackerImportAction | undefined {
  try {
    return parseWorkTrackerAction(getWorkTrackerAnswers(userMessage.data));
  } catch (error) {
    if (error instanceof WorkTrackerImportInputError) return undefined;
    throw error;
  }
}

function actionField(
  label: string,
  options: { value: WorkTrackerImportAction; label: string }[],
): UIElement {
  return {
    id: WORK_TRACKER_FIELDS.action,
    type: 'select',
    label,
    required: true,
    influences: [],
    options,
  };
}

@Injectable()
export class WorkTrackerImportConfigurationNode extends QuestionsNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.CONFIGURATION;
  readonly title = 'Choose a work tracker and runtime';

  private readonly logger = new Logger(WorkTrackerImportConfigurationNode.name);

  constructor(private readonly machinePairingService: MachinePairingService) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const machines = await this.machinePairingService.listMachines(
      context.core.user.id,
    );
    this.logger.debug('Work-tracker import configuration rendered', {
      conversationId: context.core.conversationId,
      machineCount: machines.length,
      presetSource: context.workTrackerImportEntry?.source,
    });

    if (machines.length === 0) {
      return {
        type: NodeType.QUESTIONS,
        message:
          'Work-tracker import runs on your own paired CLI, never on Hey Hey servers. Pair a machine with `hey-hey pair`, then return here.',
        uiElements: [
          actionField('When your machine is paired', [
            {
              value: WorkTrackerImportAction.ChangeChoices,
              label: 'I paired a machine',
            },
          ]),
        ],
        data: {
          detectedIntent: 'work_tracker_import_pairing_required',
          intentConfidence: 1,
        },
      };
    }

    const saved = context.workTrackerImportConfiguration;
    const uiElements: UIElement[] = [
      {
        id: WORK_TRACKER_FIELDS.source,
        type: 'select',
        label: 'Which work tracker should Hey Hey import from?',
        required: true,
        influences: [],
        options: [
          { value: 'jira', label: 'Jira' },
          { value: 'linear', label: 'Linear' },
        ],
      },
      {
        id: WORK_TRACKER_FIELDS.machineId,
        type: 'select',
        label: 'Paired machine',
        required: true,
        influences: [],
        options: machines.map((machine) => ({
          value: machine.machineId,
          label: machine.name,
        })),
      },
      {
        id: WORK_TRACKER_FIELDS.provider,
        type: 'select',
        label: 'Provider',
        required: true,
        influences: [],
        options: [
          {
            value: WorkTrackerImportConfiguration.ProviderEnum.Claude,
            label: 'Claude Code',
          },
          {
            value: WorkTrackerImportConfiguration.ProviderEnum.Codex,
            label: 'Codex',
          },
        ],
      },
      {
        id: WORK_TRACKER_FIELDS.model,
        type: 'text',
        label: 'Model',
        required: true,
        influences: [],
        placeholder:
          saved?.resolvedFrontierModel ??
          'Model id, e.g. the one you use in your CLI',
      },
      {
        id: WORK_TRACKER_FIELDS.reasoningEffort,
        type: 'select',
        label: 'Reasoning effort',
        required: true,
        influences: [],
        options: Object.values(
          WorkTrackerImportConfiguration.ReasoningEffortEnum,
        ).map((value) => ({ value, label: value })),
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message:
        'Choose the work tracker, paired machine, provider, and model. Your CLI will check whether it can reach the tracker before anything is imported.',
      uiElements,
      data: {
        detectedIntent: 'work_tracker_import_configuration',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const context = tracker.getContext();
    let configuration: WorkTrackerImportConfiguration;
    try {
      configuration = parseWorkTrackerConfigurationAnswers(
        getWorkTrackerAnswers(userMessage.data),
      );
    } catch (error) {
      if (error instanceof WorkTrackerImportInputError) {
        this.logger.warn('Work-tracker import configuration rejected', {
          conversationId: context.core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }

    const machines = await this.machinePairingService.listMachines(
      context.core.user.id,
    );
    if (!machines.some((m) => m.machineId === configuration.machineId)) {
      this.logger.warn(
        'Work-tracker import configuration rejected: machine not paired to user',
        {
          conversationId: context.core.conversationId,
          machineId: configuration.machineId,
        },
      );
      return;
    }

    tracker.mutate((draft) => {
      draft.workTrackerImportConfiguration = configuration;
      draft.workTrackerConnectionConfirmed = undefined;
      draft.workTrackerConnectionOutcome = undefined;
      draft.workTrackerImportAccepted = undefined;
    });
    this.logger.log('Work-tracker import configuration accepted', {
      conversationId: context.core.conversationId,
      source: configuration.source,
      provider: configuration.provider,
      resolvedFrontierModel: configuration.resolvedFrontierModel,
      machineId: configuration.machineId,
    });
  }

  async determineRoutingFromUserMessage(
    context: Readonly<WorkTrackerImportFlowContext>,
  ): Promise<string> {
    return context.workTrackerImportConfiguration
      ? WORK_TRACKER_IMPORT_NODES.CONNECT
      : this.id;
  }
}

@Injectable()
export class WorkTrackerImportConnectConfirmNode extends QuestionsNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.CONNECT_CONFIRM;
  readonly title = 'Connect your work tracker';

  private readonly logger = new Logger(
    WorkTrackerImportConnectConfirmNode.name,
  );

  async execute(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const source = context.workTrackerImportConfiguration?.source;
    this.logger.debug('Work-tracker connection confirmation rendered', {
      conversationId: context.core.conversationId,
      source,
    });
    const label = source ? sourceLabel(source) : 'your work tracker';
    return {
      type: NodeType.QUESTIONS,
      message: `Your paired CLI can't reach ${label} yet. Run the command shown above on your machine, or explicitly ask your agent to run it, and finish the sign-in in your browser. Nothing is added to your machine until you do. Hey Hey never receives your ${label} credentials.`,
      uiElements: [
        actionField(`When ${label} is connected`, [
          {
            value: WorkTrackerImportAction.ConfirmConnection,
            label: `I've connected ${label}`,
          },
          {
            value: WorkTrackerImportAction.ChangeChoices,
            label: 'Change source or runtime',
          },
          {
            value: WorkTrackerImportAction.FinishLater,
            label: 'Finish later',
          },
        ]),
      ],
      data: {
        detectedIntent: 'work_tracker_import_connection_required',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const action = readAction(userMessage);
    if (action !== WorkTrackerImportAction.ConfirmConnection) return;
    tracker.mutate((draft) => {
      draft.workTrackerConnectionConfirmed = true;
    });
    this.logger.log('Work-tracker connection confirmed by user', {
      conversationId: tracker.getContext().core.conversationId,
      source: tracker.getContext().workTrackerImportConfiguration?.source,
    });
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    switch (readAction(userMessage)) {
      case WorkTrackerImportAction.ConfirmConnection:
        return WORK_TRACKER_IMPORT_NODES.CONNECT;
      case WorkTrackerImportAction.ChangeChoices:
        return WORK_TRACKER_IMPORT_NODES.CONFIGURATION;
      default:
        return this.id;
    }
  }
}

@Injectable()
export class WorkTrackerImportStartNode extends QuestionsNodeBase<WorkTrackerImportFlowContext> {
  readonly id = WORK_TRACKER_IMPORT_NODES.START;
  readonly title = 'Start work-tracker import';

  private readonly logger = new Logger(WorkTrackerImportStartNode.name);

  async execute(
    tracker: MutableContextHandle<WorkTrackerImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const source = context.workTrackerImportConfiguration?.source;
    this.logger.debug('Work-tracker import start gate rendered', {
      conversationId: context.core.conversationId,
      source,
    });
    const label = source ? sourceLabel(source) : 'your work tracker';
    return {
      type: NodeType.QUESTIONS,
      message: `Your paired CLI can reach ${label}. Start the import when you're ready; it reads ${label} on your machine and proposes Features for your review. Nothing is added to the project until you approve it.`,
      uiElements: [
        actionField('Ready to import?', [
          {
            value: WorkTrackerImportAction.StartImport,
            label: 'Start import',
          },
          {
            value: WorkTrackerImportAction.ChangeChoices,
            label: 'Change source or runtime',
          },
          {
            value: WorkTrackerImportAction.FinishLater,
            label: 'Finish later',
          },
        ]),
      ],
      data: {
        detectedIntent: 'work_tracker_import_start',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(): Promise<void> {
    // Routing alone carries the explicit start decision.
  }

  async determineRoutingFromUserMessage(
    context: Readonly<WorkTrackerImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const action = readAction(userMessage);
    this.logger.debug('Work-tracker import start action received', {
      conversationId: context.core.conversationId,
      action,
    });
    switch (action) {
      case WorkTrackerImportAction.StartImport:
        return WORK_TRACKER_IMPORT_NODES.IMPORT;
      case WorkTrackerImportAction.ChangeChoices:
        return WORK_TRACKER_IMPORT_NODES.CONFIGURATION;
      default:
        return this.id;
    }
  }
}
