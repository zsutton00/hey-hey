const fs = require("fs");
const yaml = require("js-yaml");

const readYaml = (path) => yaml.load(fs.readFileSync(path, "utf8"));
const hasAll = (actual, expected) =>
  expected.every((value) => actual.includes(value));
const composesRef = (schema, ref) =>
  Array.isArray(schema.allOf) &&
  schema.allOf.some((entry) => entry.$ref === ref);

const agentEdges = readYaml("specs/schemas/agent-edges.yaml");
const proposals = readYaml("specs/schemas/proposals.yaml");
const tasks = readYaml("specs/schemas/tasks.yaml");
const apiSpec = readYaml("specs/api/openapi.yaml");
const graphSpec = readYaml("specs/graphs/openapi.yaml");

const agentEdgeTypeEnum = agentEdges.AgentEdgeType.enum;
const categoryEnum = agentEdges.AgentEdgeCategory.enum;
const contractRules = agentEdges.AgentEdgeContractRules.properties;
const workflowEdgePredicate = agentEdges.WorkflowEdgePredicate;
const workflowProposalLink = tasks.WorkflowProposalLinkInput;
const workflowProposalStandardLink = tasks.WorkflowProposalStandardLinkInput;
const workflowProposalConditionalLink =
  tasks.WorkflowProposalConditionalLinkInput;
const workflowProposalLoopLink = tasks.WorkflowProposalLoopLinkInput;
const workItemRelationshipCreate =
  proposals.WorkItemRelationshipCreateOperation;
const workItemStandardRelationshipCreate =
  proposals.WorkItemStandardRelationshipCreateOperation;
const workItemConditionalRelationshipCreate =
  proposals.WorkItemConditionalRelationshipCreateOperation;
const workItemLoopRelationshipCreate =
  proposals.WorkItemLoopRelationshipCreateOperation;
const agentEdgeResponse = agentEdges.AgentEdgeResponseDto;
const apiAgentEdgesPath =
  apiSpec.paths[
    "/organizations/{organizationId}/projects/{projectId}/agent-edges"
  ];
const apiAgentEdgePath =
  apiSpec.paths[
    "/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}"
  ];
const apiCreateAgentEdge =
  apiAgentEdgesPath.post.requestBody.content["application/json"].schema;
const apiListAgentEdgeParameters = apiAgentEdgesPath.get.parameters;
const apiUpdateAgentEdge =
  apiAgentEdgePath.patch.requestBody.content["application/json"].schema;
const graphRelationshipTypeEnum =
  graphSpec.components.schemas.RelationshipType.enum;
const graphRelationship = graphSpec.components.schemas.GraphRelationship;
const graphCreateRelationship =
  graphSpec.components.schemas.CreateRelationshipRequest;
const graphAgentEdge = graphSpec.components.schemas.AgentEdge;
const graphCreateAgentEdge = graphSpec.components.schemas.CreateAgentEdgeDto;
const graphUpdateAgentEdge = graphSpec.components.schemas.UpdateAgentEdgeDto;

const requiredTypes = ["FULFILLED_BY", "STANDARD", "CONDITIONAL", "LOOP"];
const flowTypes = ["STANDARD", "CONDITIONAL", "LOOP"];
const metaTypes = ["FULFILLED_BY"];
const endpointTypes = [
  "PROJECT",
  "TASK",
  "DESIGN_DOC",
  "SERVICE",
  "REPORT",
  "IMPLEMENTATION_HINT",
];

