import { createRunArgsFromSession } from '../../run/run-activation';
import type { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import type { RunRegistry } from '../../run/run-registry';
import type {
  LocalCreateRunRequest,
  LocalCreateRunResponse,
  LocalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import type { ServerLogger } from '../logger';
import type { MessageService } from './message.service';
import type { RunService } from './run.service';
import {
  ProjectModeBundleMaterializer,
  ProjectModeBundleValidationError,
  validateProjectModeConfig,
} from '../../agents/project-mode';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import { LocalAgentApiError } from '../../shared/agent-bridge-contract/errors';
import { RunAttachmentStore } from '../run-attachment-store';
import { StagedBrowserTabNotFoundError, type RunTabs } from '../../browser/run-tabs';
import type { StagedBrowserTabReference } from '../../shared/agent-bridge-contract/generated/api';

export interface RunCreationCoordinatorDependencies {
  runService: RunService;
  messageService: MessageService;
  runRegistry: RunRegistry;
  promptTypeRegistry: PromptTypeRegistry;
  logger: ServerLogger;
  projectModeBundleMaterializer: ProjectModeBundleMaterializer;
  /** Absent when this CLI has no Shared Browser, so no staged tab can exist. */
  stagedBrowserTabs?: Pick<RunTabs, 'adoptStaged'>;
}

/** Owns durable Run materialization followed by its optional first Turn. */
export class RunCreationCoordinator {
  public constructor(
    private readonly dependencies: RunCreationCoordinatorDependencies,
    private readonly attachmentStore = new RunAttachmentStore(),
  ) {}

  public async createRun(input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> {
    return this.createRunWithFirstTurnCompletion(input, 'settled');
  }

  public async createRunFromTrigger(input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> {
    return this.createRunWithFirstTurnCompletion(input, 'accepted');
  }

  /**
   * Makes the tab the user opened before the Run existed the Run's selected
   * page and queues the notice its first Turn delivers. Must run before that
   * Turn is built; a tab that is gone rejects the start.
   */
  public async adoptStagedBrowserTab(
    runId: string,
    projectId: string,
    reference: StagedBrowserTabReference | null,
  ): Promise<void> {
    if (!reference) return;
    try {
      const tabs = this.dependencies.stagedBrowserTabs;
      if (!tabs) throw new StagedBrowserTabNotFoundError(reference.stagedTabId);
      await tabs.adoptStaged(runId, projectId, reference.stagedTabId);
    } catch (error) {
      this.dependencies.logger.warn('local.service.create_run.staged_browser_tab_failed', {
        runId,
        stagedTabId: reference.stagedTabId,
        code: error instanceof LocalAgentApiError ? error.code : 'ADOPTION_FAILED',
      });
      throw error;
    }
    this.dependencies.logger.debug('local.service.create_run.staged_browser_tab_adopted', {
      runId,
      stagedTabId: reference.stagedTabId,
    });
  }

  private async createRunWithFirstTurnCompletion(
    input: LocalCreateRunRequest,
    firstTurnCompletion: 'accepted' | 'settled',
  ): Promise<LocalCreateRunResponse> {
    const promptType = input.payload?.promptType;
    const handler = promptType ? this.dependencies.promptTypeRegistry.get(promptType) : undefined;

    if (promptType === LocalPromptType.ProjectMode) {
      const validated = validateProjectModeConfig(input.config);
      if (!validated.ok) {
        this.dependencies.logger.warn('local.service.create_run.project_mode_rejected', {
          promptType,
          issues: validated.issues,
        });
        throw new LocalAgentApiError(
          'INVALID_REQUEST',
          `project_mode requires a valid matching captured selection and snapshot: ${validated.issues.join('; ')}`,
          400,
        );
      }
      try {
        this.dependencies.projectModeBundleMaterializer.validate(validated.value.snapshot);
      } catch (error) {
        if (!(error instanceof ProjectModeBundleValidationError)) throw error;
        this.dependencies.logger.warn('local.service.create_run.project_mode_bundle_rejected', {
          promptType,
          reason: error.message,
        });
        throw new LocalAgentApiError('INVALID_REQUEST', error.message, 400, error);
      }
      this.dependencies.logger.debug('local.service.create_run.project_mode_admitted', {
        promptType,
        modeId: validated.value.selection.modeId,
        snapshotHash: validated.value.snapshot.snapshotHash,
      });
    }

    const materialized = await this.dependencies.runService.materializeRun(input);
    if (materialized.status === 'repo-required') return materialized;

    if (
      materialized.created &&
      input.triggersAgent !== false &&
      promptType &&
      input.payload &&
      handler
    ) {
      try {
        await this.attachmentStore.bindStaged(
          materialized.run.agentic_session_id,
          input.attachments,
        );
      } catch (error) {
        this.dependencies.logger.warn('local.service.create_run.attachments_binding_failed', {
          runId: materialized.run.agentic_session_id,
          attachments: input.attachments,
          code: error instanceof LocalAgentApiError ? error.code : 'BINDING_FAILED',
        });
        throw error;
      }
      this.dependencies.logger.debug('local.service.create_run.attachments_bound', {
        runId: materialized.run.agentic_session_id,
        attachments: input.attachments,
      });
      await this.adoptStagedBrowserTab(
        materialized.run.agentic_session_id,
        input.context.projectId,
        input.stagedBrowserTab,
      );
      const firstTurnRequest: LocalRunPromptRequest = {
        promptType: handler.promptType,
        payload: input.payload,
        attachments: input.attachments,
        references: input.references ?? { resolved: [], unresolved: [] },
        ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
      };
      this.dependencies.logger.debug('local.service.create_run.first_turn_dispatch.started', {
        runId: materialized.run.agentic_session_id,
        promptType,
      });
      if (input.inert) {
        const located = await this.dependencies.runService.activateRunByAnyId(
          materialized.run.agentic_session_id,
        );
        if (!located) {
          throw new Error('Created inert Run is unavailable.');
        }
        const run =
          this.dependencies.runRegistry.get(materialized.run.agentic_session_id) ??
          this.dependencies.runRegistry.create(createRunArgsFromSession(located.agenticSession));
        run.admitInitialInertInput();
      }
      try {
        await this.dependencies.messageService.sendMessage(
          materialized.run.agentic_session_id,
          firstTurnRequest,
        );
        if (firstTurnCompletion === 'settled') {
          await this.dependencies.runRegistry.get(materialized.run.agentic_session_id)?.awaitIdle();
        }
        this.dependencies.logger.debug('local.service.create_run.first_turn_dispatch.succeeded', {
          runId: materialized.run.agentic_session_id,
          promptType,
          firstTurnCompletion,
        });
      } catch (error) {
        if (input.attachments.length > 0) throw error;
        this.dependencies.logger.error('local.service.create_run.first_turn_dispatch.failed', {
          runId: materialized.run.agentic_session_id,
          promptType,
          error,
        });
      }
    }

    const refreshed = await this.dependencies.runService.getRun(
      materialized.run.agentic_session_id,
    );
    return {
      status: 'started',
      run: refreshed.run ?? materialized.run,
    };
  }
}
