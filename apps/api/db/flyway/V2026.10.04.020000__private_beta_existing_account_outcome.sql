-- A signup whose email already belongs to an account is recorded as its own
-- non-failure outcome and gets a sign-in email, instead of being provisioned
-- into a USER_CONFLICT failure.
ALTER TYPE private_beta_access_request_status ADD VALUE IF NOT EXISTS 'EXISTING_ACCOUNT';
ALTER TYPE private_beta_access_notification_recipient_role ADD VALUE IF NOT EXISTS 'EXISTING_ACCOUNT_HOLDER';
