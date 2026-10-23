/**
 * Minimal MCP-over-HTTP endpoint that exposes submission tools to a Claude
 * agent invocation.
 *
 * Implements just the JSON-RPC surface the Claude CLI's HTTP MCP client
 * exercises during a turn: `initialize`, `tools/list`, `tools/call`, and
 * `ping`. Responses are returned synchronously as `application/json`. There
 * is no SSE/streaming, no notifications, no resources/prompts —
 * submission-tool execution is a fire-once, request-response affair.
 *
 * The endpoint is mounted at `POST /mcp/submission-tools/:token`. The
 * `:token` resolves to a `SubmissionToolRegistration` that names the tools
 * available for this turn and the conversation those tools post into.
 *
 * Two tool variants are routed differently:
 *
 * - `'action'` tools: the handler invokes `execute()`, records the resulting
 *   completion on the active Run, and returns canned text to the agent. The
 *   Run flushes that completion at turn-end as the turn's terminal write, so
 *   it lands after the agent's trailing narrative rather than racing it. On a
 *   null-context registration (a resolver-classified non-agent turn) the
 *   dispatch refuses up front with an agent-readable tool result and records
 *   nothing. Invalid arguments and explicitly retryable `execute()` failures
 *   return to the agent without completing the node; unexpected execution
 *   failures still post an `ERROR` completion inline so the workflow engine
 *   is not left waiting — see `dispatchActionTool`.
 *
 * - `'pass_through'` tools: the handler resolves the active Run, invokes
 *   `execute({ runId, args, run })`, and returns the tool's MCP content
 *   verbatim. No action is posted; failures surface as JSON-RPC errors so
 *   the agent sees a typed failure instead of a silent swallow.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { Request, Response } from 'express';
import { MessagePoster } from '../../run/message-poster';
import { RunRegistry } from '../../run/run-registry';
import type { ServerLogger } from '../../server/logger';
import type { MessageStamp } from '../../run/types';
import { warnOnExternalAgentNodeIdMismatch } from './action-poster';
import { SubmissionToolRegistry, type SubmissionToolRegistration } from './registry';
import { isPassThroughTool, SubmissionToolCorrectableError } from './types';
import type {
  SubmissionToolAction,
  SubmissionToolCorrectableErrorResult,
  SubmissionToolCorrectableFinding,
  SubmissionToolDeclaration,
  SubmissionToolPassThroughResult,
} from './types';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'heyhey-submission-tools',
  version: '1.0.0',
} as const;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number | null;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

const success = (id: string | number | null, result: unknown): JsonRpcSuccess => ({
  jsonrpc: '2.0',
  id,
  result,
});

const failure = (
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcError => ({
  jsonrpc: '2.0',
  id,
  error: data === undefined ? { code, message } : { code, message, data },
});

const toolListEntry = (tool: SubmissionToolDeclaration) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
});

const submissionToolArgsAjv = new Ajv({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
  verbose: true,
});
addFormats(submissionToolArgsAjv);

const submissionToolArgValidators = new WeakMap<object, ValidateFunction>();

const appendJsonPointerSegment = (pointer: string, segment: string): string => {
  const escapedSegment = segment.replace(/~/g, '~0').replace(/\//g, '~1');
  return `${pointer}/${escapedSegment}`;
};

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_EXPECTED_DEPTH = 3;

/**
 * Render the value or object shape a schema determines, or null when the
 * schema does not pin one down concretely enough to state.
 */
