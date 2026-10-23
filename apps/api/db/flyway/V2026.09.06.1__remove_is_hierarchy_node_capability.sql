-- Feature hierarchy participation is platform-owned by the FEATURE type key,
-- not an authorable capability. Remove the retired key from both live rows and
-- canonical project templates before the strict capability contract is used.
UPDATE "work_item_type"
SET "capabilities" = "capabilities" - 'isHierarchyNode'
WHERE "capabilities" ? 'isHierarchyNode';

UPDATE "work_item_type_template"
SET "capabilities" = "capabilities" - 'isHierarchyNode'
WHERE "capabilities" ? 'isHierarchyNode';
