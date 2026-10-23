-- Existing machines retain every consumed enrollment as controller evidence.
-- Remove the original machine-id reservation uniqueness so a machine can
-- complete additional-controller and recovery ceremonies over its lifetime.
ALTER TABLE "pending_machine_enrollments"
    DROP CONSTRAINT "pending_machine_enrollments_machine_id_key";

CREATE INDEX "pending_machine_enrollments_machine_id_idx"
    ON "pending_machine_enrollments" ("machine_id");
