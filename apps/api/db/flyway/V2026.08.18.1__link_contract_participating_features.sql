-- Make directly participating features discoverable from a Contract without
-- duplicating structural ownership or widening workflow-step participation.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot update Contract feature-participation guidance; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "writing_standards" = jsonb_set(
      jsonb_set(
        "writing_standards",
        '{create}',
        to_jsonb(("writing_standards"->>'create') || $create_addition$

## Feature participation topology

The structural feature parent records the Contract's owning feature; do not duplicate that ownership with a `RELATED_TO` edge. From the Contract, declare `RELATED_TO` for every other feature directly evidenced as providing, consuming, or enforcing the promised behavior. Prose mentions are navigation only and do not create either parentage or an edge. Keep this feature participation separate from `workflow_step DEPENDS_ON Contract`: every workflow step evidenced as authoring or enforcing the agreement still receives that step-level dependency, and neither relationship substitutes for the other. Do not automatically link ancestor features, incidental implementation features, every downstream feature, or use feature-level `DEPENDS_ON` unless an independent delivery dependency warrants it.

For example, when Configuration structurally owns a Contract and Agents directly consumes its promise, parent the Contract to Configuration without a duplicate feature edge and declare Contract `RELATED_TO` Agents. A storage feature merely used by the implementation receives no Contract edge unless it directly provides, consumes, or enforces the promise.
$create_addition$::text)
      ),
      '{edit}',
      to_jsonb(("writing_standards"->>'edit') || $edit_addition$

## Reconcile feature participation

Preserve structural parentage as the complete ownership relationship and do not add a duplicate `RELATED_TO` edge to the owning feature. Reconcile Contract `RELATED_TO` edges for all other features directly evidenced as providing, consuming, or enforcing the current promise. Mentions remain navigation and never materialize parentage, feature participation, or `workflow_step DEPENDS_ON Contract`; reconcile responsible workflow-step dependencies separately. Remove or avoid automatic links to ancestors, incidental implementation features, and downstream fan-out, and reserve feature-level `DEPENDS_ON` for a separately evidenced delivery dependency.
$edit_addition$::text)
    ),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
