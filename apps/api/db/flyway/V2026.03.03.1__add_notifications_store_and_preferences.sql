DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_status') THEN
    CREATE TYPE "notification_status" AS ENUM (
      'unread',
      'read',
      'acknowledged',
      'dismissed'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notification_delivery_outcome') THEN
    CREATE TYPE "notification_delivery_outcome" AS ENUM (
      'SUCCESS',
      'FAILED',
      'SUPPRESSED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "affected_entities" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "status" "notification_status" NOT NULL DEFAULT 'unread',
  "read_at" TIMESTAMP(3),
  "acknowledged_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  "correlation_id" TEXT,
  "project_id" TEXT,
  "conversation_id" TEXT,
  "source_event_id" TEXT,
  "last_delivery_channel" TEXT,
  "last_delivery_transport" TEXT,
  "last_delivery_outcome" "notification_delivery_outcome",
  "last_delivery_error" TEXT,
  "last_delivery_attempt" INTEGER NOT NULL DEFAULT 0,
  "last_delivery_at" TIMESTAMP(3),
  "delivery_retry_count" INTEGER NOT NULL DEFAULT 0,
  "delivery_failure_count" INTEGER NOT NULL DEFAULT 0,
  "delivery_success_count" INTEGER NOT NULL DEFAULT 0,
  "delivery_latency_ms" INTEGER,
  "delivery_suppressed" BOOLEAN NOT NULL DEFAULT false,
  "delivery_suppression_reason" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "notification_delivery_attempts" (
  "id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "transport" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "outcome" "notification_delivery_outcome" NOT NULL,
  "error_message" TEXT,
  "delivered_at" TIMESTAMP(3),
  "latency_ms" INTEGER,
  "should_retry" BOOLEAN NOT NULL DEFAULT false,
  "next_retry_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_delivery_attempts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_delivery_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_delivery_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_delivery_attempts_unique_attempt" UNIQUE ("notification_id", "channel", "transport", "attempt")
);

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "subscriptions" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notification_preferences_org_user_key" UNIQUE ("organization_id", "user_id")
);

CREATE INDEX IF NOT EXISTS "notifications_org_user_created_idx"
  ON "notifications"("organization_id", "user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notifications_org_user_status_idx"
  ON "notifications"("organization_id", "user_id", "status");

CREATE INDEX IF NOT EXISTS "notifications_org_type_created_idx"
  ON "notifications"("organization_id", "event_type", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notifications_org_report_idx"
  ON "notifications"("organization_id", "report_id");

CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_notification_idx"
  ON "notification_delivery_attempts"("notification_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_org_user_idx"
  ON "notification_delivery_attempts"("organization_id", "user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "notification_preferences_org_updated_idx"
  ON "notification_preferences"("organization_id", "updated_at" DESC);
