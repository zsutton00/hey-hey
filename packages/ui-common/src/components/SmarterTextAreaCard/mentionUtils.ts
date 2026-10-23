// Re-export from shared utility for backward compatibility
export {
  formatMention as createMentionToken,
  parseMention as parseMentionToken,
  extractMentions as deserializeContent,
  renderMentionsAsText,
} from "../../utils/mentionFormatting";
