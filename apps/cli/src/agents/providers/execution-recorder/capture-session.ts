import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import type { ToolExecutionHookLaunch } from '@hey-hey/ui-common/agents';
import type { Run } from '../../../run/run';
import type { ResolvedRunWorkspace } from '../../run-scope';
import type { ServerLogger } from '../../../server/logger';
import type { ExecutionRecorder } from './execution-recorder';
import type { CaptureGap, CaptureIdentity, CaptureRoot } from './observation';
import { HookChannel, type HookInput } from './hook-channel';

export interface CaptureScope {
  sessionId: string;
  runId: string;
  turnId: string;
  provider: 'codex' | 'claude';
  roots: CaptureRoot[];
  harnessVersion: string;
}
interface AdmittedTool {
  identity: CaptureIdentity;
  scope: CaptureScope;
}
const execFileAsync = promisify(execFile);

/** Captures host-owned scope before a tool can use the hook channel; hook input cannot widen it. */
export class ExecutionCaptureSession {
  private readonly channel = new HookChannel(this);
  private scope: CaptureScope | null = null;
  private readonly tools = new Map<string, AdmittedTool>();
  private readonly observed = new Set<string>();
  private readonly outcomes = new Map<string, 'success' | 'failure' | 'denied'>();
  private readonly finalized = new Set<string>();
  private version: string | null = null;
  private providerTurn: { sessionId: string; turnId: string } | null = null;

  public constructor(
    private readonly provider: 'codex' | 'claude',
    private readonly recorder: ExecutionRecorder,
    private readonly logger: ServerLogger,
  ) {}

  public async open(
    run: Run,
    workspace: ResolvedRunWorkspace,
  ): Promise<ToolExecutionHookLaunch | undefined> {
    const turnId = run.activeTurn?.turnId;
    if (!turnId) return undefined;
    try {
      const roots: CaptureRoot[] = [];
      const allowedRoots = new Set(
        await Promise.all(workspace.allowedRepositoryRoots.map((root) => fs.realpath(root))),
      );
      for (const service of run.session.services) {
        // The Run refreshes these paths from its resolved workspace before provider execution.
        const root = await fs.realpath(service.path);
        if (!allowedRoots.has(root)) continue;
        roots.push({ serviceId: service.id, root });
      }
      if (roots.length === 0) return undefined;
      if (this.version === null) {
        const result = await execFileAsync(this.provider, ['--version'], { timeout: 5000 });
        this.version = result.stdout.trim();
      }
      return await this.start({
        sessionId: run.session.agentic_session_id,
        runId: run.runId,
        turnId,
        provider: this.provider,
        roots,
        harnessVersion: this.version,
      });
    } catch {
      await this.transportFailure();
      return undefined;
    }
  }

  public async start(scope: CaptureScope): Promise<ToolExecutionHookLaunch | undefined> {
    this.scope = scope;
    if (process.platform === 'win32') {
      await this.gap('unsupported_platform');
      return undefined;
    }
    const launch = await this.channel.open();
    this.logger.debug('execution_capture.channel_ready', {
      runId: scope.runId,
      turnId: scope.turnId,
      provider: this.provider,
      harnessVersion: scope.harnessVersion,
    });
    return launch;
  }

  public admit(
    providerSessionId: string,
    providerTurnId: string | null,
    toolCallId: string,
    toolName: string,
  ): void {
    const scope = this.scope;
    if (!scope) return;
    const identity: CaptureIdentity = {
      sessionId: scope.sessionId,
      runId: scope.runId,
      turnId: scope.turnId,
      provider: this.provider,
      providerSessionId,
      providerTurnId,
      toolCallId,
      toolName,
    };
    this.tools.set(`${providerSessionId}:${toolCallId}`, { identity, scope });
  }

  public bindProviderTurn(sessionId: string, turnId: string): void {
    this.providerTurn = { sessionId, turnId };
  }

  public outcome(
    sessionId: string,
    toolId: string,
    outcome: 'success' | 'failure' | 'denied',
  ): void {
    this.outcomes.set(`${sessionId}:${toolId}`, outcome);
  }

