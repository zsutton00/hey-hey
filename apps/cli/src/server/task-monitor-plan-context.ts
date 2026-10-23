import { z } from 'zod';
import {
  canonicalContextSchema,
  workItemEntitySchema,
} from '../agents/entity-context/entity-context-loader';
import type { TaskResponseDto } from '../shared/api/generated/api';
import type { TaskMonitorPlanGuidance } from '../shared/agent-bridge-contract/generated/api';
import { loadPlanDesignDoc } from './load-plan-design-doc';
import type { ServerLogger } from './logger';

const envelopeSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({ data: schema }).passthrough();

export interface TaskMonitorPlanContextDependencies {
  apiBaseUrl: string;
  fetchImpl: typeof fetch;
  logger: ServerLogger;
}

export interface ResolveTaskMonitorPlanContextInput {
  organizationId: string;
  projectId: string;
  taskId: string;
  accessToken: string;
}

const encode = (value: string): string => encodeURIComponent(value);

const workItemUrl = (base: string, id: string, includeEdges = false): string => {
  const url = new URL(`${base}/work-items/${encode(id)}`);
  if (includeEdges) url.searchParams.set('includeEdges', 'true');
  return url.toString();
};

const sectionValue = (workItem: TaskResponseDto, key: string): string | undefined =>
  workItem.sections?.find((section) => section.key === key)?.materializedMarkdown;

const requiredSection = (workItem: TaskResponseDto, key: string, role: string): string => {
  const value = sectionValue(workItem, key)?.trim();
  if (!value) throw new Error(`${role} is missing its required ${key} section.`);
  return value;
};

export class TaskMonitorPlanContext {
  private readonly baseUrl: string;

  public constructor(private readonly dependencies: TaskMonitorPlanContextDependencies) {
    this.baseUrl = dependencies.apiBaseUrl.replace(/\/$/u, '');
  }

  public async resolve(
    input: ResolveTaskMonitorPlanContextInput,
  ): Promise<TaskMonitorPlanGuidance | null> {
    const projectBase =
      `${this.baseUrl}/organizations/${encode(input.organizationId)}` +
      `/projects/${encode(input.projectId)}`;
    const context = await this.read(
      `${projectBase}/entities/TASK/${encode(input.taskId)}/context`,
      'selected Task plan context',
      envelopeSchema(canonicalContextSchema),
      input.accessToken,
    );
    if (context.data.entityId !== input.taskId || context.data.entityType !== 'TASK') {
      throw new Error('Selected Task plan context returned a different canonical Task.');
    }
    const planContext = context.data.planContext;
    const planRef = planContext?.parentPlan;
    const stageRef = planContext?.parentStage;
    if (!planRef) {
      this.dependencies.logger.debug('task_monitor.plan_context.not_planned', {
        taskId: input.taskId,
      });
      return null;
    }
    if (!stageRef) {
      this.dependencies.logger.warn('task_monitor.plan_context.topology_invalid', {
        taskId: input.taskId,
        planId: planRef.id,
        hasStage: false,
      });
      throw new Error('Selected Task Plan context did not contain its parent PLAN_STAGE Task.');
    }

    const [planEnvelope, stageEnvelope, taskEnvelope] = await Promise.all([
      this.read(
        workItemUrl(projectBase, planRef.id),
        'selected PLAN Task',
        envelopeSchema(workItemEntitySchema),
        input.accessToken,
      ),
      this.read(
        workItemUrl(projectBase, stageRef.id),
        'selected PLAN_STAGE Task',
        envelopeSchema(workItemEntitySchema),
        input.accessToken,
      ),
      this.read(
        workItemUrl(projectBase, input.taskId, true),
        'selected execution Task',
        envelopeSchema(workItemEntitySchema),
        input.accessToken,
      ),
    ]);
    const plan = planEnvelope.data;
    const stage = stageEnvelope.data;
    const task = taskEnvelope.data;
    if (plan.id !== planRef.id || plan.type !== 'PLAN') {
      throw new Error('Selected PLAN context did not resolve to a PLAN Task.');
    }
    if (stage.id !== stageRef.id || stage.type !== 'PLAN_STAGE') {
      throw new Error('Selected PLAN_STAGE context did not resolve to a PLAN_STAGE Task.');
    }
    if (task.id !== input.taskId) {
      throw new Error('Selected execution Task read returned a different Task.');
    }
    const designDoc = await this.resolveDesignDoc({
      organizationId: input.organizationId,
      projectId: input.projectId,
      planTaskId: plan.id,
      accessToken: input.accessToken,
    });
    const planDescription = sectionValue(plan, 'description')?.trim();
    const stageDescription = sectionValue(stage, 'description')?.trim();
    const taskDescription = sectionValue(task, 'description')?.trim();

    const result: TaskMonitorPlanGuidance = {
      plan: {
        id: plan.id,
        title: plan.name,
        ...(planDescription ? { description: planDescription } : {}),
        outcome: requiredSection(plan, 'outcome', 'PLAN Task'),
      },
      ...(designDoc ? { designDoc } : {}),
      stage: {
        id: stage.id,
        title: stage.name,
        ...(stageDescription ? { description: stageDescription } : {}),
      },
      step: {
        id: task.id,
        title: task.name,
        ...(taskDescription ? { description: taskDescription } : {}),
      },
    };
    this.dependencies.logger.debug('task_monitor.plan_context.resolved', {
      taskId: input.taskId,
      planId: plan.id,
      designDocId: designDoc?.id ?? null,
      stageId: stage.id,
      stepId: task.id,
    });
    return result;
  }

  private async resolveDesignDoc(input: {
    organizationId: string;
    projectId: string;
    planTaskId: string;
    accessToken: string;
  }): Promise<TaskMonitorPlanGuidance['designDoc'] | null> {
    try {
      const designDoc = await loadPlanDesignDoc(this.dependencies, {
        organizationId: input.organizationId,
        projectId: input.projectId,
        taskId: input.planTaskId,
        accessToken: input.accessToken,
      });
      if (!designDoc) {
        this.dependencies.logger.warn('task_monitor.plan_context.design_doc_unavailable', {
          planTaskId: input.planTaskId,
        });
      }
      return designDoc;
    } catch (error) {
      this.dependencies.logger.warn('task_monitor.plan_context.design_doc_read_failed', {
        planTaskId: input.planTaskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private async read<T>(
    url: string,
    action: string,
    schema: z.ZodType<T>,
    accessToken: string,
  ): Promise<T> {
    this.dependencies.logger.debug('task_monitor.plan_context.read_started', { action, url });
    const response = await this.dependencies.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const responseText = await response.text();
    if (!response.ok) {
      this.dependencies.logger.warn('task_monitor.plan_context.read_http_failed', {
        action,
        url,
        status: response.status,
      });
      throw new Error(
        `${action} failed (${String(response.status)}): ${responseText.slice(0, 500)}`,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      this.dependencies.logger.warn('task_monitor.plan_context.read_json_failed', { action, url });
      throw new Error(`${action} returned malformed JSON.`);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(({ code, path }) => `${path.join('.')} ${code}`);
      this.dependencies.logger.warn('task_monitor.plan_context.read_validation_failed', {
        action,
        url,
        issues,
      });
      throw new Error(`${action} failed boundary validation: ${issues.join('; ')}`);
    }
    this.dependencies.logger.debug('task_monitor.plan_context.read_completed', { action, url });
    return parsed.data;
  }
}
