-- Capabilities are a closed OpenAPI object. Remove aliases left by the
-- original Task Monitor seed from both possible effective definition sources.

UPDATE work_item_type
SET capabilities = capabilities
  - 'canOwnReports'
  - 'canOwnAgentSessions'
  - 'supportsJsonSections'
  - 'participatesInFeatureHierarchy'
WHERE capabilities ?| ARRAY[
  'canOwnReports',
  'canOwnAgentSessions',
  'supportsJsonSections',
  'participatesInFeatureHierarchy'
];

UPDATE work_item_type_template
SET capabilities = capabilities
  - 'canOwnReports'
  - 'canOwnAgentSessions'
  - 'supportsJsonSections'
  - 'participatesInFeatureHierarchy'
WHERE capabilities ?| ARRAY[
  'canOwnReports',
  'canOwnAgentSessions',
  'supportsJsonSections',
  'participatesInFeatureHierarchy'
];
