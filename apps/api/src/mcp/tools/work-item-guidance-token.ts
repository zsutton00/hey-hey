import { createHash } from 'crypto';

/**
 * Proof-of-read token for the generic work-item authoring tools.
 *
 * `get_tool_guidance({ toolName, workItemType, projectId })` returns this token
 * alongside the project-scoped per-type writing standards it serves.
 * `create_work_item` /
 * `edit_work_item` then require a matching token whenever the proposal carries
 * prose-quality fields (a non-empty `sections` array or a non-empty
 * `implementation` string), so an agent cannot author sections without having
 * read the conventions the guidance body exists to teach.
 *
 * The token is a deterministic proof for the project-scoped guidance snapshot
 * identified by `(projectId, typeKey)` — no session store. Both the issuing
 * site (the guidance provider) and the validating site (the proposal handlers)
 * compute it from the same function, so issuance and validation never need to
 * share state. Including the project scope is required because canonical and
 * custom definitions are both materialized per project and their writing
 * standards may differ between projects.
 */

// Versioned salt: bumping it rotates every token at once, which lets us force a
// re-read across all types if the guidance contract changes materially.
const TOKEN_SALT = 'heyhey:get_tool_guidance:proof-of-read:v2';

/**
 * The field name agents pass the token under on create_work_item /
 * edit_work_item. Centralized so the schema, the error messages, and any
 * future caller name it identically.
 */
export const GUIDANCE_TOKEN_FIELD = 'guidanceToken';

/**
 * Normalize a type key so casing differences between the `workItemType` an
 * agent passes to `get_tool_guidance` and the canonical type resolved
 * server-side on the proposal never cause a spurious mismatch. Type keys are
 * conventionally upper-cased; this makes that convention non-load-bearing.
 */
function normalizeTypeKey(typeKey: string): string {
  return typeKey.trim().toUpperCase();
}

/**
 * The proof-of-read token for a project-scoped work-item type. It is
 * deterministic in the normalized project and type keys, independent of tool,
 * session, or time, so one token covers both create and edit within that
 * project without any persisted state.
 */
export function guidanceTokenForType(
  typeKey: string,
  projectId: string,
): string {
  const normalizedType = normalizeTypeKey(typeKey);
  const normalizedProject = projectId.trim().toLowerCase();
  const digest = createHash('sha256')
    .update(`${TOKEN_SALT}:${normalizedProject}:${normalizedType}`)
    .digest('hex')
    .slice(0, 12);
  return `gtg-${normalizedType.toLowerCase()}-${digest}`;
}

/**
 * True when a proposal payload carries the prose-quality content the token
 * gate protects:
 *   - a non-empty `sections` array, or
 *   - a non-empty (post-trim) `implementation` string, or
 *   - `requirementProse` — FEATURE requirement authoring (a non-empty
 *     `initialRequirements` on create or a non-empty `requirementOps` on edit),
 *     which the caller resolves and passes as a boolean since the two carry
 *     different shapes. FEATURE requirements have their own writing conventions
 *     (statement voice, cite-fulfillment, no embedded edges) that the guidance
 *     body teaches, so touching them engages the same proof-of-read tax.
 *
 * Scalar-only edits — status, assignee, priority, parent, due date, tag —
 * return false and stay token-free.
 */
export function carriesProseQualityFields(payload: {
  sections?: ReadonlyArray<unknown> | undefined;
  implementation?: string | undefined;
  requirementProse?: boolean | undefined;
}): boolean {
  const hasSections =
    Array.isArray(payload.sections) && payload.sections.length > 0;
  const hasImplementation =
    typeof payload.implementation === 'string' &&
    payload.implementation.trim().length > 0;
  return hasSections || hasImplementation || payload.requirementProse === true;
}

/**
 * Validate the proof-of-read token for a work-item proposal. Returns null when
 * the call is allowed (no prose-quality fields, or a matching token), and a
 * structured, agent-actionable error string otherwise — one that names the
 * exact `get_tool_guidance` call to make to obtain a valid token.
 *
 * `type` is the resolved work-item type the call will be enforced against:
 * `params.type` on create, the target entity's server-resolved type on edit.
 * `projectId` is the request's authoritative project scope. Validating against
 * both resolved values means an agent that read guidance for the wrong type or
 * project is corrected even though it presented a syntactically valid token.
 */
export function validateGuidanceToken(args: {
  toolName: 'create_work_item' | 'edit_work_item';
  type: string;
  projectId: string;
  token: string | undefined;
  sections?: ReadonlyArray<unknown> | undefined;
  implementation?: string | undefined;
  requirementProse?: boolean | undefined;
}): string | null {
  const { toolName, type, projectId, token } = args;
  if (
    !carriesProseQualityFields({
      sections: args.sections,
      implementation: args.implementation,
      requirementProse: args.requirementProse,
    })
  ) {
    return null;
  }

  const retryCall = `get_tool_guidance({ toolName: "${toolName}", workItemType: "${type}" })`;
  const expected = guidanceTokenForType(type, projectId);

  if (!token || !token.trim()) {
    return (
      `${toolName} requires a ${GUIDANCE_TOKEN_FIELD} when the proposal ` +
      `carries prose-quality content (sections, implementation, or FEATURE ` +
      `requirement authoring). Call ${retryCall} to read the ${type} ` +
      `authoring conventions and obtain the token, then pass it back as ` +
      `${GUIDANCE_TOKEN_FIELD}. The token is scoped to project ${projectId}.`
    );
  }

  if (token.trim() !== expected) {
    return (
      `${GUIDANCE_TOKEN_FIELD} "${token.trim()}" does not match the ${type} ` +
      `proof-of-read token for project ${projectId}. This token is scoped to ` +
      `the project and work-item type — read the conventions for the type you ` +
      `are authoring by calling ${retryCall}, then pass the token it returns.`
    );
  }

  return null;
}
