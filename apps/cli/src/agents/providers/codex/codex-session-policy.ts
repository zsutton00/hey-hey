import type { CodexSdkSessionConfig } from '../../../agent-runtime/index';

/** Apply last: read-only sessions never inherit the automatic reviewer. */
export const applyCodexSessionReviewerPolicy = (
  config: CodexSdkSessionConfig['config'],
  sandboxMode: CodexSdkSessionConfig['sandbox'],
): CodexSdkSessionConfig['config'] =>
  sandboxMode === 'read-only' ? { ...config, approvals_reviewer: 'user' } : config;

/**
 * The reviewer a native automation mode asks for, resolved once after the
 * sandbox is chosen. A read-only session keeps the user as reviewer, so the
 * top-level thread parameter never contradicts `applyCodexSessionReviewerPolicy`.
 */
export const resolveCodexApprovalsReviewer = (
  providerPermissionMode: 'auto' | undefined,
  sandboxMode: CodexSdkSessionConfig['sandbox'],
): 'auto_review' | undefined =>
  providerPermissionMode === 'auto' && sandboxMode !== 'read-only' ? 'auto_review' : undefined;
