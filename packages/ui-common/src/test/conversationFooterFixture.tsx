import type { PersistedConversationViewerProps } from "../components/Conversation/ConversationViewer";
import {
  deriveConversationModel,
  resolveConversationResponseModel,
} from "../components/Conversation/utils/conversationResponseModel";

/** Footer contract for tests replacing message history; real submission tests use the provider. */
export function renderConversationFooterFixture(
  props: Pick<
    PersistedConversationViewerProps,
    | "conversation"
    | "renderFooter"
    | "agentSessionCurrentState"
    | "ownerCanSubmit"
    | "ownerSubmitting"
    | "forceProcessing"
    | "readOnly"
  >,
) {
  return props.renderFooter?.({
    model: deriveConversationModel({
      response: resolveConversationResponseModel([], [], {
        workflowCanSubmit: true,
        isSubmitting: false,
        readOnly: false,
        isCliInputDisabled: false,
      }),
      conversation: props.conversation,
      messages: [],
      settled: true,
      error: null,
      currentState: props.agentSessionCurrentState,
      forceProcessing: props.forceProcessing ?? false,
      readOnly: props.readOnly ?? false,
      canSubmit: props.ownerCanSubmit ?? true,
      submission: props.ownerSubmitting ? "sending" : "idle",
    }),
    executeSubmission: async (_parent, submit) => submit(),
  });
}
