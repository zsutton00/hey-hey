-- Move the verified Contract boundary example into the canonical definition
-- without changing writing standards, project overrides, or other type axes.

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" = 'CONTRACT'
  ) THEN
    RAISE EXCEPTION
      'Cannot move Contract example into canonical definition; canonical Contract template is missing';
  END IF;
END
$migration$;

UPDATE "work_item_type_template"
SET "description" = $contract_description$
A Contract records one deliberately designed, durable promise made by an identified provider at an owned interaction point. It states the concrete input or triggering conditions accepted at that boundary and the provider-controlled result guaranteed when those conditions are met. Contracts are not processes themselves, in fact they allow for systems to be black boxes for consumers.

A Contract cannot be inferred from implementation alone. Code, schemas, tests, and current consumer behavior may reveal a candidate or demonstrate fulfillment or breach however. Violation of a contract should be considered high priority and always raised to the user

Example:
Good: “When a consumer calls the marketing-start endpoint with a `productId` and `message`, the provider guarantees that the marketing workflow is started.” Not automatically a Contract: “On startup, the workflow queue will be drained.” The first names a concrete boundary and observable provider-owned delivery; the second describes internal lifecycle behavior unless it is deliberately guaranteed at an owned boundary.
$contract_description$,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" = 'CONTRACT';
