const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const root = path.resolve(__dirname, "..");
const load = (relativePath) =>
  yaml.load(fs.readFileSync(path.join(root, relativePath), "utf8"));

const api = load("specs/api/openapi.yaml");
const authorization = load("specs/schemas/controller-authorization.yaml");
const management = load("specs/schemas/controller-management.yaml");
const conversations = load("specs/schemas/conversations.yaml");
const monitor = load("specs/schemas/monitor-commands.yaml");
const websockets = load("specs/schemas/websockets.yaml");

const fail = (message) => {
  throw new Error(`Controller authorization contract: ${message}`);
};

const expectExact = (actual, expected, label) => {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    fail(`${label} must be exact; got ${JSON.stringify(actual)}`);
  }
};

const requireFields = (schema, fields, label) => {
  const required = new Set(schema.required ?? []);
  for (const field of fields) {
    if (!required.has(field)) fail(`${label} must require ${field}`);
  }
};

const expectSecurity = (operation, scheme, label) => {
  const security = operation.security ?? [];
  if (
    security.length !== 1 ||
    Object.keys(security[0] ?? {}).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(security[0] ?? {}, scheme)
  ) {
    fail(`${label} must require only ${scheme}`);
  }
};

const claimFailureCode = api.components.schemas.MachineEnrollmentClaimFailureCode;
expectExact(
  claimFailureCode.enum,
  [
    "MACHINE_ENROLLMENT_CLAIM_UNAVAILABLE",
    "MACHINE_ENROLLMENT_CLAIM_EXPIRED",
    "MACHINE_ENROLLMENT_CLAIM_TERMINAL",
    "MACHINE_ENROLLMENT_CLIENT_INCOMPATIBLE",
  ],
  "browser-safe machine enrollment claim failure codes",
);
const claimFailure = api.components.schemas.MachineEnrollmentClaimFailureErrorDto;
if (
  claimFailure.properties.code.$ref !==
  "#/components/schemas/MachineEnrollmentClaimFailureCode"
) {
  fail("browser claim failures must use the generated safe failure-code schema");
}
if (claimFailure.properties.message.enum) {
  fail("browser claim guidance must be API-authored rather than fixed generic copy");
}
const claimRateLimit = api.components.schemas.MachineEnrollmentClaimRateLimitErrorDto;
if (
  claimRateLimit.properties.code.enum?.[0] !==
    "MACHINE_ENROLLMENT_CLAIM_RATE_LIMITED" ||
  claimRateLimit.properties.retryAfterSeconds.minimum !== 1
) {
  fail("browser claim throttling must expose its generated code and a positive retry delay");
}

