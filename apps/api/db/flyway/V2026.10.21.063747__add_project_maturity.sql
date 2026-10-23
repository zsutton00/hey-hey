CREATE TYPE "ProjectMaturity" AS ENUM ('TAKING_SHAPE', 'ESTABLISHED');

ALTER TABLE "projects"
  ADD COLUMN "maturity" "ProjectMaturity" NOT NULL DEFAULT 'ESTABLISHED';

COMMENT ON COLUMN "projects"."maturity" IS
  'Manual user-controlled maturity stage; independent of lifecycle, setup, and activity.';
