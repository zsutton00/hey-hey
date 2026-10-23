-- Add enum value in its own migration so PostgreSQL commits it before any usage.
-- NOT_STARTED is inserted before STARTED to match the lifecycle order declared in
-- src/generated/model/conversationStatus.ts and prisma/schema.prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'ConversationStatus'
      AND e.enumlabel = 'NOT_STARTED'
  ) THEN
    ALTER TYPE "ConversationStatus" ADD VALUE 'NOT_STARTED' BEFORE 'STARTED';
  END IF;
END $$;