expectExact(authorization.AuthorizationProtocolVersion.enum, [1, 2], "protocol versions");
expectExact(
  authorization.ControllerAuthorizationCadence.enum,
  [
    "FIVE_MINUTES",
    "EIGHT_HOURS",
    "ONE_DAY",
    "ONE_WEEK",
    "ONE_MONTH",
  ],
  "controller authorization cadences",
);
if (
  authorization.ControllerInstallationId.type !== "string" ||
  authorization.ControllerInstallationId.format !== "uuid"
) {
  fail("controller installation identity must be a UUID string");
}
expectExact(
  authorization.ControllerDeviceGrantScope.enum,
  ["controller_device_window"],
  "controller-device grant scopes",
);
const grantDescriptorFields = [
  "scope",
  "controllerCredentialId",
  "controllerInstallationId",
  "machineId",
  "userId",
  "organizationId",
  "cadence",
  "policyRevision",
  "allowedActionTypes",
  "allowedActionCategories",
  "issuedAtMs",
  "effectiveExpiresAtMs",
];
const grantDescriptor = authorization.ControllerDeviceGrantDescriptor;
if (grantDescriptor.additionalProperties !== false) {
  fail("controller-device grant descriptors must reject unknown fields");
}
expectExact(grantDescriptor.required, grantDescriptorFields, "grant descriptor fields");
expectExact(
  Object.keys(grantDescriptor.properties),
  grantDescriptorFields,
  "grant descriptor properties",
);
if (grantDescriptor.properties.allowedActionCategories.maxItems !== 7) {
  fail("grant descriptor action categories must retain the closed seven-category ceiling");
}
expectExact(
  authorization.MachineExecutionReadinessState.enum,
  [
    "NO_MACHINE_SELECTED",
    "LEGACY_PROTOCOL",
    "CONTROLLER_ENROLLMENT_REQUIRED",
    "CONTROLLER_REVOKED",
    "MACHINE_REVOKED",
    "DISCONNECTED",
    "READY",
  ],
  "machine readiness states",
);
expectExact(
  authorization.HostAffectingActionType.enum,
  [
    "CONVERSATION_TRIGGER",
    "PLATFORM_EVENT_TRIGGER",
    "CONVERSATION_CONTROL_COMPACT_RUN",
    "CONVERSATION_CONTROL_PERMISSION_DECISION",
    "TASK_MONITOR_START",
    "TASK_MONITOR_RESUME",
    "TASK_MONITOR_JUDGMENT_RESOLVED",
    "TASK_MONITOR_CONTINUE",
    "TASK_MONITOR_COMPLETE",
    "CLI_READ",
    "APPLICATION_EFFECT_LAUNCH",
    "EXACT_ACTION_DELIVERY",
  ],
  "host-affecting action types (every paired grant holds this exact bundle; changing it forces every user to re-pair)",
);
expectExact(
  authorization.CurrentAgentOperation.enum,
  authorization.HostAffectingActionType.enum,
  "current agent operations",
);
if (
  authorization.CurrentAgentOperations.minItems !== 12 ||
  authorization.CurrentAgentOperations.maxItems !== 12 ||
  authorization.CurrentAgentOperations.uniqueItems !== true ||
  authorization.CurrentAgentOperations.items.$ref !== "#/CurrentAgentOperation"
) {
  fail(
    "current agent operation bundle must contain all twelve values exactly once; every paired grant holds this exact bundle, so changing it forces every user to re-pair",
  );
}
requireFields(
  authorization.CanonicalControllerAuthorizationIntent,
  ["allowedActionTypes", "allowedActionCategories"],
  "canonical controller authorization intent",
);
expectExact(
  authorization.AuthorityReductionActionType.enum,
  [
    "CONVERSATION_STOP",
    "AGENT_SESSION_CANCEL",
    "TASK_MONITOR_PAUSE",
    "TASK_MONITOR_STOP",
    "TASK_MONITOR_HALT",
    "MACHINE_REVOKE",
    "CONTROLLER_REVOKE",
  ],
  "authority reduction types",
);

requireFields(authorization.WorkspaceSkillsHostActionPreparation, ["requestId", "actionCategory", "actionType", "targetKind", "targetId", "provider", "catalogContext"], "workspace catalog authorization");
const expectedTargetKindByAction = {
  CONVERSATION_TRIGGER: "AGENT_SESSION",
  PLATFORM_EVENT_TRIGGER: "PLATFORM_EVENT",
  CONVERSATION_CONTROL_COMPACT_RUN: "AGENT_SESSION",
  CONVERSATION_CONTROL_PERMISSION_DECISION: "AGENT_SESSION",
  TASK_MONITOR_START: "TASK_MONITOR",
  TASK_MONITOR_RESUME: "TASK_MONITOR",
  TASK_MONITOR_JUDGMENT_RESOLVED: "TASK_MONITOR",
  TASK_MONITOR_CONTINUE: "TASK_MONITOR",
  TASK_MONITOR_COMPLETE: "TASK_MONITOR",
  CLI_READ: ["AGENT_SESSION", "CLI_READ"],
  APPLICATION_EFFECT_LAUNCH: "APPLICATION_EFFECT",
  EXACT_ACTION_DELIVERY: "EXACT_ACTION",
};
if (
  JSON.stringify(authorization.HostActionPreparation["x-heyhey-target-kind-by-action"]) !==
  JSON.stringify(expectedTargetKindByAction)
) {
  fail("host-action target bindings must remain exhaustive and canonical");
}