  public async handle(input: HookInput, signal: AbortSignal): Promise<void> {
    this.logger.debug('execution_capture.hook_received', {
      event: input.hook_event_name,
      providerSessionId: input.session_id,
      providerTurnId: input.turn_id,
      toolCallId: input.tool_use_id,
      toolName: input.tool_name,
    });
    const supported =
      this.provider === 'codex'
        ? ['Bash', 'apply_patch']
        : ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
    if (!supported.includes(input.tool_name)) {
      await this.gap('unsupported_tool');
      return;
    }
    // Codex PreToolUse can precede item/started. Its active root identity comes
    // from the SDK, not the hook's cwd or a caller-supplied application identity.
    if (
      this.provider === 'codex' &&
      input.hook_event_name === 'PreToolUse' &&
      this.providerTurn?.sessionId === input.session_id &&
      this.providerTurn.turnId === input.turn_id &&
      ['Bash', 'apply_patch'].includes(input.tool_name)
    ) {
      this.admit(
        this.providerTurn.sessionId,
        this.providerTurn.turnId,
        input.tool_use_id,
        input.tool_name,
      );
    }
    const admitted = this.tools.get(`${input.session_id}:${input.tool_use_id}`);
    if (
      !admitted ||
      admitted.identity.toolName !== input.tool_name ||
      (this.provider === 'codex' && admitted.identity.providerTurnId !== input.turn_id)
    ) {
      await this.gap('identity_unresolved');
      return;
    }
    const { identity, scope } = admitted;
    const toolKey = `${identity.providerSessionId}:${identity.toolCallId}`;
    if (this.finalized.has(toolKey)) return;
    this.observed.add(`${scope.turnId}:${identity.toolCallId}`);
    if (input.hook_event_name === 'PreToolUse') {
      if (this.scope !== scope) {
        await this.gap('identity_unresolved');
        return;
      }
      await this.recorder.begin(identity, scope.roots, scope.harnessVersion);
      if (signal.aborted || this.scope !== scope)
        await this.recorder.interrupt(scope.runId, scope.turnId);
    } else {
      const outcome =
        this.outcomes.get(toolKey) ??
        (input.hook_event_name === 'PostToolUseFailure'
          ? 'failure'
          : input.exit_code !== undefined && input.exit_code !== null
            ? input.exit_code === 0
              ? 'success'
              : 'failure'
            : this.provider === 'claude' || identity.toolName !== 'Bash'
              ? 'success'
              : 'unknown');
      await this.recorder.finish(
        identity,
        scope.roots,
        scope.harnessVersion,
        outcome,
        identity.toolName !== 'Bash' && !signal.aborted,
      );
      this.finalized.add(toolKey);
    }
  }

  private async gap(reason: CaptureGap): Promise<void> {
    const scope = this.scope;
    this.logger.debug('execution_capture.coverage_gap', {
      provider: this.provider,
      runId: scope?.runId,
      turnId: scope?.turnId,
      reason,
    });
    if (scope) {
      try {
        await this.recorder.store.coverage({ ...scope, reason });
      } catch {
        this.logger.warn('execution_capture.coverage_persist_failed', {
          provider: this.provider,
          reason,
        });
      }
    }
  }

  public transportFailure(): Promise<void> {
    return this.gap('snapshot_failure');
  }

