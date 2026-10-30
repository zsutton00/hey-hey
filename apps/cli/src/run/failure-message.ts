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
  STARTUP_FAILED: 'The session could not start because its preparation failed. Please try again.',
  STOPPED:
    'This request was stopped before it finished. Send another message when you want to continue.',
  PUBLICATION_FAILED: 'A response was generated but could not be published. Please try again.',
  MODEL_CAPACITY: 'The provider is temporarily at capacity for the selected model. Please retry.',
  ATTACHMENT_NOT_FOUND:
    'An attachment is no longer available. Attach the file again, then send your message again.',
} as const;

export type FailureReason = keyof typeof explanations;

export function failureMessage(
  reason: FailureReason,
  serviceNames: readonly string[] = [],
): string {
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
