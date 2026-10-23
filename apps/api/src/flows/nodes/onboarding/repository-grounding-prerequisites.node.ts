import { Injectable, Logger } from '@nestjs/common';
import {
  ExtendedUIFieldType,
  MachineExecutionReadinessState,
  UIElement,
} from 'src/generated';
import type {
  RepositoryGroundingAnalysisConfiguration,
  RepositoryGroundingPrerequisites,
} from 'src/generated';
import { RepositoryGroundingEntryMode } from 'src/generated';
import {
  FlowUserMessage,
  MutableContextHandle,
  NodeResult,
  NodeType,
  RepositoryImportFlowContext,
  QuestionsNodeBase,
} from 'src/types/flow-internal.types';
import { MachineExecutionReadinessService } from '../../../services/machine-pairing/machine-execution-readiness.service';
import { MachinePairingService } from '../../../services/machine-pairing/machine-pairing.service';
import { ServiceService } from '../../../services/service/service.service';
import { REPOSITORY_IMPORT_NODES } from '../../constants/node-ids';
import {
  getRepositoryGroundingAnswers,
  buildRepositoryGroundingFieldPayload,
  hasRepositoryGroundingTypedAnswers,
  parseRepositoryGroundingFormSubmission,
  parseRepositoryGroundingPrerequisitesAnswer,
  REPOSITORY_GROUNDING_FIELDS,
  RepositoryGroundingInputError,
} from './repository-grounding.contract';

@Injectable()
export class OnboardingRepositoryGroundingPrerequisitesNode extends QuestionsNodeBase<RepositoryImportFlowContext> {
  readonly id = REPOSITORY_IMPORT_NODES.PREREQUISITES;
  readonly title = 'Repository analysis prerequisites';

  private readonly logger = new Logger(
    OnboardingRepositoryGroundingPrerequisitesNode.name,
  );

  constructor(
    private readonly serviceService: ServiceService,
    private readonly machinePairingService: MachinePairingService,
    private readonly machineReadinessService: MachineExecutionReadinessService,
  ) {
    super();
  }

  async execute(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
  ): Promise<NodeResult> {
    const context = tracker.getContext();
    const [services, machines] = await Promise.all([
      this.serviceService.findAll(context.core.organizationId, {
        projectId: context.core.projectId,
      }),
      this.machinePairingService.listMachines(context.core.user.id),
    ]);

    const readiness = await Promise.all(
      machines.map(async (machine) => ({
        machineId: machine.machineId,
        state: (
          await this.machineReadinessService.resolve({
            machineId: machine.machineId,
            userId: context.core.user.id,
            organizationId: context.core.organizationId,
          })
        )?.executionReadiness,
      })),
    );
    const readinessByMachine = new Map(
      readiness.map((item) => [item.machineId, item.state]),
    );

    this.logger.debug('Repository-grounding prerequisites rendered', {
      conversationId: context.core.conversationId,
      serviceCount: services.length,
      machineCount: machines.length,
      readyMachineCount: readiness.filter(
        (item) => item.state === MachineExecutionReadinessState.Ready,
      ).length,
    });

    const repositoryGroundingPayload = buildRepositoryGroundingFieldPayload(
      context,
      { phase: 'prerequisites' },
    );
    const repositoryField: UIElement = {
      id: 'repository_grounding',
      type: ExtendedUIFieldType.RepositoryGrounding,
      label: 'Repository capability analysis',
      required: true,
      influences: [],
      payload: repositoryGroundingPayload,
    };

    const availabilityMessage =
      services.length === 0
        ? 'No active Service is available in this project yet. Add or select a Service before continuing.'
        : machines.length === 0
          ? 'No paired machine is available for this account yet. Pair a machine before continuing.'
          : 'Select the Service, confirmed brief, and paired machine for this analysis. Current choices are retained when you return here.';

    return {
      type: NodeType.QUESTIONS,
      message: availabilityMessage,
      uiElements: [repositoryField],
      data: {
        detectedIntent: 'repository_grounding_prerequisites',
        intentConfidence: 1,
      },
    };
  }

