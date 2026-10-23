ALTER TYPE organization_account_lifecycle_state ADD VALUE IF NOT EXISTS 'SUSPENDED';
ALTER TYPE organization_account_lifecycle_state ADD VALUE IF NOT EXISTS 'IRREVERSIBLY_CLOSED';
