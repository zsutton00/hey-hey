const MESSAGE_TITLE_MAX = 150;
// Indexed message text is prefixed with its role label (e.g. "ASSISTANT:", "comment:").
const ROLE_LABEL = /^\s*[A-Za-z_]+:\s*/;

export function deriveMessageTitle(content: string | null | undefined): string {
  if (!content) {
    return '';
  }
  const text = content.replace(ROLE_LABEL, '').replace(/\s+/g, ' ').trim();
  if (text.length <= MESSAGE_TITLE_MAX) {
    return text;
  }
  return `${text.slice(0, MESSAGE_TITLE_MAX - 1).trimEnd()}…`;
}