const describeExpectedSchemaValue = (schema: unknown, depth = 0): string | null => {
  if (!isSchemaObject(schema) || depth > MAX_EXPECTED_DEPTH) return null;
  if ('const' in schema) return JSON.stringify(schema['const']);
  const enumValues = schema['enum'];
  if (Array.isArray(enumValues)) {
    return enumValues.length === 1
      ? JSON.stringify(enumValues[0])
      : `one of ${enumValues.map((value) => JSON.stringify(value)).join(', ')}`;
  }
  const branches = schema['oneOf'] ?? schema['anyOf'];
  if (Array.isArray(branches)) {
    const described = branches.map((branch) => describeExpectedSchemaValue(branch, depth + 1));
    if (described.some((value) => value === null)) return null;
    return described.length === 1 ? described[0]! : `one of ${described.join(' | ')}`;
  }
  const properties = schema['properties'];
  const required = schema['required'];
  if (schema['type'] === 'object' || isSchemaObject(properties)) {
    if (!Array.isArray(required) || !isSchemaObject(properties)) return 'an object';
    const entries = required.map((key) => {
      const value = describeExpectedSchemaValue(properties[String(key)], depth + 1);
      return `${JSON.stringify(key)}: ${value ?? 'any value'}`;
    });
    return entries.length ? `{ ${entries.join(', ')} }` : 'an object';
  }
  const type = schema['type'];
  if (typeof type === 'string') {
    const format = typeof schema['format'] === 'string' ? ` (${schema['format']})` : '';
    return `a ${type}${format}`;
  }
  return null;
};

const withExpected = (field: string, expected: string | null): string =>
  expected
    ? `Set ${field} to ${expected}, then retry.`
    : `Correct ${field} to satisfy the tool input schema, then retry.`;

const schemaFinding = (
  issue: ErrorObject,
): SubmissionToolCorrectableFinding & { field: string } => {
  let field = issue.instancePath;
  if (issue.keyword === 'additionalProperties') {
    const additionalProperty = issue.params['additionalProperty'];
    if (typeof additionalProperty === 'string') {
      field = appendJsonPointerSegment(field, additionalProperty);
    }
    return {
      field: field || '/',
      code: issue.keyword,
      reason: issue.message ?? 'must not contain additional properties',
      correction: `Remove the unexpected property at ${field || '/'} and retry.`,
    };
  }
  let expected: string | null = null;
  if (issue.keyword === 'required') {
    const missingProperty = issue.params['missingProperty'];
    if (typeof missingProperty === 'string') {
      field = appendJsonPointerSegment(field, missingProperty);
      const properties = isSchemaObject(issue.parentSchema)
        ? issue.parentSchema['properties']
        : undefined;
      if (isSchemaObject(properties)) {
        expected = describeExpectedSchemaValue(properties[missingProperty]);
      }
    }
  } else if (issue.keyword !== 'additionalProperties') {
    expected = describeExpectedSchemaValue(issue.parentSchema);
  }
  field ||= '/';
  return {
    field,
    code: issue.keyword,
    reason: issue.message ?? 'is invalid',
    correction: withExpected(field, expected),
  };
};

const validateToolArgs = (
  tool: Pick<SubmissionToolDeclaration, 'inputSchema' | 'correctArgumentFinding'>,
  args: Record<string, unknown>,
): ReadonlyArray<SubmissionToolCorrectableFinding> | null => {
  const schema = tool.inputSchema;
  let validate = submissionToolArgValidators.get(schema);
  if (!validate) {
    validate = submissionToolArgsAjv.compile(schema);
    submissionToolArgValidators.set(schema, validate);
  }
  if (validate(args)) return null;
  const findings = (validate.errors ?? []).map(schemaFinding);
  if (!tool.correctArgumentFinding) return findings;
  return findings.map((finding) => {
    const corrected = tool.correctArgumentFinding!(finding, args);
    return { ...corrected, field: finding.field };
  });
};

const correctableErrorResult = (input: {
  reason: string;
  findings: ReadonlyArray<SubmissionToolCorrectableFinding>;
}): SubmissionToolCorrectableErrorResult => ({
  content: [
    {
      type: 'text',
      text: [
        input.reason,
        ...input.findings.map((finding) => {
          const location = finding.field ?? finding.identity;
          return `${location}: ${finding.reason} ${finding.correction}`;
        }),
      ].join('\n'),
    },
  ],
  structuredContent: {
    status: 'correctable_rejection',
    reason: input.reason,
    findings: input.findings,
  },
  isError: true,
});

const isAction = (value: unknown): value is SubmissionToolAction =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>)['action'] === 'string';

const isPassThroughResult = (value: unknown): value is SubmissionToolPassThroughResult => {
  if (typeof value !== 'object' || value === null) return false;
  const content = (value as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return false;
  return content.every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)['type'] === 'string',
  );
};