const assertions = [
  [
    hasAll(agentEdgeTypeEnum, requiredTypes),
    "AgentEdgeType must include workflow flow types and FULFILLED_BY.",
  ],
  [
    hasAll(agentEdges.AgentEdgeEndpointEntityType.enum, endpointTypes) &&
      !agentEdges.AgentEdgeEndpointEntityType.enum.includes("USER"),
    "AgentEdgeEndpointEntityType must include graph-backed entity endpoints and exclude USER.",
  ],
  [
    hasAll(categoryEnum, ["meta", "flow"]) &&
      agentEdges.AgentEdgeCategory.default === "meta",
    "AgentEdgeCategory must enumerate meta/flow and default to meta.",
  ],
  [
    hasAll(contractRules.flowEdgeTypes.example, flowTypes),
    "AgentEdgeContractRules.flowEdgeTypes must list STANDARD, CONDITIONAL, LOOP.",
  ],
  [
    hasAll(contractRules.metaEdgeTypes.example, metaTypes) &&
      !contractRules.metaEdgeTypes.example.some((type) =>
        flowTypes.includes(type),
      ),
    "FULFILLED_BY must be meta and flow types must not be meta.",
  ],
  [
    agentEdges.AgentMetaEdgeType.enum.length ===
      contractRules.metaEdgeTypes.example.length &&
      hasAll(
        agentEdges.AgentMetaEdgeType.enum,
        contractRules.metaEdgeTypes.example,
      ),
    "AgentMetaEdgeType must match the contract's complete meta edge vocabulary.",
  ],
  [
    hasAll(contractRules.directionRequiredEdgeTypes.example, [
      "STANDARD",
      "CONDITIONAL",
    ]) && !contractRules.directionRequiredEdgeTypes.example.includes("LOOP"),
    "STANDARD and CONDITIONAL require direction; LOOP must not.",
  ],
  [
    contractRules.predicateRequiredEdgeTypes.example.length === 1 &&
      contractRules.predicateRequiredEdgeTypes.example[0] === "CONDITIONAL",
    "Only CONDITIONAL requires predicate.",
  ],
  [
    contractRules.predicateAllowedEdgeTypes.example.length === 2 &&
      hasAll(contractRules.predicateAllowedEdgeTypes.example, [
        "CONDITIONAL",
        "LOOP",
      ]) &&
      !contractRules.predicateAllowedEdgeTypes.example.includes("STANDARD"),
    "CONDITIONAL and LOOP allow predicate; STANDARD must not.",
  ],
  [
    workflowEdgePredicate.minLength === 1 &&
      workflowEdgePredicate.maxLength === 200 &&
      typeof workflowEdgePredicate.pattern === "string",
    "WorkflowEdgePredicate must define the shared non-blank length and character contract.",
  ],
  [
    workflowProposalLink.discriminator.propertyName === "type" &&
      hasAll(
        workflowProposalLink.oneOf.map((entry) => entry.$ref),
        [
          "#/WorkflowProposalStandardLinkInput",
          "#/WorkflowProposalConditionalLinkInput",
          "#/WorkflowProposalLoopLinkInput",
          "#/WorkflowProposalFulfilledByLinkInput",
        ],
      ),
    "WorkflowProposalLinkInput must remain a discriminated union of all workflow link variants.",
  ],
  [
    !("predicate" in workflowProposalStandardLink.properties) &&
      workflowProposalStandardLink.additionalProperties === false,
    "STANDARD workflow proposal links must forbid predicate.",
  ],
  [
    hasAll(workflowProposalConditionalLink.required, [
      "sourceStepTempId",
      "type",
      "targetStepTempId",
      "direction",
      "predicate",
    ]) &&
      workflowProposalConditionalLink.properties.predicate.$ref ===
        "./agent-edges.yaml#/WorkflowEdgePredicate" &&
      workflowProposalConditionalLink.additionalProperties === false,
    "CONDITIONAL workflow proposal links must require the shared predicate contract.",
  ],
  [
    !workflowProposalLoopLink.required.includes("predicate") &&
      workflowProposalLoopLink.properties.predicate.$ref ===
        "./agent-edges.yaml#/WorkflowEdgePredicate" &&
      workflowProposalLoopLink.additionalProperties === false,
    "LOOP workflow proposal links must optionally use the shared predicate contract.",
  ],
  [
    workItemRelationshipCreate.discriminator.propertyName === "edgeType" &&
      hasAll(
        workItemRelationshipCreate.oneOf.map((entry) => entry.$ref),
        [
          "#/WorkItemMetaRelationshipCreateOperation",
          "#/WorkItemStandardRelationshipCreateOperation",
          "#/WorkItemConditionalRelationshipCreateOperation",
          "#/WorkItemLoopRelationshipCreateOperation",
        ],
      ) &&
      hasAll(
        Object.keys(workItemRelationshipCreate.discriminator.mapping),
        agentEdgeTypeEnum,
      ),
    "Generic relationship.create must discriminate the complete meta and workflow flow vocabulary by edgeType.",
  ],
  [
    !("predicate" in workItemStandardRelationshipCreate.properties) &&
      workItemStandardRelationshipCreate.additionalProperties === false,
    "Generic STANDARD relationship.create operations must forbid predicate.",
  ],
  [
    hasAll(workItemConditionalRelationshipCreate.required, [
      "op",
      "ref",
      "source",
      "target",
      "edgeType",
      "category",
      "direction",
      "predicate",
    ]) &&
      workItemConditionalRelationshipCreate.properties.predicate.$ref ===
        "./agent-edges.yaml#/WorkflowEdgePredicate" &&
      workItemConditionalRelationshipCreate.additionalProperties === false,
    "Generic CONDITIONAL relationship.create operations must require the shared predicate contract.",
  ],
  [
    !workItemLoopRelationshipCreate.required.includes("predicate") &&
      workItemLoopRelationshipCreate.properties.predicate.$ref ===
        "./agent-edges.yaml#/WorkflowEdgePredicate" &&
      workItemLoopRelationshipCreate.additionalProperties === false,
    "Generic LOOP relationship.create operations must optionally use the shared predicate contract.",
  ],
  [
    contractRules.workflowCrossWorkflowSourceType.enum.includes(
      "WORKFLOW_STEP",
    ),
    "Cross-workflow edges must originate at WORKFLOW_STEP.",
  ],
  [
    hasAll(contractRules.workflowCrossWorkflowTargetTypes.example, [
      "WORKFLOW_STEP",
      "WORKFLOW",
    ]),
    "Cross-workflow targets must include WORKFLOW_STEP and WORKFLOW.",
  ],
  [
    composesRef(agentEdgeResponse.properties.category, "#/AgentEdgeCategory") &&
      agentEdgeResponse.properties.category.default === "meta",
    "AgentEdgeResponseDto category must compose AgentEdgeCategory and default to meta.",
  ],
  [
    agentEdgeResponse.properties.targetNodeType?.type === "string" &&
      agentEdgeResponse.properties.targetNodeType?.nullable === true &&
      graphAgentEdge.properties.targetNodeType?.type === "string" &&
      graphAgentEdge.properties.targetNodeType?.nullable === true,
    "Incident agent-edge responses must expose the nullable target work-item subtype.",
  ],
  [
    apiCreateAgentEdge.properties.category &&
      apiCreateAgentEdge.required.includes("sourceEntityType") &&
      apiCreateAgentEdge.required.includes("targetEntityType") &&
      apiCreateAgentEdge.properties.sourceEntityType.$ref ===
        "#/components/schemas/AgentEdgeEndpointEntityType" &&
      apiCreateAgentEdge.properties.targetEntityType.$ref ===
        "#/components/schemas/AgentEdgeEndpointEntityType" &&
      composesRef(
        apiCreateAgentEdge.properties.category,
        "#/components/schemas/AgentEdgeCategory",
      ) &&
      apiCreateAgentEdge.properties.category.default === "meta" &&
      apiCreateAgentEdge.properties.direction &&
      composesRef(
        apiCreateAgentEdge.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ) &&
      apiUpdateAgentEdge.properties.category &&
      composesRef(
        apiUpdateAgentEdge.properties.category,
        "#/components/schemas/AgentEdgeCategory",
      ) &&
      apiUpdateAgentEdge.properties.direction &&
      composesRef(
        apiUpdateAgentEdge.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ),
    "API agent-edge create/update contracts must expose category, direction, and predicate.",
  ],
  [
    apiListAgentEdgeParameters.some(
      (parameter) =>
        parameter.name === "category" &&
        parameter.schema &&
        parameter.schema.$ref === "#/components/schemas/AgentEdgeCategory",
    ),
    "API agent-edge list contract must expose a category filter.",
  ],
  [
    hasAll(graphRelationshipTypeEnum, requiredTypes),
    "Graph RelationshipType must carry the workflow edge vocabulary.",
  ],
  [
    graphAgentEdge.properties.type.$ref ===
      "#/components/schemas/RelationshipType" &&
      graphCreateAgentEdge.required.includes("sourceEntityType") &&
      graphCreateAgentEdge.required.includes("targetEntityType") &&
      graphCreateAgentEdge.properties.sourceEntityType.$ref ===
        "../schemas/agent-edges.yaml#/AgentEdgeEndpointEntityType" &&
      graphCreateAgentEdge.properties.targetEntityType.$ref ===
        "../schemas/agent-edges.yaml#/AgentEdgeEndpointEntityType" &&
      graphCreateAgentEdge.properties.type.$ref ===
        "../schemas/agent-edges.yaml#/AgentEdgeType" &&
      graphUpdateAgentEdge.properties.type.$ref ===
        "../schemas/agent-edges.yaml#/AgentEdgeType",
    "Graph AgentEdge responses must use RelationshipType while create/update inputs use AgentEdgeType.",
  ],
  [
    composesRef(
      graphRelationship.properties.category,
      "../schemas/agent-edges.yaml#/AgentEdgeCategory",
    ) &&
      graphRelationship.properties.category.default === "meta" &&
      composesRef(
        graphCreateRelationship.properties.category,
        "../schemas/agent-edges.yaml#/AgentEdgeCategory",
      ) &&
      graphCreateRelationship.properties.category.default === "meta" &&
      composesRef(
        graphAgentEdge.properties.category,
        "../schemas/agent-edges.yaml#/AgentEdgeCategory",
      ) &&
      graphAgentEdge.properties.category.default === "meta",
    "Graph relationship and agent-edge contracts must default category to meta.",
  ],
  [
    graphRelationship.properties.direction &&
      graphCreateRelationship.properties.direction &&
      graphAgentEdge.properties.direction &&
      composesRef(
        graphRelationship.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ) &&
      composesRef(
        graphCreateRelationship.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ) &&
      composesRef(
        graphAgentEdge.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ) &&
      composesRef(
        graphCreateAgentEdge.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ) &&
      composesRef(
        graphUpdateAgentEdge.properties.predicate,
        "../schemas/agent-edges.yaml#/WorkflowEdgePredicate",
      ),
    "Graph relationship and agent-edge contracts must expose direction and predicate.",
  ],
  [
    /WORKFLOW_STEP/.test(
      graphCreateRelationship.properties.sourceNodeId.description,
    ) &&
      /WORKFLOW_STEP/.test(
        graphCreateRelationship.properties.targetNodeId.description,
      ) &&
      /WORKFLOW/.test(
        graphCreateRelationship.properties.targetNodeId.description,
      ),
    "Graph create relationship contract must document WORKFLOW_STEP origin and WORKFLOW_STEP/WORKFLOW targets.",
  ],
];

const failures = assertions
  .filter(([passed]) => !passed)
  .map(([, message]) => message);

if (failures.length > 0) {
  console.error("Workflow edge contract validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Workflow edge contract validation passed.");
