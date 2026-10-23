-- Configure Workflow as the first built-in consumer of the type-neutral graph
-- capability. The registry continues to resolve this data through the same
-- columns and validation paths used by project-defined graph-capable types.

UPDATE "work_item_type"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"graphLayout"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"graphLayout","label":"Graph Layout","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphLayoutValue"}]'::jsonb
  END,
  "graph_configuration" = $graph$
{
  "nodeChildType": "workflow_step",
  "layout": {
    "sectionKey": "graphLayout",
    "schemaRef": "#/components/schemas/WorkItemGraphLayoutValue"
  },
  "readableRelationships": [
    {
      "edgeType": "STANDARD",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":true,"allowedDirections":["forward"],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "CONDITIONAL",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":true,"allowedDirections":["forward"],"predicateRequired":true},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "LOOP",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "FULFILLED_BY",
      "category": "meta",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"externalEntity","entityTypes":["TASK"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "DEPENDS_ON",
      "category": "meta",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"externalEntity","entityTypes":["TASK"],"workItemTypeKeys":["CONTRACT"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    }
  ],
  "editableRelationships": [
    {
      "edgeType": "STANDARD",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":true,"allowedDirections":["forward"],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "CONDITIONAL",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":true,"allowedDirections":["forward"],"predicateRequired":true},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "LOOP",
      "category": "flow",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "FULFILLED_BY",
      "category": "meta",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"externalEntity","entityTypes":["TASK"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    },
    {
      "edgeType": "DEPENDS_ON",
      "category": "meta",
      "sourceEndpoint": {"role":"graphNode","entityTypes":["TASK"],"workItemTypeKeys":["workflow_step"]},
      "targetEndpoint": {"role":"externalEntity","entityTypes":["TASK"],"workItemTypeKeys":["CONTRACT"]},
      "direction": {"required":false,"allowedDirections":[],"predicateRequired":false},
      "metadataSchemaRef": "#/components/schemas/RelationshipMetadata"
    }
  ],
  "searchableMetaLinkTargets": [
    {"edgeType":"FULFILLED_BY","targetEntityTypes":["TASK"]},
    {"edgeType":"DEPENDS_ON","targetEntityTypes":["TASK"],"targetWorkItemTypeKeys":["CONTRACT"]}
  ],
  "rendererKey": "work-item-graph",
  "editorKey": "work-item-graph-editor",
  "supportedActions": [
    "viewGraph",
    "createNode",
    "updateNode",
    "deleteNode",
    "createRelationship",
    "updateRelationship",
    "reconnectRelationship",
    "deleteRelationship",
    "replaceLayout",
    "clearLayout"
  ]
}
$graph$::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE
  "id" = 'c1a70000-0000-0000-0000-000000000005'
  AND "type_key" = 'workflow'
  AND "is_system" = true
  AND "project_id" IS NULL
  AND "lifecycle_status" = 'active';