expectExact(
  management.ControllerEnrollmentEligibilityState.enum,
  ["LEGACY_PROTOCOL", "CONTROLLER_ENROLLMENT_REQUIRED", "READY", "NO_CONTROLLER"],
  "controller enrollment eligibility states",
);
expectExact(
  management.ControllerManagementOutcomeCode.enum,
  ["WRONG_OWNER", "MACHINE_REVOKED", "INVALID_STATE", "ALREADY_READY", "ALREADY_REVOKED"],
  "controller management outcomes",
);
expectExact(
  management.ControllerManagementProtocolVersion.enum,
  [2],
  "controller management protocol version",
);
requireFields(
  management.MachineControllerAuthenticationProofDto,
  ["machineId", "challenge", "signature"],
  "machine authentication proof",
);
requireFields(
  management.ExistingMachineControllerEnrollmentRequestDto,
  ["authorizationProtocolVersion", "machineProof"],
  "existing-machine enrollment request",
);
requireFields(
  management.MachineControllerInventoryRequestDto,
  ["authorizationProtocolVersion", "machineProof"],
  "machine controller inventory request",
);
if (management.ExistingMachineControllerEnrollmentRequestDto.properties.machinePublicKey) {
  fail("existing-machine enrollment must preserve the stored public key");
}
requireFields(
  management.ControllerCredentialSummaryDto,
  [
    "credentialId",
    "label",
    "fingerprint",
    "createdAt",
    "lastUsedAt",
    "backupEligible",
    "backupState",
    "revocationState",
  ],
  "controller summary",
);
if (management.ControllerCredentialSummaryDto.additionalProperties !== false) {
  fail("controller summaries must reject unknown fields");
}
requireFields(
  management.SignedControllerRevocationReductionEnvelope,
  [
    "machineId",
    "userId",
    "controllerCredentialId",
    "nonce",
    "timestampMs",
    "protocolVersion",
    "event",
    "signature",
  ],
  "controller revocation reduction frame",
);

const existingMachineEnrollment =
  api.paths["/machines/{machineId}/controller-enrollments"].post;
expectSecurity(
  existingMachineEnrollment,
  "MachineCredentialAuth",
  "existing-machine enrollment",
);
if (existingMachineEnrollment.deprecated) {
  fail("existing-machine enrollment must not be deprecated");
}
if (
  existingMachineEnrollment.requestBody.content["application/json"].schema.$ref !==
  "#/components/schemas/ExistingMachineControllerEnrollmentRequestDto"
) {
  fail("existing-machine enrollment must use its closed request schema");
}

expectSecurity(
  api.paths["/machines/{machineId}/controllers"].get,
  "BearerAuth",
  "account controller listing",
);
expectSecurity(
  api.paths["/machines/{machineId}/controllers/reconcile"].post,
  "MachineCredentialAuth",
  "machine controller reconciliation",
);
expectSecurity(
  api.paths["/machines/{machineId}/controllers/inspect"].post,
  "MachineCredentialAuth",
  "machine controller inspection",
);
expectSecurity(
  api.paths["/machines/{machineId}/controllers/{controllerCredentialId}/revoke"].post,
  "MachineCredentialAuth",
  "local controller revocation",
);
expectSecurity(
  api.paths["/machines/{machineId}/controllers/{controllerCredentialId}"].delete,
  "BearerAuth",
  "account controller revocation",
);

for (const pathName of [
  "/machines/pairing-codes",
  "/machines/pairing-codes/{id}",
  "/machines/register",
]) {
  const operation = api.paths[pathName].post ?? api.paths[pathName].get;
  if (!operation.deprecated) fail(`${pathName} must be deprecated`);
  const responseKeys = Object.keys(operation.responses ?? {});
  expectExact(responseKeys, ["410"], `${pathName} terminal responses`);
  if (
    operation.responses["410"].content["application/json"].schema.$ref !==
    "#/components/schemas/LegacyMachinePairingRetiredErrorDto"
  ) {
    fail(`${pathName} must use the stable legacy retirement response`);
  }
}

