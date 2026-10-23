import { defineWalkthrough, type Walkthrough } from "../GuidedWalkthrough";

/**
 * Walks the user through the Create Service form: describe the Service (name
 * and type), then create it. Linking a directory is optional and local to one
 * CLI machine, which the second step's copy explains.
 */
export function buildAddServiceWalkthrough(): Walkthrough {
  return defineWalkthrough("Add a service", [
    { actionKey: "describe-service", inputs: {} },
    { actionKey: "create-service", inputs: {} },
  ]);
}
