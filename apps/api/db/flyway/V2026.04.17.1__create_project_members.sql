CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'ARCHITECT', 'MEMBER', 'VIEWER');

CREATE TABLE "project_members" (
    "id"              TEXT NOT NULL DEFAULT gen_random_uuid(),
    "project_id"      TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "role"            "ProjectRole" NOT NULL DEFAULT 'MEMBER',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_members_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "project_members_project_id_user_id_key"
        UNIQUE ("project_id", "user_id")
);

CREATE INDEX "project_members_project_id_idx" ON "project_members"("project_id");
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");