  public async end(): Promise<void> {
    const scope = this.scope;
    if (!scope) return;
    const startedAt = Date.now();
    this.logger.info('execution_capture.settlement_started', {
      runId: scope.runId,
      turnId: scope.turnId,
      provider: this.provider,
      admittedToolCount: this.tools.size,
      observedToolCount: this.observed.size,
      finalizedToolCount: this.finalized.size,
      outcomeCount: this.outcomes.size,
    });
    if (![...this.observed].some((key) => key.startsWith(`${scope.turnId}:`)))
      await this.gap('hook_not_observed');
    for (const [key, admitted] of this.tools) {
      const outcome = this.outcomes.get(key);
      if (admitted.scope === scope && this.finalized.has(key) && outcome) {
        const confirmStartedAt = Date.now();
        this.logger.debug('execution_capture.settlement_confirm_started', {
          ...admitted.identity,
          outcome,
        });
        try {
          await this.recorder.confirmOutcome(admitted.identity, outcome);
          this.logger.debug('execution_capture.settlement_confirm_completed', {
            ...admitted.identity,
            elapsedMs: Date.now() - confirmStartedAt,
          });
        } catch {
          this.logger.warn('execution_capture.settlement_confirm_failed', {
            ...admitted.identity,
            elapsedMs: Date.now() - confirmStartedAt,
          });
          await this.transportFailure();
        }
      }
      if (
        admitted.scope !== scope ||
        this.finalized.has(key) ||
        (outcome !== 'failure' && outcome !== 'denied')
      )
        continue;
      const toolStartedAt = Date.now();
      this.logger.debug('execution_capture.settlement_tool_started', {
        ...admitted.identity,
        outcome,
        hookObserved: this.observed.has(`${scope.turnId}:${admitted.identity.toolCallId}`),
      });
      try {
        if (!this.observed.has(`${scope.turnId}:${admitted.identity.toolCallId}`)) {
          await this.recorder.recordUnobserved(
            admitted.identity,
            scope.roots,
            scope.harnessVersion,
            outcome,
          );
        } else
          await this.recorder.finish(
            admitted.identity,
            scope.roots,
            scope.harnessVersion,
            outcome,
            admitted.identity.toolName !== 'Bash',
          );
        this.finalized.add(key);
        this.logger.debug('execution_capture.settlement_tool_completed', {
          ...admitted.identity,
          elapsedMs: Date.now() - toolStartedAt,
        });
      } catch {
        this.logger.warn('execution_capture.settlement_tool_failed', {
          ...admitted.identity,
          elapsedMs: Date.now() - toolStartedAt,
        });
        await this.transportFailure();
      }
    }
    const interruptStartedAt = Date.now();
    this.logger.debug('execution_capture.settlement_interrupt_started', {
      runId: scope.runId,
      turnId: scope.turnId,
      provider: this.provider,
    });
    try {
      await this.recorder.interrupt(scope.runId, scope.turnId);
      this.logger.debug('execution_capture.settlement_interrupt_completed', {
        runId: scope.runId,
        turnId: scope.turnId,
        provider: this.provider,
        elapsedMs: Date.now() - interruptStartedAt,
      });
    } catch {
      this.logger.warn('execution_capture.settlement_interrupt_failed', {
        runId: scope.runId,
        turnId: scope.turnId,
        provider: this.provider,
        elapsedMs: Date.now() - interruptStartedAt,
      });
      await this.transportFailure();
    }
    this.scope = null;
    this.providerTurn = null;
    this.logger.info('execution_capture.settlement_completed', {
      runId: scope.runId,
      turnId: scope.turnId,
      provider: this.provider,
      elapsedMs: Date.now() - startedAt,
    });
  }

  public async close(): Promise<void> {
    const startedAt = Date.now();
    const diagnostic = {
      runId: this.scope?.runId,
      turnId: this.scope?.turnId,
      provider: this.provider,
    };
    this.logger.debug('execution_capture.close_started', diagnostic);
    await this.end();
    this.logger.debug('execution_capture.channel_close_started', diagnostic);
    try {
      await this.channel.close();
      this.logger.debug('execution_capture.channel_close_completed', {
        ...diagnostic,
        elapsedMs: Date.now() - startedAt,
      });
    } catch {
      this.logger.warn('execution_capture.channel_close_failed', diagnostic);
    }
    this.tools.clear();
    this.observed.clear();
    this.outcomes.clear();
    this.finalized.clear();
    this.logger.debug('execution_capture.close_completed', {
      ...diagnostic,
      elapsedMs: Date.now() - startedAt,
    });
  }
}
