/**
 * Conversation hooks for state management and coordination.
 * Extracted from ConversationViewer.tsx to break circular dependencies
 * and improve modularity.
 */

export { useConversationSubmission } from "./useConversationSubmission";

export { useConversationScrolling } from "./useConversationScrolling";
