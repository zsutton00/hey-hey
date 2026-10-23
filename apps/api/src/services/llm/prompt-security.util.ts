/**
 * Prompt security utilities for sanitizing LLM prompts
 * Pure functions with no dependencies for maximum reusability
 */

/**
 * Sanitizes prompts before sending to LLM to prevent prompt injection
 * Wraps user input sections to clearly delineate them from system instructions
 *
 * @param prompt - The prompt to sanitize
 * @returns Sanitized prompt with user input clearly marked
 */
export function sanitizePrompt(prompt: string): string {
  // Ensure no user content can override system instructions
  const sections = prompt.split('\n\n');

  return sections
    .map((section) => {
      // If section contains user input, wrap it clearly
      if (
        section.includes('User message:') ||
        section.includes('Additional data:')
      ) {
        return `[USER INPUT START]\n${section}\n[USER INPUT END]`;
      }
      return section;
    })
    .join('\n\n');
}
