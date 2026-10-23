/**
 * In-memory registry of submission tools active for a Run.
 *
 * Entries are Run-scoped: one stable token per runId, created the first time
 * the Run acquires a handler with submission tools and reused for every
 * subsequent Turn. The Claude SDK caches the MCP URL at session start and
 * does not refresh on resume, so the token bound into that URL must survive
 * for the Run's entire lifetime.
 *
 * Per-Turn mutations (`tools`, `externalAgentNodeId`, `triggerMessageId`)
 * rotate through `update(runId, patch)`. The token and URL stay the same;
 * only the dictionary entry the token points at changes.
 *
 * `externalAgentNodeId` and `triggerMessageId` are the completion identity and
 * travel as one atomic pair: a registration carries either both (an
 * agent-pending turn) or neither (a non-agent turn the resolver classified as
 * waiting-on-user or finished). A null-context registration is a sanctioned
 * state, not a degraded one — `'action'` tools refuse the completion at call
 * time (`http-mcp.ts`) rather than the registry rejecting it. A half-populated
 * pair is never produced by the runtime and signals an upstream contract bug.
 *
 * Unregistration happens once per Run, at `stopRun` or server shutdown —
 * never per Turn. Stale entries are bounded by `MAX_ACTIVE_REGISTRATIONS`
 * as a defense-in-depth cap.
 */

import { randomBytes } from 'node:crypto';
import type { SubmissionToolDeclaration } from './types';

const MAX_ACTIVE_REGISTRATIONS = 256;

export interface SubmissionToolRegistration {
  /** Token used by the local MCP endpoint URL path. */
  token: string;
  runId: string;
  organizationId: string;
  projectId: string;
  conversationId: string;
  /**
   * EXTERNAL_AGENT node id this turn services. The submission message's
   * `completesExternalAgentNode.nodeId` is set from this value so the
   * server-side bridge can match the paused flow execution.
   *
   * Null half of the atomic pair: null exactly when `triggerMessageId` is
   * null. Both are null on a non-agent turn — the resolver classified the
   * turn as waiting-on-user or finished, so no node awaits a completion. This
   * sanctioned null-context state is legal to register; `'action'` tools then
   * refuse the completion at call time in `http-mcp.ts`.
   */
  externalAgentNodeId: string | null;
  /**
   * Id of the conversation trigger message that caused this turn to
   * dispatch. For `'action'` tools, threaded onto the submission completion
   * as `completesExternalAgentNode.completesTriggerMessageId` so
   * pending-work derivation over the conversation log pairs each completion
   * with its originating trigger.
   *
   * Other half of the atomic pair: always null together with
   * `externalAgentNodeId`, never independently.
   */
  triggerMessageId: string | null;
  tools: ReadonlyArray<SubmissionToolDeclaration>;
  /**
   * Tool names callable for the current turn. `tools` is the mounted MCP
   * dictionary for the provider session and may include peer-session tools so
   * resumed turns can reuse the same MCP URL. This list is the active surface
   * for the current handler plus base tools.
   */
  activeToolNames?: readonly string[];
}

const generateToken = (): string => randomBytes(24).toString('base64url');

export type SubmissionToolRegistrationPatch = Partial<
  Pick<
    SubmissionToolRegistration,
    'tools' | 'activeToolNames' | 'externalAgentNodeId' | 'triggerMessageId'
  >
>;

export class SubmissionToolRegistry {
  private readonly registrations = new Map<string, SubmissionToolRegistration>();
  private readonly tokensByRun = new Map<string, string>();

  /**
   * Idempotent per runId: the first call mints a stable token and stores the
   * registration; subsequent calls for the same runId return the existing
   * entry unchanged. To rotate per-Turn fields (`tools`, `externalAgentNodeId`,
   * `triggerMessageId`), call `update(runId, patch)` — the token and URL stay
   * the same so the Claude SDK's cached MCP config remains valid.
   */
  public register(input: Omit<SubmissionToolRegistration, 'token'>): SubmissionToolRegistration {
    const existingToken = this.tokensByRun.get(input.runId);
    if (existingToken) {
      const existing = this.registrations.get(existingToken);
      if (existing) return existing;
      this.tokensByRun.delete(input.runId);
    }

    if (this.registrations.size >= MAX_ACTIVE_REGISTRATIONS) {
      const oldest = this.registrations.keys().next().value;
      if (oldest) {
        const stale = this.registrations.get(oldest);
        this.registrations.delete(oldest);
        if (stale) this.tokensByRun.delete(stale.runId);
      }
    }

    const token = generateToken();
    const registration: SubmissionToolRegistration = { token, ...input };
    this.registrations.set(token, registration);
    this.tokensByRun.set(input.runId, token);
    return registration;
  }

  /**
   * Per-Turn mutation of a Run's registration. Throws if the runId has no
   * prior `register()` — the caller is responsible for registering on
   * first use.
   */
  public update(runId: string, patch: SubmissionToolRegistrationPatch): SubmissionToolRegistration {
    const token = this.tokensByRun.get(runId);
    const existing = token ? this.registrations.get(token) : null;
    if (!token || !existing) {
      throw new Error(
        `SubmissionToolRegistry.update: no registration for runId ${runId}; call register() first`,
      );
    }
    const updated: SubmissionToolRegistration = { ...existing, ...patch };
    this.registrations.set(token, updated);
    return updated;
  }

  public get(token: string): SubmissionToolRegistration | null {
    return this.registrations.get(token) ?? null;
  }

  public getByRunId(runId: string): SubmissionToolRegistration | null {
    const token = this.tokensByRun.get(runId);
    if (!token) return null;
    return this.registrations.get(token) ?? null;
  }

  public unregisterByToken(token: string): void {
    const entry = this.registrations.get(token);
    if (!entry) return;
    this.registrations.delete(token);
    if (this.tokensByRun.get(entry.runId) === token) {
      this.tokensByRun.delete(entry.runId);
    }
  }

  public unregisterByRunId(runId: string): void {
    const token = this.tokensByRun.get(runId);
    if (!token) return;
    this.unregisterByToken(token);
  }

  public size(): number {
    return this.registrations.size;
  }

  public clearAll(): void {
    this.registrations.clear();
    this.tokensByRun.clear();
  }
}
