/**
 * ConversationViewer Component Exports
 *
 * Phase 5 Refactored Architecture:
 * - ConversationViewer: Refactored main component using context architecture
 * - ConversationProvider: Context provider for state management
 * - Individual components: ConversationTimeline, ConversationMessage, etc.
 *
 * The ConversationViewer component maintains the same API as before
 * but now uses a clean, modular, context-driven architecture internally.
 */

// Main component (Phase 5 refactored with context architecture)
export { ConversationViewer } from "../ConversationViewer";

// Context and provider
export {
  ConversationProvider,
  useConversationContext,
} from "./ConversationContext";

// Individual components (can be used standalone with ConversationProvider)
export { ConversationTimeline } from "./ConversationTimeline";
export { ConversationHistoryList } from "./ConversationHistoryList";
export { ConversationMessage } from "./ConversationMessage";
export { UserMessageBubble } from "./UserMessageBubble";
export {
  SentAttachmentOpenProvider,
  useSentAttachmentOpenTarget,
} from "./SentAttachmentOpenContext";
export type { SentAttachmentOpenTarget } from "./SentAttachmentOpenContext";
export type {
  UserMessageBubbleProps,
  UserMessageDelivery,
} from "./UserMessageBubble";
export { ConversationFormRenderer } from "./ConversationFormRenderer";
export { ConversationStatusIndicator } from "./ConversationStatusIndicator";
export { ConversationPhaseIndicator } from "./ConversationPhaseIndicator";
export type { ConversationPhaseIndicatorProps } from "./ConversationPhaseIndicator";
export { getConversationPhasePresentation } from "./conversationPhasePresentation";
export type { ConversationPhasePresentation } from "./conversationPhasePresentation";
