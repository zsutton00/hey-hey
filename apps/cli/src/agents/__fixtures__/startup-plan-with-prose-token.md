```json
{
  "responseType": "startup_plan_v1",
  "sessionTitle": "Fold neighborhood updates into final_assessment prompt",
  "requiredServiceIds": ["service-1"],
  "primaryImplementations": [
    {
      "title": "Neighborhood update instructions",
      "content": "After assessment, update materially stale parent and child task descriptions through the available task-editing tools.",
      "language": "Markdown",
      "location": "Final assessment prompt / neighborhood updates",
      "rationale": "The prompt block is the behavior-defining implementation for this task."
    }
  ],
  "executionPlan": [
    {
      "stepId": "step-1",
      "title": "Audit current final_assessment prompt structure",
      "description": "Re-read src/agents/prompts/final-assessment.ts and src/agents/prompts/common.ts to confirm where the new 'After assessment: update neighborhood tasks' section belongs. The payload already carries parentTasks/childTasks via formatFinalAssessmentTaskNeighborhood at line 43, and the prompt already lists edit_task/edit_tasks among available tools — the new section only needs to add the behavioral rules.",
      "phase": 1,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "Task description asserts the neighborhood payload is already assembled server-side and no payload-shape change is required."
        }
      ]
    },
    {
      "stepId": "step-2",
      "title": "Recover deleted neighborhood content rules from git",
      "description": "Extract the content rules from the deleted buildNeighborhoodTaskUpdatesPrompt in commit fae90e6 (src/agents/prompts/neighborhood-task-updates.ts): child-task stub detection (empty/whitespace, single sentence, <2 paragraphs, missing Type Definition block), parent-task materiality gate, two-paragraph description format with Type Definition block, 'What you get' / 'What you don't get' acceptance criteria structure, and the parent-task surgical-edit rule. These become the substance of the new prompt section.",
      "phase": 1,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "Acceptance criteria require the materiality gate, writing standards, and stub-detection rules to carry over from the deleted builder."
        }
      ]
    },
    {
      "stepId": "step-3",
      "title": "Add 'After assessment: update neighborhood tasks' section to final_assessment prompt",
      "description": "Insert a new section in src/agents/prompts/final-assessment.ts — placed after the existing Dependent Task Walk / Rules block and before the 'Response format' section — that instructs the agent to, after forming its assessment, walk payload.taskNeighborhood.parentTasks and childTasks and call edit_task (or edit_tasks for batches) on each neighbor whose description/acceptance criteria need material updates. Inline the stub-detection rules for child tasks, the materiality gate and surgical-edit rule for parent tasks, the two-paragraph description format (with Type Definition block when the task defines/modifies a data structure), and the 'What you get' / 'What you don't get' acceptance criteria structure. Explicitly state this is performed via MCP tool calls and does NOT alter the final_assessment_v2 response JSON — neighborhood edits land as proposals, not as an additional responseType.",
      "phase": 2,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "Primary implementation target; acceptance criteria specify prompt must instruct edit_task/edit_tasks calls on parent/child tasks with the preserved writing standards."
        }
      ]
    },
    {
      "stepId": "step-4",
      "title": "Leave response schema and dispatcher registry untouched",
      "description": "Confirm no changes to src/agents/response-schemas.ts or src/agents/response-dispatch.ts. The existing neighborhood_task_updates_v1 registry entry (response-dispatch.ts:258) and its Zod schema (response-schemas.ts:166) remain as a passthrough in case the agent ever emits that responseType, per the task's explicit instruction. The final_assessment_v2 schema stays unchanged.",
      "phase": 2,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "Acceptance criteria 'What you don't get' forbids changes to final_assessment_v2 schema or the response-dispatch registry."
        }
      ]
    },
    {
      "stepId": "step-5",
      "title": "Add/update prompt assertions in prompts.test.ts",
      "description": "Extend src/agents/prompts/prompts.test.ts to cover the final-assessment builder: assert the rendered prompt includes the new neighborhood-update section header, the edit_task/edit_tasks tool-call instruction, the child-stub detection wording, the parent materiality gate, the two-paragraph description format, and the 'What you get' / 'What you don't get' labels. Use the existing test harness and an input payload that populates parentTasks and childTasks.",
      "phase": 3,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "New prompt content requires test coverage to lock in the content rules that were previously enforced by the dedicated neighborhood-task-updates builder."
        }
      ]
    },
    {
      "stepId": "step-6",
      "title": "Run typecheck and prompt tests",
      "description": "Run pnpm typecheck and pnpm vitest run src/agents/prompts/prompts.test.ts (or the equivalent project test script) to confirm the prompt file still compiles and the new assertions pass.",
      "phase": 3,
      "references": [
        {
          "sourceType": "task",
          "sourceId": "73d6dcfc-86c4-4116-a585-88ccc43328c8",
          "rationale": "Implementation must not break build or existing prompt tests."
        }
      ]
    }
  ],
  "discrepancies": [],
  "clarificationQuestions": []
}
```
