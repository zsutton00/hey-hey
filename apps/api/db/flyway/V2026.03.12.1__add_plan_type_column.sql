CREATE TYPE "plan_type" AS ENUM ('STANDARD', 'MINI');

ALTER TABLE "plans" ADD COLUMN "plan_type" "plan_type" NOT NULL DEFAULT 'STANDARD';
