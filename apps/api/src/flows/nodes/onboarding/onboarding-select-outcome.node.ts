import { Injectable } from '@nestjs/common';
import {
  ExtendedUIFieldType,
  MultipleChoiceAction,
  MultipleChoicePayload,
  UIElement,
} from '../../../generated';
import {
  FlowUserMessage,
  NodeResult,
  NodeType,
  OnboardingFlowContext,
  QuestionsNodeBase,
} from '../../../types/flow-internal.types';
import { MutableContextHandle } from '../../../utils/mutable-context';
import { SHARED_NODES } from '../../constants/node-ids';

type OnboardingOutcomeChoice = MultipleChoiceAction;
const OUTCOME_FIELD_ID = 'onboarding_output_path';

@Injectable()
export class OnboardingSelectOutcomeNode extends QuestionsNodeBase<OnboardingFlowContext> {
  readonly id = SHARED_NODES.SELECT_ONBOARDING_OUTCOME;
  readonly title = 'Choose What To Generate';

  async execute(
    _tracker: MutableContextHandle<OnboardingFlowContext>,
  ): Promise<NodeResult> {
    const payload = {
      options: [
        {
          title: 'Create Plan',
          description:
            'Use this for fast-moving, simpler projects that need a lightweight starting point.',
          action: MultipleChoiceAction.CreatePlan,
        },
        {
          title: 'Create Initiative',
          description:
            'Use this for longer-running, multi-user projects with deeper coordination needs.',
          action: MultipleChoiceAction.CreateInitiative,
        },
      ],
    } satisfies MultipleChoicePayload;

    const uiElements: UIElement[] = [
      {
        id: OUTCOME_FIELD_ID,
        type: ExtendedUIFieldType.MultipleChoice,
        label: 'What would you like to create next?',
        required: true,
        influences: [],
        payload,
      },
    ];

    return {
      type: NodeType.QUESTIONS,
      message:
        'Great, your project context is ready. Choose whether you want a concise initial plan or a full set of initiatives.',
      data: {
        detectedIntent: 'select_onboarding_outcome',
        intentConfidence: 1,
      },
      uiElements,
    };
  }

  async determineRoutingFromUserMessage(
    _context: Readonly<OnboardingFlowContext>,
    userMessage: FlowUserMessage,
  ): Promise<string | undefined> {
    const selected = this.extractOutcomeChoice(userMessage);
    if (selected === MultipleChoiceAction.CreatePlan) {
      return SHARED_NODES.GENERATE_PLANS;
    }
    if (selected === MultipleChoiceAction.CreateInitiative) {
      return SHARED_NODES.GENERATE_INITIATIVES;
    }
    return undefined;
  }

  private extractOutcomeChoice(
    userMessage: FlowUserMessage,
  ): OnboardingOutcomeChoice | undefined {
    const payload = userMessage.data;
    if (typeof payload === 'string') {
      return this.parseChoice(payload);
    }

    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const raw = payload as Record<string, unknown>;

    const direct = raw[OUTCOME_FIELD_ID];
    const parsedDirect = this.parseUnknownChoice(direct);
    if (parsedDirect) {
      return parsedDirect;
    }

    for (const value of Object.values(raw)) {
      const parsed = this.parseUnknownChoice(value);
      if (parsed) {
        return parsed;
      }
    }

    return undefined;
  }

  private parseUnknownChoice(
    value: unknown,
  ): OnboardingOutcomeChoice | undefined {
    if (typeof value === 'string') {
      return this.parseChoice(value);
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const nested = value as Record<string, unknown>;
    if (typeof nested.action === 'string') {
      return this.parseChoice(nested.action);
    }
    if (typeof nested.value === 'string') {
      return this.parseChoice(nested.value);
    }
    if (typeof nested.selection === 'string') {
      return this.parseChoice(nested.selection);
    }
    return undefined;
  }

  private parseChoice(value: string): OnboardingOutcomeChoice | undefined {
    if (
      value === MultipleChoiceAction.CreatePlan ||
      value === MultipleChoiceAction.CreateInitiative
    ) {
      return value;
    }
    return undefined;
  }
}