const authUnion = authorization.ExecutableEnvelopeAuthorization;
expectExact(
  authUnion.oneOf.map((entry) => entry.$ref),
  ["#/ExecutableControllerAssertionEvidence", "#/BoundedGrantReference"],
  "executable authorization arms",
);
if (
  authUnion.discriminator?.propertyName !== "kind" ||
  authUnion.discriminator?.mapping?.controller_assertion !==
    "#/ExecutableControllerAssertionEvidence" ||
  authUnion.discriminator?.mapping?.bounded_grant !== "#/BoundedGrantReference"
) {
  fail("executable authorization discriminator must target the two executable arms");
}
const admissionUnion = authorization.AdmissionEnvelopeAuthorization;
expectExact(
  admissionUnion.oneOf.map((entry) => entry.$ref),
  ["#/ControllerAssertionEvidence", "#/BoundedGrantReference"],
  "admission authorization arms",
);
if (
  admissionUnion.discriminator?.propertyName !== "kind" ||
  admissionUnion.discriminator?.mapping?.controller_assertion !==
    "#/ControllerAssertionEvidence" ||
  admissionUnion.discriminator?.mapping?.bounded_grant !==
    "#/BoundedGrantReference"
) {
  fail("admission authorization discriminator must target the two admission arms");
}

requireFields(
  authorization.CanonicalControllerAuthorizationIntent,
  [
    "authorizationId",
    "controllerCredentialId",
    "controllerInstallationId",
    "machineId",
    "userId",
    "organizationId",
    "projectId",
    "cadence",
    "policyRevision",
    "effectiveGrantExpiresAtMs",
    "grantDescriptorHash",
    "actionType",
    "actionPayloadHash",
    "allowedActionCategories",
    "target",
    "agentSessionId",
    "taskMonitorId",
    "nonce",
    "issuedAtMs",
    "expiresAtMs",
  ],
  "canonical intent",
);
requireFields(
  authorization.ControllerAuthorizationAdmittedDto,
  ["outcome", "authorizationId", "consumedAt", "grantId"],
  "admitted controller authorization",
);
const admittedGrantId = authorization.ControllerAuthorizationAdmittedDto.properties.grantId;
if (admittedGrantId.type !== "string" || admittedGrantId.format !== "uuid" || admittedGrantId.nullable !== true) {
  fail("admitted controller authorization must expose a nullable reusable grant identifier");
}
if (
  !authorization.CanonicalControllerAuthorizationIntent.properties.expiresAtMs.description.includes(
    "two minutes",
  ) ||
  !authorization.CanonicalControllerAuthorizationIntent.properties.effectiveGrantExpiresAtMs.description.includes(
    "independent",
  )
) {
  fail("canonical intent must separate the two-minute challenge from grant expiry");
}
const canonicalAllowedActionCategories =
  authorization.CanonicalControllerAuthorizationIntent.properties.allowedActionCategories;
if (
  canonicalAllowedActionCategories.type !== "array" ||
  canonicalAllowedActionCategories.minItems !== 1 ||
  canonicalAllowedActionCategories.maxItems !== 7 ||
  canonicalAllowedActionCategories.uniqueItems !== true ||
  canonicalAllowedActionCategories.items.$ref !== "#/HostActionCategory"
) {
  fail("canonical intent must carry the closed allowed-action class set");
}
if (
  authorization.CanonicalControllerAuthorizationIntent.properties.controllerInstallationId.$ref !==
  "#/ControllerInstallationId"
) {
  fail("canonical intent must use the named controller installation identity");
}

