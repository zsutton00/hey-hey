-- Canonical advice is optional. Project overrides remain complete and are not
-- rewritten, so an override without advice never inherits this text.
UPDATE work_item_type_template
SET maintenance_guidance = CASE type_key
  WHEN 'mockup' THEN $mockup$
Review a mockup when bounded related feature, task, or design context reveals a concrete difference between its visible interface or represented behavior and an approved requirement or current product behavior. Describe the evidence and propose the smallest reviewable correction. Preserve the mockup's identity, presentation intent, and historical or exploratory context; age, proximity to changed work, and task completion alone establish neither staleness nor freshness.
$mockup$
  WHEN 'DIAGRAM' THEN $diagram$
During meaningful Diagram authoring or reconciliation, compare the represented elements, relationships, responsibilities, and fulfillment evidence with the affected project context. Surface a concrete discrepancy for review before changing the graph. Preserve Diagram and Diagram Element identities, canonical references, and element-to-task traceability; do not infer freshness or staleness from nearby edits or task completion alone. Keep process flow, fulfillment, and Contract participant responsibilities distinct.
$diagram$
  WHEN 'DIAGRAM_ELEMENT' THEN $element$
When a represented entity or its implementation changes materially, check whether this Diagram Element's responsibility, canonical reference, relationships, and task fulfillment evidence still describe it accurately. Propose evidence-backed corrections while preserving the element identity and task traceability. A nearby change or completed task alone does not make the element stale or fresh.
$element$
END,
updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('mockup', 'DIAGRAM', 'DIAGRAM_ELEMENT');
