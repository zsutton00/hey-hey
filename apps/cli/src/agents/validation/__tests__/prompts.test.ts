import { describe, expect, it } from 'vitest';
import { buildValidationWalkthroughPrompt } from '../prompts';
import { LocalValidationWalkthroughPromptPayloadScopeEnum } from '../../../shared/agent-bridge-contract/generated/api';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_TASK_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_STAGE_ID = '33333333-3333-4333-8333-333333333333';

describe('buildValidationWalkthroughPrompt', () => {
  describe('shared guidance', () => {
    it('marks the agent as strictly read-only with no Bash, no HTTP, no platform mutations', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toMatch(/strictly read-only/i);
      expect(prompt).toMatch(/do not run bash/i);
      expect(prompt).toMatch(/do not call any HTTP endpoint/i);
      expect(prompt).toMatch(/do not edit, create, or delete/i);
    });

    it('describes the report payload shape (validationSteps with title, description, actions)', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toContain('VALIDATION_WALKTHROUGH');
      expect(prompt).toContain('validationSteps');
      expect(prompt).toContain('`title`');
      expect(prompt).toContain('`description`');
      expect(prompt).toContain('`actions`');
      expect(prompt).toContain('`command_line`');
      expect(prompt).toContain('`command`');
      expect(prompt).toContain('`workingDirectory`');
    });

    it('terminates by emitting the report — no submission tool', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toMatch(/turn ends as soon as `create_report` succeeds/i);
      expect(prompt).toMatch(/there is no submission tool/i);
    });

    it('points the agent at list_reports_by_entity for context gathering', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toContain('list_reports_by_entity');
      expect(prompt).toContain('get_report_body');
    });
  });

  describe('scope: task', () => {
    it('frames the in-scope entity as a single task and inlines its id', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toMatch(/Launch context: single task/);
      expect(prompt).toContain(TASK_ID);
      expect(prompt).toMatch(/list_reports_by_entity[\s\S]{0,120}entityType:\s*"TASK"/);
      expect(prompt).toMatch(/do not branch into upstream or sibling tasks/i);
    });

    it('does not include parent_task or plan_stage scope sections', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).not.toMatch(/Launch context: parent task with split children/);
      expect(prompt).not.toMatch(/Launch context: plan stage/);
    });
  });

  describe('scope: parent_task', () => {
    it('frames the in-scope entity as a parent task and requires explicit integration-seam checks', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.ParentTask,
        entityId: PARENT_TASK_ID,
      });
      expect(prompt).toMatch(/Launch context: parent task with split children/);
      expect(prompt).toContain(PARENT_TASK_ID);
      expect(prompt).toMatch(/enumerate its split children/i);
      expect(prompt).toMatch(/integration seams across the children/i);
      expect(prompt).toMatch(/cross-child integration checks must be explicit/i);
    });

    it('walks both the parent and each child task for reports', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.ParentTask,
        entityId: PARENT_TASK_ID,
      });
      expect(prompt).toContain('get_context');
      expect(prompt).toContain('list_reports_by_entity');
      expect(prompt).toMatch(/for each split child task, pull its plan and implement reports/i);
    });

    it('does not include single-task or plan_stage scope sections', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.ParentTask,
        entityId: PARENT_TASK_ID,
      });
      expect(prompt).not.toMatch(/Launch context: single task/);
      expect(prompt).not.toMatch(/Launch context: plan stage/);
    });
  });

  describe('scope: plan_stage', () => {
    it('frames the in-scope entity as a plan stage and pulls design doc plus per-step reports', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.PlanStage,
        entityId: PLAN_STAGE_ID,
      });
      expect(prompt).toMatch(/Launch context: plan stage/);
      expect(prompt).toContain(PLAN_STAGE_ID);
      expect(prompt).toMatch(
        /get_context[\s\S]{0,120}entityType:\s*"TASK"[\s\S]{0,80}entityId:\s*"33333333-3333-4333-8333-333333333333"/,
      );
      expect(prompt).not.toContain('get_plan_stage');
      expect(prompt).toMatch(/plan design doc/i);
      expect(prompt).toMatch(
        /for every step in the stage, pull both the plan report and the implement report/i,
      );
    });

    it('uses get_full_entity for the design doc and list_reports_by_entity for step reports', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.PlanStage,
        entityId: PLAN_STAGE_ID,
      });
      expect(prompt).toContain('get_full_entity');
      expect(prompt).toContain('list_reports_by_entity');
    });

    it('does not include single-task or parent_task scope sections', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.PlanStage,
        entityId: PLAN_STAGE_ID,
      });
      expect(prompt).not.toMatch(/Launch context: single task/);
      expect(prompt).not.toMatch(/parent task with split children/i);
    });
  });

  describe('snapshot — task scope', () => {
    it('matches the locked prompt body for a single-task launch', () => {
      const prompt = buildValidationWalkthroughPrompt({
        scope: LocalValidationWalkthroughPromptPayloadScopeEnum.Task,
        entityId: TASK_ID,
      });
      expect(prompt).toMatchInlineSnapshot(`
        "You are the validation agent. Your job is to author a single \`VALIDATION_WALKTHROUGH\` report describing the ordered steps a human or follow-up agent can replay to confirm a piece of work behaves as intended.

        ## How to work

        - You are strictly read-only. Do not run Bash. Do not call any HTTP endpoint. Do not edit, create, or delete any platform entity. Your one mutation is the final \`create_report\` call that lands the VALIDATION_WALKTHROUGH report.
        - Gather context exclusively through the platform MCP tools listed below — \`list_reports_by_entity\`, \`get_report_body\`, \`get_context\`, and \`get_full_entity\` where relevant.
        - The launch context (scope + entityId) names the in-scope work. Treat it as authoritative: do not validate adjacent or upstream work that wasn't called for.
        - The turn ends as soon as \`create_report\` succeeds. There is no submission tool, no follow-up question, and no task-complete narrative — the report is the deliverable.

        ## Authoring the report

        1. Call \`get_report_schema\` with \`reportType: "VALIDATION_WALKTHROUGH"\` to retrieve the canonical payload shape.
        2. Call \`create_report\` with:
           - \`reportType: "VALIDATION_WALKTHROUGH"\`
           - \`audience: "PROJECT_VISIBLE"\`
           - \`payload\` — match the schema returned in step 1. Set \`reportType: "VALIDATION_WALKTHROUGH"\` and \`validationSteps\` to an ordered array of steps. Each step has:
             - \`title\` — short imperative label (e.g. "Run the new test").
             - \`description\` — one or two sentences naming what the step proves about the work and how to interpret its output.
             - \`actions\` — ordered list of executable actions. Today only \`command_line\` actions are supported: each carries a \`command\` (the shell command to execute) and optionally a \`workingDirectory\` (repo-relative; omit for the service root).
           - \`entities\` — at minimum a PRIMARY entity entry for the in-scope id (use the entity type that matches the scope: TASK for \`task\`, TASK for \`parent_task\`, TASK for \`plan_stage\`).
        3. If \`create_report\` returns a validation error, fix the payload and retry.

        ## What to put in the steps

        - Cover the behavior actually delivered by the in-scope work, not the broader feature. Read the implement and plan reports to know what shipped.
        - Prefer concrete, idempotent commands a reader can copy-paste: \`pnpm test path/to/foo.test.ts\`, \`pnpm typecheck\`, \`pnpm lint\`, targeted greps against shipped files, etc.
        - When a step exercises a UI or HTTP surface, describe the manual check in the \`description\` and put any helper command (server start, log tail) in the \`actions\`.
        - Order steps from cheapest to most expensive — type checks and unit tests before integration runs before manual UI exercise.
        - Do not invent verification for behavior the reports don't claim. If the reports show a piece of work didn't ship, omit that step rather than fabricating one.

        ## Launch context: single task

        The in-scope entity is task \`11111111-1111-4111-8111-111111111111\`. Pull every plan and implement report attached to that task via \`list_reports_by_entity\` with \`entityType: "TASK"\` and \`entityId: "11111111-1111-4111-8111-111111111111"\`. Read the report bodies in full with \`get_report_body\` when their list-row summaries aren't enough to know what shipped.

        Author validation steps that exercise the behavior the implement reports claim was delivered — the touched files, the new tests, the new UI surfaces, the new API contracts. Do not branch into upstream or sibling tasks unless their reports are explicitly cross-referenced.
        "
      `);
    });
  });
});
