CREATE TABLE "goal_memberships" (
    "id"         TEXT NOT NULL DEFAULT gen_random_uuid(),
    "goal_id"    TEXT NOT NULL,
    "user_id"    TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goal_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goal_memberships_goal_id_fkey"
        FOREIGN KEY ("goal_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goal_memberships_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "goal_memberships_goal_id_user_id_key"
        UNIQUE ("goal_id", "user_id")
);

CREATE INDEX "goal_memberships_goal_id_idx" ON "goal_memberships"("goal_id");
CREATE INDEX "goal_memberships_user_id_idx" ON "goal_memberships"("user_id");
