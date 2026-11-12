import { AgentStartupPromptInputError } from '../commands/agent-startup-prompt-input';
import { ProjectAssistantPreparationError } from '../agents/project-assistant/nearest-parent-feature';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import { LocalAgentApiError } from '../shared/agent-bridge-contract/errors';

const explanations = {
  SCHEMA_INVALID:
    'This message could not start because the request was invalid. Update the CLI, then send your message again.',
  AUTHORIZATION_REJECTED:
    'The session could not authorize the request. Reconnect the CLI and check that you are signed in to your provider, then send your message again.',
  OPERATION_FINGERPRINT_MISMATCH:
    'This request conflicts with an earlier delivery. Refresh the conversation, then send your message again.',
  EXECUTION_FAILED: 'The session failed while working on your message. Please try again.',
  SERVICE_FOLDER_NOT_BOUND:
    'This session needs a Service folder. Bind its folder on this machine, or start a new session with a Service, then send your message again.',
  INTERNAL_ERROR:
    'The session could not complete because of an unexpected error. Please try again.',
  STARTUP_FAILED:
    'The session could not start because its preparation failed. Check the CLI logs for the cause, then send your message again.',
  STOPPED:
    'This request was stopped before it finished. Send another message when you want to continue.',
  PUBLICATION_FAILED: 'A response was generated but could not be published. Please try again.',
  MODEL_CAPACITY: 'The provider is temporarily at capacity for the selected model. Please retry.',
  ATTACHMENT_NOT_FOUND:
    'An attachment is no longer available. Attach the file again, then send your message again.',
} as const;

export type FailureReason = keyof typeof explanations;

/**
 * A safe, user-facing statement of why preparation failed: authored error messages and error
 * codes only, never a raw message from a dependency, which can carry content or credentials.
 */
export function startupFailureCause(error: unknown): string | undefined {
  if (error instanceof ProjectAssistantPreparationError) {
    return error.message;
  }
  if (error instanceof AgentStartupPromptInputError) {
    return `${error.message} (${error.boundary})`;
  }
  if (error instanceof LocalAgentApiError || error instanceof AgentSessionRunnerError) {
    return `${error.message} (${error.code})`;
  }
  if (error instanceof Error) {
    return `Unexpected ${error.name} while preparing the session.`;
  }
  return undefined;
}

export function failureMessage(
  reason: FailureReason,
  serviceNames: readonly string[] = [],
  details: { cause?: string | undefined; reference?: string | undefined } = {},
): string {
  if (reason === 'STARTUP_FAILED' && details.cause) {
    const lines = [
      'The session could not start because its preparation failed.',
      `**Cause:** ${details.cause.replace(/\.$/, '')}.`,
      ...(details.reference ? [`**Reference:** \`${details.reference}\``] : []),
      'Fix that, then send your message again.',
    ];

    return lines.join('\n\n');
  }
  if (reason === 'SERVICE_FOLDER_NOT_BOUND' && serviceNames.length) {
    return serviceNames
      .map(
        (name) =>
          `Service ${name} isn't bound to a folder on this machine. Bind a folder, then send your message again.`,
      )
      .join('\n\n');
  }
  return explanations[reason];
}