const sortedToolNames = (tools: ReadonlyArray<SubmissionToolDeclaration>): string[] =>
  tools.map((tool) => tool.name).sort();

const activeToolSurfaceMismatchText = (input: {
  toolName: string;
  activeHandlerPromptType: string | null;
  availability: 'mounted_but_inactive' | 'absent';
}): string => {
  const turnDescription = input.activeHandlerPromptType
    ? `the current ${input.activeHandlerPromptType} turn`
    : 'the current turn';
  const availabilityText =
    input.availability === 'mounted_but_inactive'
      ? 'is mounted for this provider session but is not active'
      : 'is not mounted on the active Hey Hey submission-tool surface';
  return (
    `${input.toolName} ${availabilityText} for ${turnDescription}. ` +
    'This is a Hey Hey tool-surface mismatch, not a user rejection.'
  );
};

interface DispatchToolArgs {
  tool: SubmissionToolDeclaration;
  args: Record<string, unknown>;
  registration: SubmissionToolRegistration;
  id: string | number | null;
  res: Response;
}

export class SubmissionToolsHttpController {
  public constructor(
    private readonly registry: SubmissionToolRegistry,
    private readonly runRegistry: RunRegistry,
    poster: MessagePoster,
    private readonly logger: ServerLogger,
  ) {}

  /** Bound because Express receives this method as a route callback. */
  public readonly handle = async (req: Request, res: Response): Promise<void> => {
    const tokenParam = req.params['token'];
    const token = typeof tokenParam === 'string' ? tokenParam : null;
    if (!token) {
      res.status(400).json(failure(null, -32600, 'Missing token in URL path'));
      return;
    }

    const registration = this.registry.get(token);
    if (!registration) {
      res.status(404).json(failure(null, -32001, `Unknown submission-tools token: ${token}`));
      return;
    }

    const body = req.body as JsonRpcRequest | undefined;
    if (body?.jsonrpc !== '2.0' || typeof body.method !== 'string') {
      res.status(400).json(failure(body?.id ?? null, -32600, 'Invalid JSON-RPC request'));
      return;
    }

    const { id = null, method, params = {} } = body;

    try {
      switch (method) {
        case 'initialize':
          res.json(
            success(id, {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: SERVER_INFO,
            }),
          );
          return;

        case 'ping':
          res.json(success(id, {}));
          return;

        case 'tools/list':
          res.json(
            success(id, {
              tools: registration.tools.map(toolListEntry),
            }),
          );
          return;

        case 'tools/call': {
          const name = typeof params['name'] === 'string' ? params['name'] : null;
          const args =
            typeof params['arguments'] === 'object' && params['arguments'] !== null
              ? (params['arguments'] as Record<string, unknown>)
              : {};
          const activeRun = this.runRegistry.get(registration.runId);
          const activeHandler = activeRun?.activeTurn?.handler;
          const tool = name ? registration.tools.find((t) => t.name === name) : null;
          if (!tool) {
            if (name) {
              const activeHandlerPromptType = activeHandler?.promptType ?? null;
              const text = activeToolSurfaceMismatchText({
                toolName: name,
                activeHandlerPromptType,
                availability: 'absent',
              });
              this.logger.warn('local.submission_tools.tool_surface_mismatch', {
                runId: registration.runId,
                toolName: name,
                classification: 'tool_surface_mismatch',
                availability: 'absent',
                activeHandlerPromptType,
                activeToolSetSource: activeHandler
                  ? 'active_turn_handler_submissionTools'
                  : 'active_run_unavailable',
                mountedToolNames: sortedToolNames(registration.tools),
                activeSubmissionToolNames: activeHandler?.submissionTools
                  ? sortedToolNames(activeHandler.submissionTools)
                  : [],
              });
              res.json(failure(id, -32602, text));
              return;
            }
            res.json(failure(id, -32602, 'Missing tool name'));
            return;
          }
          const toolName = tool.name;
          if (
            activeRun?.activeTurn?.changedFileReporting.isRepairing &&
            toolName !== 'report_changed_files'
          ) {
            res.json(
              success(id, {
                content: [
                  {
                    type: 'text',
                    text: 'Only report_changed_files is permitted during reporting repair.',
                  },
                ],
                isError: true,
              }),
            );
            return;
          }

          // Base submission tools (e.g. the universal create_report wrapper) are always
          // callable regardless of the active handler. Per-handler tools remain gated to
          // the handler that owns them.
          if (
            activeHandler?.submissionTools &&
            !activeHandler.submissionTools.some((t) => t.name === toolName) &&
            !activeRun?.isBaseSubmissionTool?.(toolName)
          ) {
            res.json(
              success(id, {
                content: [
                  {
                    type: 'text',
                    text: activeToolSurfaceMismatchText({
                      toolName,
                      activeHandlerPromptType: activeHandler.promptType,
                      availability: 'mounted_but_inactive',
                    }),
                  },
                ],
                isError: true,
              }),
            );
            this.logger.warn('local.submission_tools.tool_surface_mismatch', {
              runId: registration.runId,
              toolName,
              classification: 'tool_surface_mismatch',
              availability: 'mounted_but_inactive',
              activeHandlerPromptType: activeHandler.promptType,
              activeToolSetSource: 'active_turn_handler_submissionTools',
              mountedToolNames: sortedToolNames(registration.tools),
              activeSubmissionToolNames: sortedToolNames(activeHandler.submissionTools),
            });
            return;
          }

          const validationFindings = validateToolArgs(tool, args);
          if (validationFindings) {
            this.logger.warn('local.submission_tools.arguments_rejected', {
              runId: registration.runId,
              toolName,
              findings: validationFindings,
            });
            res.json(
              success(
                id,
                correctableErrorResult({
                  reason: `${toolName} input did not match its declared schema.`,
                  findings: validationFindings,
                }),
              ),
            );
            return;
          }

          if (isPassThroughTool(tool)) {
            await this.dispatchPassThroughTool({
              tool,
              args,
              registration,
              id,
              res,
            });
            return;
          }

          await this.dispatchActionTool({
            tool,
            args,
            registration,
            id,
            res,
          });
          return;
        }

        default:
          res.json(failure(id, -32601, `Method not found: ${method}`));
          return;
      }
    } catch (error) {
      this.logger.error('local.submission_tools.endpoint_error', {
        token,
        method,
        error,
      });
      res.json(failure(id, -32603, error instanceof Error ? error.message : 'Internal error'));
    }
  };

