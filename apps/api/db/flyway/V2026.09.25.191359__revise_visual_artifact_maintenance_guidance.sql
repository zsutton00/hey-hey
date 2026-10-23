-- Update shared canonical advice for all following projects. Complete project
-- overrides remain authoritative and retain their existing guidance.
UPDATE work_item_type_template
SET maintenance_guidance = CASE type_key
  WHEN 'mockup' THEN $mockup$Maintain the mockup’s relationship to the intended interface and the work that realizes it. Before implementation, treat an agreed mockup as design guidance: when a task contradicts its layout or intended behavior, surface the conflict for reconciliation. Account for exploratory alternatives and historical designs rather than treating every mockup as the current specification.

After implementation, compare the relevant rendered interface with the mockup when visual evidence is available. Assess layout, grouping, hierarchy, navigation, and the placement and purpose of controls. Pixel-level differences alone do not establish drift. Flag meaningful divergence even when it does not violate a written requirement, and distinguish intentional evolution from unexplained change. State when actual visual comparison has not been possible; source code or task descriptions alone do not establish visual agreement.

Maintain connections to the features, tasks, and diagram elements that explain the interface. Use stable data-hh-id identifiers to identify specific authored controls when available. Consider whether a control initiates a user step represented in a diagram and whether the linked implementation work realizes that interaction. Preserve artifact identity and historical intent when proposing updates.$mockup$
  WHEN 'DIAGRAM' THEN $diagram$Maintain the diagram as a coherent account of its declared subject, kind, and abstraction level. Evaluate new design and implementation evidence against its elements and relationships. Before implementation, surface contradictions between agreed diagram intent and proposed work. After implementation, flag supported divergence and establish whether the diagram, implementation, or governing design needs reconciliation.

Respect the diagram’s level. For C4 diagrams, assess context, container, component, or code-level claims at the corresponding level; for other kinds, preserve their declared abstraction. Do not accumulate lower-level implementation detail merely because it becomes available. When complexity or mixed levels obscure the diagram’s purpose, suggest decomposition into connected diagrams for user review.

Maintain connections to related diagrams, tasks, and mockups, including relationships that cross feature boundaries. Check that those connections convey a concrete relationship and remain supported. Prune a connection only after examining both ends and finding that the evidence no longer supports it. Preserve historical or exploratory intent rather than automatically rewriting every diagram to match the latest implementation.$diagram$
  WHEN 'DIAGRAM_ELEMENT' THEN $element$Maintain the element’s stated responsibility, inputs, outputs, and relationships at its containing diagram’s abstraction level. Trace implementation through the tasks that realize it and the evidence those tasks provide. Ask whether each linked task actually implements this element, whether it covers only part of the responsibility, and whether relevant implementation work is missing from the connections. A completed task alone does not prove that the entire element is fulfilled.

Check relevant connections beyond the containing diagram: another diagram may expand the element, another element may depend on its output, or a mockup control may initiate the interaction it represents. Use concrete references, including a mockup control’s data-hh-id when available, to make the connection precise. Similar names or proximity are insufficient evidence.

Surface contradictions between the element’s intended behavior and proposed or observed implementation. Preserve the distinction between an implementation defect, an intentional design change, and an outdated representation; do not silently resolve a mismatch by changing the diagram to match the code.$element$
END,
updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('mockup', 'DIAGRAM', 'DIAGRAM_ELEMENT');
