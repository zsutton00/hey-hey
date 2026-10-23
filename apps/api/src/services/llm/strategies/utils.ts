export function addSection(header: string, lines: string[]) {
  return `\n### ${header} ###\n\n${lines.join('\n')}\n`;
}

export function getResponseGuidance(): string {
  let instructions = '';

  instructions += addSection('CRITICAL PRE-CHECK:', [
    'Before generating questions, review conversation history to ensure:',
    '1. Extract all previously answered topics from conversation history',
    '2. List specific areas already covered: [functionality, users, tech stack, etc.]',
    '3. Mark these as OFF-LIMITS for new questions',
    '4. Focus ONLY on unexplored dimensions',
  ]);

  instructions += addSection('MANDATORY: AVOID QUESTION REPETITION', [
    'Before generating questions, review conversation history to ensure:',
    '- DO NOT ask questions substantially similar to previous ones',
    '- BUILD ON previous answers rather than re-asking for the same information',
    '- If core topics already covered, focus on specific details or implementation aspects',
    '- Each question must add NEW value to the conversation',
  ]);

  instructions += addSection('EXAMPLES OF REPETITIVE QUESTIONS TO AVOID', [
    'Before generating questions, review conversation history to ensure:',
    `❌ "Can you tell me more about your users?" (if users already discussed)`,
    `❌ "What features are most important?" (if functionality already covered)`,
    `✅ "How do your PMs currently measure feature adoption?" (specific follow-up)`,
    `✅ "What's the handoff process between design docs and implementation?" (workflow detail)\n\n`,
  ]);

  instructions += addSection('RESPONSE FIELD USAGE', [
    'Use the "response" field only for a short preamble or acknowledgement before the questions.',
    'Never repeat or paraphrase the questions in "response"; each question must appear in uiElements[].label.',
    'If no preamble is needed, return a concise acknowledgement such as "Thanks! Here are a few clarifying questions."',
  ]);

  return instructions;
}