const assertionFields = [
  "kind",
  "intent",
  "credentialId",
  "clientDataJSON",
  "authenticatorData",
  "signature",
  "userHandle",
  "grantDescriptor",
];
const assertion = authorization.ControllerAssertionEvidence;
if (assertion.additionalProperties !== false) {
  fail("browser controller assertions must reject unknown fields");
}
expectExact(assertion.required, assertionFields, "browser controller assertion fields");
expectExact(
  Object.keys(assertion.properties),
  assertionFields,
  "browser controller assertion properties",
);
if (assertion.properties.grantId) {
  fail("browser controller assertions must not accept a server grant identifier");
}
if (
  assertion.properties.grantDescriptor.$ref !== "#/ControllerDeviceGrantDescriptor"
) {
  fail("browser controller assertions must carry the complete grant descriptor");
}

const executableAssertion = authorization.ExecutableControllerAssertionEvidence;
const executableAssertionFields = [...assertionFields, "grantId"];
if (executableAssertion.additionalProperties !== false) {
  fail("executable controller assertions must reject unknown fields");
}
expectExact(
  executableAssertion.required,
  executableAssertionFields,
  "executable controller assertion fields",
);
expectExact(
  Object.keys(executableAssertion.properties),
  executableAssertionFields,
  "executable controller assertion properties",
);
if (
  executableAssertion.properties.grantDescriptor.$ref !==
  "#/ControllerDeviceGrantDescriptor"
) {
  fail("executable controller assertions must carry the complete grant descriptor");
}
const executableGrantId = executableAssertion.properties.grantId;
if (
  executableGrantId.type !== "string" ||
  executableGrantId.format !== "uuid" ||
  executableGrantId.nullable === true
) {
  fail("executable controller assertions must carry a required UUID grant identifier");
}
if (
  authorization.SubmitControllerAuthorizedActionRequestDto.properties.assertion.$ref !==
  "#/ControllerAssertionEvidence"
) {
  fail("browser submission must use pre-admission controller assertion evidence");
}
const boundedReference = authorization.BoundedGrantReference;
if (boundedReference.additionalProperties !== false) {
  fail("grant references must reject unknown fields");
}
expectExact(
  boundedReference.required,
  ["kind", "grantId"],
  "bounded grant reference fields",
);
expectExact(
  Object.keys(boundedReference.properties),
  ["kind", "grantId"],
  "bounded grant reference properties",
);

requireFields(
  api.components.schemas.MachineDto,
  ["authorizationProtocolVersion", "executionReadiness"],
  "MachineDto",
);
requireFields(
  conversations.ConversationCliStatusResponseDto,
  ["authorizationProtocolVersion", "executionReadiness"],
  "ConversationCliStatusResponseDto",
);

const prepareRequest = authorization.PrepareControllerAuthorizationRequestDto;
expectExact(
  prepareRequest.required,
  ["machineId", "controllerCredentialId", "cadence", "action"],
  "prepare request fields",
);
if (prepareRequest.properties.controllerInstallationId) {
  fail("prepare request must derive controller installation from the browser binding");
}

const resolveRequest = authorization.ResolveControllerAuthorizationRequestDto;
expectExact(
  resolveRequest.required,
  ["machineId", "action"],
  "active-grant resolution request fields",
);
if (resolveRequest.properties.cadence || resolveRequest.properties.grantId) {
  fail("active-grant resolution must not accept local cadence or grant authority");
}
const resolveResponse = authorization.ResolveControllerAuthorizationResponseDto;
expectExact(
  resolveResponse.oneOf.map((entry) => entry.$ref),
  [
    "#/ControllerAuthorizationRequiredDto",
    "#/ActiveControllerAuthorizationGrantDto",
  ],
  "active-grant resolution response arms",
);
const activeGrant = authorization.ActiveControllerAuthorizationGrantDto;
expectExact(
  activeGrant.required,
  ["outcome", "authorization", "effectiveExpiresAtMs"],
  "active-grant result fields",
);
if (activeGrant.properties.authorization.$ref !== "#/BoundedGrantReference") {
  fail("active-grant resolution must return only a bounded grant reference");
}

