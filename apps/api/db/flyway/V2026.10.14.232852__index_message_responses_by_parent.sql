-- Bound the write-lock wait and index build; failure rolls back atomically.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE INDEX IF NOT EXISTS messages_parent_message_id_idx
  ON public.messages (parent_message_id);
