-- Shared role advice only. Complete project overrides remain authoritative.
DO $migration$
DECLARE
  advice jsonb := $advice$
{
  "FEATURE": {
    "implementation": "Read the Feature before changing affected behavior and identify the requirements applicable to this task. Treat those requirements as binding outcomes. Implement them and add or update tests for the requirements affected by added or changed behavior, using integration tests where needed. Compare the result with the requirements before declaring completion; raise conflicts rather than silently departing.",
    "research": "Read the Feature and identify requirements relevant to the investigation. Distinguish the intended capability from evidence of actual delivery. Investigate fulfillment and gaps against those requirements; do not infer fulfillment from task status or implementation presence.",
    "planning": "Read applicable Feature requirements before defining the solution. Carry each affected requirement into the work that fulfills it and its verification criteria. Plan tests for added or changed required behavior, including integration tests where needed. Surface conflicts or missing coverage before proceeding with a departure.",
    "review": "Read the Feature and identify requirements applicable to the delivered work. Compare behavior and test evidence against those requirements, not task completion alone. Check that added or changed required behavior has meaningful coverage, including integration tests where needed. Report unmet requirements and missing evidence explicitly."
  },
  "STANDARD": {
    "research": "Trace intended changes and implementation history; distinguish planned from delivered.",
    "planning": "Check existing coverage, dependencies and duplication.",
    "review": "Compare outcome with scope and acceptance criteria."
  },
  "BUG": {
    "implementation": "Correct reported behavior while preserving surrounding guarantees.",
    "research": "Separate symptoms, reproduction evidence and suspected causes.",
    "planning": "Define the corrected outcome without assuming the cause.",
    "review": "Verify the failure is resolved and surrounding behavior preserved."
  },
  "mockup": {
    "implementation": "Read the relevant reviewed Mockup before implementing the affected interface and determine which parts apply to this task. Follow its layout, controls, functionality and overall intent; pixel equivalence is not required. Compare the finished interface and behavior with that intent. Raise conflicts or necessary departures before implementing them. A read after editing requires comparison and correction or an explicit unresolved conflict before completion.",
    "research": "Read relevant Mockups to understand the intended experience, represented controls and actions, and expected outcomes. Distinguish reviewed intent from provisional or historical designs and from observed product behavior. Identify applicability, gaps and discrepancies rather than assuming the current interface fulfills the design.",
    "planning": "Read relevant reviewed Mockups before defining interface work. Carry their applicable layout, controls, actions, functionality and outcomes into scope and verification criteria. Resolve gaps or conflicts before planning a departure; preserve overall intent without requiring pixel equivalence.",
    "review": "Read the relevant reviewed Mockup and compare the delivered interface and behavior with its applicable layout, controls, functionality and intent. Inspect the rendered result and relevant behavioral evidence; do not treat a recorded Mockup read as proof of conformance. Report discrepancies and necessary departures explicitly; pixel equivalence is not required."
  },
  "DIAGRAM": {
    "implementation": "Read the relevant Diagram before changing the structure or behavior it governs. Determine its subject, abstraction level, intended claims and applicability. Make the code match the applicable reviewed structure or behavior at that level; the Diagram expresses how the user understands the system being built. Verify the affected claims against the result. If the code cannot match or the Diagram appears wrong, raise the discrepancy before proceeding with a departure. A late read requires comparison and correction or an explicit unresolved conflict before completion.",
    "research": "Read relevant Diagrams to orient the investigation and trace boundaries, responsibilities and relationships. Distinguish intended, historical and observed structure or behavior. Verify relevant claims with implementation evidence at the Diagram's declared abstraction level, and surface discrepancies rather than assuming either code or Diagram is correct.",
    "planning": "Read relevant reviewed Diagrams before shaping the solution. Carry applicable boundaries, responsibilities, relationships and intended behavior into the work and verification criteria at the declared abstraction level. Identify missing work and resolve conflicts before planning a departure; do not silently redraw the design to fit an expedient implementation.",
    "review": "Read the relevant Diagram and compare delivered structure or behavior with its applicable reviewed claims at the same abstraction level. Inspect evidence for the affected boundaries, responsibilities and relationships. Report discrepancies, including a potentially incorrect Diagram; neither code existence nor a recorded design read proves conformance."
  },
  "DIAGRAM_ELEMENT": {
    "implementation": "Read the relevant Diagram Element and its owning Diagram before implementing affected behavior. Identify its applicable responsibility, inputs, outputs and connections. Fulfill those obligations and verify them with implementation and test evidence at the Diagram's abstraction level. Raise conflicts or an apparently incorrect design before proceeding with a departure. If read after editing, compare and correct the result or report an unresolved conflict before completion.",
    "research": "Read the Diagram Element in its owning Diagram. Trace its responsibility, inputs, outputs, connections and relevant implementation evidence rather than relying on its name. Distinguish intended responsibility from observed fulfillment and identify gaps or contradictions at the Diagram's abstraction level.",
    "planning": "Read the Diagram Element in its owning Diagram and identify the work needed to fulfill its applicable responsibility, inputs, outputs and connections. Carry these obligations into work and verification criteria, account for dependencies and surface conflicts before planning a departure.",
    "review": "Read the Diagram Element in its owning Diagram and check evidence that its applicable responsibility, inputs, outputs and connections are fulfilled. Check affected behavior and relevant test coverage at the declared abstraction level. One completed task does not prove full fulfillment; report uncovered obligations and discrepancies explicitly."
  },
  "CONTRACT": {
    "implementation": "Read applicable Contracts before changing the affected behavior. Fulfill or preserve their guarantees for conforming consumers. Add or update tests that exercise the affected promise at its owned boundary, using integration tests where needed. If the implementation cannot honor the promise, raise the conflict before proceeding with that departure. If discovered after editing, reconcile the implementation and tests before declaring completion. Raise an observed breach as high priority; do not silently weaken the promise to fit the code.",
    "research": "Read the Contract and identify its provider, owned boundary, accepted conditions and guaranteed result. Determine whether the behavior being investigated falls within that promise. Gather evidence of fulfillment or breach, distinguishing observation from inference. Do not infer a new promise from implementation. Raise an observed breach as high priority.",
    "planning": "Read applicable Contracts before defining the solution. Carry their guarantees into the affected implementation steps and verification criteria. Plan tests at the owned boundary for the accepted conditions and promised results. If the intended outcome requires changing a guarantee, surface that change for explicit review before planning against a replacement promise.",
    "review": "Read the applicable Contracts and compare the delivered behavior against their accepted conditions and guarantees. Inspect evidence and tests at the owned boundary; passing internal tests alone does not establish fulfillment. Raise breaches as high priority. Identify missing evidence explicitly, and do not treat an unapproved change to the Contract as resolving a breach."
  },
  "decision": {
    "implementation": "Follow applicable recorded choices; raise conflicts.",
    "research": "Use recorded rationale without inferring deliberate decisions from code.",
    "planning": "Carry forward choices and identify those needing reconsideration.",
    "review": "Check conformance and reviewed departures."
  },
  "EVAL": {
    "implementation": "Preserve evaluated behavior and judgment criteria.",
    "research": "Treat results as bounded evidence and inspect coverage.",
    "planning": "Identify evaluation coverage for the intended outcome.",
    "review": "Assess whether cases and criteria meaningfully evaluate the feature."
  },
  "EVAL_CASE": {
    "implementation": "Honor the reviewed scenario and expectations without weakening them to fit implementation.",
    "research": "Treat scenario results as specific evidence.",
    "planning": "Identify realistic scenarios and coverage gaps.",
    "review": "Verify what must and must not happen."
  },
  "PLAN": {
    "implementation": "Follow reviewed staging and dependencies; raise departures.",
    "research": "Separate intended sequencing from actual progress.",
    "planning": "Build coherent delivery around its design and dependencies.",
    "review": "Assess scope, ordering, feasibility and outcome coverage."
  },
  "PLAN_STAGE": {
    "implementation": "Respect prerequisites and stage outcome.",
    "research": "Locate related work and understand delivery order.",
    "planning": "Group work around a meaningful outcome and explicit dependencies.",
    "review": "Check that constituent work delivers the stage outcome."
  },
  "GOAL": {
    "implementation": "Keep work aligned with the outcome; raise undermining scope choices.",
    "research": "Assess outcome evidence rather than activity alone.",
    "planning": "Connect work to the time-bound outcome and expose gaps.",
    "review": "Judge attainment separately from linked-work completion."
  },
  "TASK_MONITOR": {
    "implementation": "When governing execution, follow selected work, ordering and halt policy; retain evidence on owning records.",
    "research": "Follow linked evidence rather than relying only on checkpoint summaries.",
    "planning": "Express execution intent and ordering without duplicating tasks.",
    "review": "Check execution against policies and linked evidence."
  }
}
$advice$::jsonb;
  missing_keys text;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
    INTO missing_keys
  FROM jsonb_object_keys(advice) AS expected(type_key)
  WHERE NOT EXISTS (
    SELECT 1 FROM work_item_type_template AS template
    WHERE template.type_key = expected.type_key
  );

  IF missing_keys IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot seed session-role guidance; canonical templates missing: %', missing_keys;
  END IF;

  UPDATE work_item_type_template AS template
  SET session_role_guidance = entry.value,
      updated_at = CURRENT_TIMESTAMP
  FROM jsonb_each(advice) AS entry(key, value)
  WHERE template.type_key = entry.key;
END
$migration$;