const prepareResponse = authorization.PrepareControllerAuthorizationResponseDto;
expectExact(
  prepareResponse.required,
  ["intent", "publicKey", "grantDescriptor"],
  "preparation response fields",
);
if (
  prepareResponse.properties.grantDescriptor.$ref !==
  "#/ControllerDeviceGrantDescriptor"
) {
  fail("preparation must return the complete immutable grant descriptor");
}

const allowedCredentials =
  authorization.ControllerAuthorizationRequestOptions.properties.allowCredentials;
if (allowedCredentials.minItems !== 1) {
  fail("controller authorization options must return at least one eligible credential");
}
if (allowedCredentials.maxItems !== 1) {
  fail("controller authorization options must contain only the server-resolved credential");
}

const executableMessage = conversations.SubmitExecutableUserMessageRequestDto.allOf[1];
expectExact(
  executableMessage.required,
  ["authorization", "operationId", "operationFingerprint", "agentSessionId"],
  "executable user message fields",
);
if (
  executableMessage.properties.authorization.$ref !==
  "./controller-authorization.yaml#/AdmissionEnvelopeAuthorization" ||
  executableMessage.properties.authorizationId
) {
  fail("executable user messages must use the closed authorization union");
}
const startRunRequest = conversations.ConversationStartRunRequestDto.allOf[1];
expectExact(
  startRunRequest.required,
  ["authorization", "operationId", "operationFingerprint", "machineId"],
  "conversation start-run fields",
);
if (
  startRunRequest.properties.authorization.$ref !==
  "./controller-authorization.yaml#/AdmissionEnvelopeAuthorization" ||
  startRunRequest.properties.authorizationId
) {
  fail("conversation start-run must use the closed authorization union");
}
const monitorRequest = monitor.SubmitTaskMonitorCommandRequestDto;
if (!Array.isArray(monitorRequest.oneOf) || monitorRequest.oneOf.length !== 3) {
  fail("Task Monitor requests must split authorization requirements by command authority");
}
const [monitorIncreasingRequest, monitorReductionRequest, monitorNeutralRequest] = monitorRequest.oneOf;
expectExact(
  [monitorIncreasingRequest.$ref, monitorReductionRequest.$ref, monitorNeutralRequest.$ref],
  [
    "#/SubmitTaskMonitorAuthorityIncreasingCommandRequestDto",
    "#/SubmitTaskMonitorAuthorityReductionCommandRequestDto",
    "#/SubmitTaskMonitorAuthorityNeutralCommandRequestDto",
  ],
  "Task Monitor request arms",
);
const monitorIncreasing =
  monitor.SubmitTaskMonitorAuthorityIncreasingCommandRequestDto;
const monitorReduction =
  monitor.SubmitTaskMonitorAuthorityReductionCommandRequestDto;
expectExact(
  monitorIncreasing.required,
  ["requestId", "authorization", "command"],
  "Task Monitor authority-increasing request fields",
);
if (
  monitorIncreasing.properties.authorization.$ref !==
    "./controller-authorization.yaml#/AdmissionEnvelopeAuthorization" ||
  monitorIncreasing.properties.authorizationId ||
  monitorIncreasing.properties.command.$ref !==
    "#/TaskMonitorAuthorityIncreasingCommand" ||
  monitorReduction.properties.command.$ref !==
    "#/TaskMonitorAuthorityReductionCommand" ||
  monitorReduction.properties.authorization
) {
  fail("Task Monitor reductions must omit authorization while increasing commands require it");
}

