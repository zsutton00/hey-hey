-- Capabilities are a closed OpenAPI object. Remove legacy keys that predate
-- the strict runtime validator from both possible effective definition sources.

UPDATE work_item_type
SET capabilities = capabilities
  - 'supportsDesignDocs'
  - 'requiresFeatureParent'
  - 'canHaveImplementationTasks'
WHERE capabilities ?| ARRAY[
  'supportsDesignDocs',
  'requiresFeatureParent',
  'canHaveImplementationTasks'
];

UPDATE work_item_type_template
SET capabilities = capabilities
  - 'supportsDesignDocs'
  - 'requiresFeatureParent'
  - 'canHaveImplementationTasks'
WHERE capabilities ?| ARRAY[
  'supportsDesignDocs',
  'requiresFeatureParent',
  'canHaveImplementationTasks'
];