  private async dispatchActionTool({
    tool,
    args,
    registration,
    id,
    res,
  }: DispatchToolArgs): Promise<void> {
    if (isPassThroughTool(tool)) return;

    // `'action'` tools complete an EXTERNAL_AGENT node. The completion identity
    // is the atomic `(externalAgentNodeId, triggerMessageId)` pair: it is either
    // fully present (the turn is answering a pending agent node) or fully null
    // (the resolver classified this turn as non-agent — the workflow is waiting
    // on a user gate or has finished, so no node awaits a completion).
    //
    // A fully-null registration is the SANCTIONED state for a non-agent turn, so
    // instead of posting a completion we hand the agent a readable refusal it
    // can act on — this is what makes fabricated progress narration structurally
    // impossible: the attempt fails at the source, loudly, with an explanation.
    // A half-populated pair can only mean the atomic-pair invariant was broken
    // upstream, which is a genuine bug worth paging on.
    //
    // This early return precedes ERROR-completion synthesis: a null-context
    // refusal must never reach the action-poster, so nothing is posted to the
    // conversation.
    if (!registration.externalAgentNodeId || !registration.triggerMessageId) {
      const sanctioned =
        registration.externalAgentNodeId === null && registration.triggerMessageId === null;
      if (sanctioned) {
        this.logger.info('local.submission_tools.completion_refused_non_agent_turn', {
          runId: registration.runId,
          toolName: tool.name,
          classification: 'non_agent_turn',
        });
      } else {
        this.logger.error('local.submission_tools.completion_context_partial', {
          runId: registration.runId,
          toolName: tool.name,
          classification: 'partial_context',
          hasExternalAgentNodeId: registration.externalAgentNodeId !== null,
          hasTriggerMessageId: registration.triggerMessageId !== null,
        });
      }
      res.json(
        success(id, {
          content: [
            {
              type: 'text',
              text:
                `No workflow node is awaiting a completion from you on this turn, so ${tool.name} ` +
                `cannot post one. Report your actual status directly to the user in your reply — do ` +
                `not claim work was submitted or narrate progress that did not happen.`,
            },
          ],
          isError: true,
        }),
      );
      return;
    }

    // Resolve the active Run up-front so action tools that need to mutate
    // Run-scoped state during execute can read it via `ctx.run`.
    // Pass-through tools share the same lookup further down. When getRun is
    // unavailable (action-only test fixtures omit it) or the Run cannot be
    // resolved, the field is absent on the ctx — action tools that don't
    // need it are unaffected.
    const run = this.runRegistry.get(registration.runId);

    if (run?.hasRecordedCompletion(registration.triggerMessageId)) {
      this.logger.info('local.submission_tools.completion_already_recorded', {
        runId: registration.runId,
        toolName: tool.name,
        triggerMessageId: registration.triggerMessageId,
      });
      res.json(
        success(id, {
          content: [
            {
              type: 'text',
              text: 'This trigger already has a terminal completion. End this turn; do not submit again.',
            },
          ],
          isError: true,
        }),
      );
      return;
    }

    let action: SubmissionToolAction;
    try {
      const ctx = run
        ? {
            runId: registration.runId,
            triggerMessageId: registration.triggerMessageId,
            args,
            run,
          }
        : {
            runId: registration.runId,
            triggerMessageId: registration.triggerMessageId,
            args,
          };
      const result = await tool.execute(ctx);
      if (!isAction(result)) {
        throw new Error(
          'Submission tool execute() must return an object with a string `action` field',
        );
      }
      action = result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';

      if (error instanceof SubmissionToolCorrectableError) {
        this.logger.warn('local.submission_tools.correctable_rejected', {
          runId: registration.runId,
          toolName: tool.name,
          reason: error.reason,
          findings: error.findings,
        });
        res.json(
          success(
            id,
            correctableErrorResult({
              reason: error.reason,
              findings: error.findings,
            }),
          ),
        );
        return;
      }

      this.logger.error('local.submission_tools.execute_failed', {
        runId: registration.runId,
        toolName: tool.name,
        error,
      });

      // Defer an ERROR completion until turn-end so the workflow engine sees the failure
      // instead of waiting forever on a node whose only signal would have been
      // a successful action. `externalAgentNodeId` / `triggerMessageId` are
      // guaranteed non-null here: the early-return above refuses the dispatch
      // when either is null.
      const errorAction: SubmissionToolAction = { action: 'ERROR' };
      const activeTurnForError = run?.activeTurn ?? null;
      const errorStamp: MessageStamp | null = activeTurnForError
        ? {
            providerSessionId: run?.providerSessionId ?? null,
            promptHandler: activeTurnForError.handler.promptType,
          }
        : null;
      if (run) {
        run.recordPendingCompletion({
          externalAgentNodeId: registration.externalAgentNodeId,
          triggerMessageId: registration.triggerMessageId,
          action: errorAction,
          userFacingResponse: errorMessage,
          stamp: errorStamp,
        });
        run.setLastSubmissionAction(errorAction);
      }

      res.json(failure(id, -32603, errorMessage));
      return;
    }

    // Resolve the active Turn for this Run so the seam can stamp
    // providerSessionId / promptHandler onto the completion. The registry no
    // longer carries these per-Turn fields; the Run is the single source of
    // truth. When getRun is unavailable (action-only test fixtures omit it)
    // or the Run has no active Turn, post without a stamp — the user-decision
    // dispatch path lands here for the same reason.
    const activeTurn = run?.activeTurn ?? null;
    const stamp: MessageStamp | null = activeTurn
      ? {
          providerSessionId: run?.providerSessionId ?? null,
          promptHandler: activeTurn.handler.promptType,
        }
      : null;

    const runStampedNodeId = run?.triggerContext?.externalAgentNodeId ?? null;
    warnOnExternalAgentNodeIdMismatch(this.logger, {
      site: 'submission-tools.dispatchActionTool',
      runId: registration.runId,
      declaredNodeId: registration.externalAgentNodeId,
      runStampedNodeId,
      triggerMessageId: registration.triggerMessageId,
      action: action.action,
    });

    // Posting the completion inline — mid-stream, before the agent's trailing
    // assistant message — races the narrative to the conversation tail and can
    // create the workflow's review gate ahead of the agent's final words.
    // Instead, record the completion on the Run and return success to the agent
    // now; the Run flushes it at turn-end as the turn's terminal write, after
    // the trailing narrative has landed. The completion needs the active Run to
    // defer to — without it there is nowhere to record, so surface a typed
    // failure rather than fall back to an inline post that reintroduces the
    // race. In production `getRun` always resolves the in-flight Run.
    if (!run) {
      this.logger.error('local.submission_tools.action_no_run', {
        runId: registration.runId,
        toolName: tool.name,
        action: action.action,
      });
      res.json(
        failure(
          id,
          -32603,
          `Action tool ${tool.name} could not resolve the active Run to record its completion`,
        ),
      );
      return;
    }

    run.recordPendingCompletion({
      action,
      externalAgentNodeId: registration.externalAgentNodeId,
      triggerMessageId: registration.triggerMessageId,
      ...(tool.userFacingResponse !== undefined
        ? { userFacingResponse: tool.userFacingResponse }
        : {}),
      ...(tool.hidden === true ? { hidden: true } : {}),
      stamp,
    });

    this.logger.info('local.submission_tools.recorded', {
      runId: registration.runId,
      toolName: tool.name,
      action: action.action,
      completesTriggerMessageId: registration.triggerMessageId,
      externalAgentNodeId: registration.externalAgentNodeId,
      conversationId: registration.conversationId,
    });

    // Keep the action result on its owning Run. The controller already resolved
    // that object to record the pending completion, so no callback is tunneled
    // through the registry.
    run.setLastSubmissionAction(action);

    res.json(
      success(id, {
        content: [
          {
            type: 'text',
            text: `Recorded completion with action=${action.action}.`,
          },
        ],
      }),
    );
  }

