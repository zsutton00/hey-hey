import type { OAuthClient } from '../../auth/index';
import { MachineOptionsStore } from '../../options/machine-options-store';
import type { ProjectMaturity, WorkItemTypeDefinitionDto } from '../../shared/api/index';
import { readActiveWorkItemTypeDefinitions } from './work-item-type-registry';
import { readProjectMaturity } from './project-session-context';
import { readHintsEnabled } from './hint-availability';

/**
 * The validated context every fresh provider session opens with: the project's
 * active work-item type definitions, read exactly once per run before the system
 * prompt is delivered. This is the single seam the per-session prompt builder
 * consumes — runners obtain it here rather than each reading the registry, so the
 * read has one canonical home across the Claude, Codex, and OpenCode runners.
 */
export interface SessionStartContext {
  workItemTypeDefinitions: WorkItemTypeDefinitionDto[];
  /** The machine-wide Intent-first choice, as saved when this session starts. */
  intentFirst: boolean;
  /** The project's maturity stage when this session starts; selects stage-specific prompt guidance. */
  maturity: ProjectMaturity;
  /** Whether the platform offers the hint tools (the API's deployment-wide switch). */
  hintsEnabled: boolean;
}

/**
 * Reads the session-start context for a fresh provider session: resolves the
 * OAuth access token, then reads the project's active work-item type
 * definitions. Any failure — token resolution, a missing project id, or the
 * registry read itself — throws so session start aborts loudly rather than
 * opening on a stale or empty ontology. There is no fallback; callers run this
 * once per run, before prompt delivery.
 */
export const readSessionStartContext = async (input: {
  oauthClient: OAuthClient;
  projectId: string | undefined;
}): Promise<SessionStartContext> => {
  if (!input.projectId) {
    throw new Error('Cannot start session: no project id for the session.');
  }

  const tokenResult = await input.oauthClient.getAccessToken();
  if (!tokenResult.success) {
    throw new Error(
      `Cannot start session: failed to resolve an access token (${tokenResult.error}).`,
    );
  }

  const workItemTypeDefinitions = await readActiveWorkItemTypeDefinitions(
    tokenResult.data,
    input.projectId,
  );

  const { intentFirst } = await new MachineOptionsStore().read();
  const maturity = await readProjectMaturity(tokenResult.data, input.projectId);

  const hintsEnabled = await readHintsEnabled(tokenResult.data, input.projectId);

  return { workItemTypeDefinitions, intentFirst, maturity, hintsEnabled };
};
