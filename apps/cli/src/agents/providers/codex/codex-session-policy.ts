import type { CodexSdkSessionConfig } from '../../../agent-runtime/index';

/** Apply last: read-only sessions never inherit the automatic reviewer. */
export const applyCodexSessionReviewerPolicy = (
  config: CodexSdkSessionConfig['config'],
  sandboxMode: CodexSdkSessionConfig['sandbox'],
): CodexSdkSessionConfig['config'] =>
  sandboxMode === 'read-only' ? { ...config, approvals_reviewer: 'user' } : config;