  private async dispatchPassThroughTool({
    tool,
    args,
    registration,
    id,
    res,
  }: DispatchToolArgs): Promise<void> {
    if (!isPassThroughTool(tool)) return;

    const run = this.runRegistry.get(registration.runId);
    if (!run) {
      this.logger.error('local.submission_tools.pass_through_run_not_found', {
        runId: registration.runId,
        toolName: tool.name,
      });
      res.json(failure(id, -32603, `Pass-through tool ${tool.name} could not resolve active Run`));
      return;
    }

    if (!run.projectId || !run.conversationId || !run.organizationId) {
      this.logger.error('local.submission_tools.pass_through_run_values_missing', {
        runId: registration.runId,
        organizationId: run.organizationId,
        projectId: run.projectId,
        conversationId: run.conversationId,
      });
      res.json(
        failure(id, -32603, `Pass-through tool ${tool.name} could not resolve required Run values`),
      );
      return;
    }

    let result: SubmissionToolPassThroughResult;
    try {
      const raw = await tool.execute({ runId: registration.runId, args, run });
      if (!isPassThroughResult(raw)) {
        throw new Error(
          'Pass-through tool execute() must return { content: [{ type, ... }, ...] }',
        );
      }
      result = raw;
    } catch (error) {
      if (error instanceof SubmissionToolCorrectableError) {
        this.logger.warn('local.submission_tools.correctable_rejected', {
          runId: registration.runId,
          toolName: tool.name,
          reason: error.reason,
          findings: error.findings,
        });
        res.json(
          success(
            id,
            correctableErrorResult({
              reason: error.reason,
              findings: error.findings,
            }),
          ),
        );
        return;
      }
      this.logger.error('local.submission_tools.pass_through_failed', {
        runId: registration.runId,
        toolName: tool.name,
        error,
      });
      res.json(
        failure(
          id,
          -32603,
          error instanceof Error ? error.message : 'Pass-through tool execution failed',
        ),
      );
      return;
    }

    this.logger.info('local.submission_tools.pass_through_returned', {
      runId: registration.runId,
      toolName: tool.name,
      contentBlocks: result.content.length,
    });

    res.json(
      success(id, {
        content: result.content,
      }),
    );
  }
}