expectExact(
  monitor.TaskMonitorAuthorityIncreasingCommand.oneOf.map((entry) => entry.$ref),
  [
    "#/TaskMonitorStartCommand",
    "#/TaskMonitorResumeCommand",
    "#/TaskMonitorJudgmentResolvedCommand",
    "#/TaskMonitorContinueCommand",
    "#/TaskMonitorCompleteCommand",
  ],
  "Task Monitor authority-increasing commands",
);
expectExact(
  monitor.TaskMonitorAuthorityReductionCommand.oneOf.map((entry) => entry.$ref),
  ["#/TaskMonitorPauseCommand", "#/TaskMonitorStopCommand", "#/TaskMonitorHaltCommand"],
  "Task Monitor reductions",
);
expectExact(monitor.MonitorCommandBody.properties.version.enum, [1], "legacy monitor version");
expectExact(monitor.MonitorCommandBodyV2.properties.version.enum, [2], "protocol-2 monitor version");

const executableFrames = {
  WebSocketConversationTriggerEvent: "#/ControllerAuthorizedSignedConversationTriggerEnvelope",
  WebSocketConversationControlEvent: "#/ControllerAuthorizedSignedConversationControlEnvelope",
  WebSocketMonitorCommandEvent: "#/ControllerAuthorizedSignedMonitorCommandEnvelope",
  WebSocketCliReadRequestEvent: "#/ControllerAuthorizedSignedCliReadEnvelope",
  WebSocketApplicationEffectEvent: "#/ControllerAuthorizedSignedApplicationEffectEnvelope",
  WebSocketExactActionEvent: "#/ControllerAuthorizedSignedExactActionEnvelope",
};

for (const [frameName, expectedRef] of Object.entries(executableFrames)) {
  const frameEnvelope = websockets[frameName].allOf[1].properties.envelope;
  if (frameName === "WebSocketMonitorCommandEvent") {
    expectExact(
      (frameEnvelope.oneOf ?? []).map((entry) => entry.$ref),
      [expectedRef, "#/SignedMonitorAuthorityNeutralEnvelope"],
      "monitor command envelope arms",
    );
  } else if (frameEnvelope.$ref !== expectedRef) {
    fail(`${frameName} must reference ${expectedRef}`);
  }
  const envelope = websockets[expectedRef.slice(2)];
  if (envelope.additionalProperties !== false) fail(`${expectedRef} must reject unknown fields`);
  requireFields(envelope, ["protocolVersion", "authorization", "event", "signature"], expectedRef);
  if (
    envelope.properties.authorization.$ref !==
    "./controller-authorization.yaml#/ExecutableEnvelopeAuthorization"
  ) {
    fail(`${expectedRef} must use the shared activation-or-reuse authorization union`);
  }
  expectExact(envelope.properties.protocolVersion.enum, [2], `${expectedRef} protocol version`);
}

for (const envelopeName of ["SignedConversationReductionEnvelope", "SignedMonitorReductionEnvelope", "SignedMonitorAuthorityNeutralEnvelope"]) {
  const envelope = websockets[envelopeName];
  if (envelope.additionalProperties !== false) fail(`${envelopeName} must reject unknown fields`);
  if (envelope.properties.authorization || envelope.required.includes("authorization")) {
    fail(`${envelopeName} must not inherit the execution gate`);
  }
  expectExact(envelope.properties.protocolVersion.enum, [2], `${envelopeName} protocol version`);
}

const protocol2FrameTypes = [
  "trigger.control_reduction",
  "trigger.monitor_reduction",
  "trigger.application_effect",
  "trigger.exact_action",
];
const subscriptionEventTypes =
  websockets.WebSocketSubscriptionRequest.properties.eventTypes.items.enum;
for (const frameType of protocol2FrameTypes) {
  if (!subscriptionEventTypes.includes(frameType)) {
    fail(`WebSocketSubscriptionRequest must allow ${frameType}`);
  }
}

for (const legacyName of [
  "SignedConversationTriggerEnvelope",
  "SignedConversationControlEnvelope",
  "SignedMonitorCommandEnvelope",
  "SignedCliReadEnvelope",
]) {
  if (!websockets[legacyName]) fail(`${legacyName} compatibility definition is missing`);
}

console.log("Controller authorization contract validation passed.");