  async processUserResponse(
    tracker: MutableContextHandle<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<void> {
    const context = tracker.getContext();
    let prerequisites: RepositoryGroundingPrerequisites;
    let configuration: RepositoryGroundingAnalysisConfiguration | undefined;
    try {
      const answers = getRepositoryGroundingAnswers(userMessage);
      if (hasRepositoryGroundingTypedAnswers(answers)) {
        const submission = parseRepositoryGroundingFormSubmission(answers);
        prerequisites = submission.prerequisites;
        configuration = submission.analysisConfiguration;
      } else {
        const entryMode =
          context.repositoryGrounding?.prerequisites.entryMode ??
          context.repositoryGroundingPrerequisites?.entryMode ??
          context.repositoryGroundingSeed?.entryMode ??
          RepositoryGroundingEntryMode.NewProject;
        prerequisites = parseRepositoryGroundingPrerequisitesAnswer(
          answers,
          entryMode,
        );
      }

      const [services, machines] = await Promise.all([
        this.serviceService.findAll(context.core.organizationId, {
          projectId: context.core.projectId,
        }),
        this.machinePairingService.listMachines(context.core.user.id),
      ]);
      if (
        !services.some((service) => service.id === prerequisites.serviceId) ||
        !machines.some(
          (machine) => machine.machineId === prerequisites.machineId,
        )
      ) {
        throw new RepositoryGroundingInputError(
          'The selected Service or paired machine is no longer available',
        );
      }
    } catch (error) {
      if (error instanceof RepositoryGroundingInputError) {
        this.logger.warn('Repository-grounding prerequisites rejected', {
          conversationId: context.core.conversationId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }

    tracker.mutate((draft) => {
      draft.repositoryGroundingPrerequisites = prerequisites;
      if (configuration) {
        draft.repositoryGroundingAnalysisConfiguration = configuration;
      }
      draft.repositoryGroundingSeed = undefined;
      draft.repositoryGroundingCompletion = undefined;
      draft.repositoryGroundingPaused = undefined;
      const acceptedConfiguration =
        configuration ?? draft.repositoryGroundingAnalysisConfiguration;
      draft.repositoryGrounding = acceptedConfiguration
        ? { prerequisites, analysisConfiguration: acceptedConfiguration }
        : undefined;
    });

    this.logger.debug('Repository-grounding prerequisites accepted', {
      conversationId: context.core.conversationId,
      serviceId: prerequisites.serviceId,
      machineId: prerequisites.machineId,
      entryMode: prerequisites.entryMode,
    });
  }

  async determineRoutingFromUserMessage(
    context: Readonly<RepositoryImportFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string> {
    const answers = getRepositoryGroundingAnswers(userMessage);
    if (hasRepositoryGroundingTypedAnswers(answers)) {
      try {
        const { action } = parseRepositoryGroundingFormSubmission(answers);
        switch (action) {
          case 'START_ANALYSIS':
          case 'RETRY_ANALYSIS':
            return REPOSITORY_IMPORT_NODES.ANALYSIS;
          case 'FINISH_LATER':
            return REPOSITORY_IMPORT_NODES.RECOVERY;
          case 'CONTINUE_CONVERSATION':
            return REPOSITORY_IMPORT_NODES.RECOVERY;
          default:
            return this.id;
        }
      } catch (error) {
        if (error instanceof RepositoryGroundingInputError) return this.id;
        throw error;
      }
    }

    return context.repositoryGroundingPrerequisites
      ? REPOSITORY_IMPORT_NODES.CONFIGURATION
      : this.id;
  }
}

function formatReadiness(
  state: MachineExecutionReadinessState | undefined,
): string {
  if (!state) return 'readiness unavailable';
  return state
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
