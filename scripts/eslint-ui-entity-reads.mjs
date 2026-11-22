const restReads = [
  "getTask",
  "getTasks",
  "getWorkItem",
  "getWorkItemConversations",
  "getWorkItemGraph",
  "listWorkItemReferences",
  "getActiveConversations",
  "getAllConversations",
  "getConversation",
  "getConversationVersion",
  "getWorkflowConversations",
  "getLatestMessage",
  "getMessage",
  "getMessages",
  "organizationsOrganizationIdProjectsProjectIdTasks(Get|TaskId(Get|HierarchyGet|DependenciesGet))",
  "organizationsOrganizationIdProjectsProjectIdWorkItems(ReferencesGet|WorkItemIdGraphGet)",
].join("|");

const message =
  "Read work items, conversations and messages through the GraphQL Data Layer.";

export const restrictedEntityReads = [
  "error",
  { selector: `MemberExpression[property.name=/^(${restReads})$/]`, message },
  {
    selector: `MemberExpression[computed=true][property.value=/^(${restReads})$/]`,
    message,
  },
  {
    selector: `ObjectPattern > Property[key.name=/^(${restReads})$/]`,
    message,
  },
  {
    selector: `ObjectPattern > Property[key.value=/^(${restReads})$/]`,
    message,
  },
];

const entityReadPaths = [
  /^(?:tasks|work-items)(?:\/[^/]+(?:\/(?:graph|hierarchy|dependencies))?)?$/,
  /^conversations(?:\/[^/]+(?:\/version|\/messages(?:\/latest)?)?)?$/,
  /^messages(?:\/[^/]+)?$/,
  /^workflows\/[^/]+\/[^/]+\/conversations$/,
];

function localBinding(sourceCode, identifier) {
  for (
    let scope = sourceCode.getScope(identifier);
    scope;
    scope = scope.upper
  ) {
    const binding = scope.set.get(identifier.name);
    if (binding) {
      return binding;
    }
  }
}

function resolveConstant(sourceCode, node, seen = new Set()) {
  if (
    node?.type === "TSAsExpression" ||
    node?.type === "TSSatisfiesExpression"
  ) {
    return resolveConstant(sourceCode, node.expression, seen);
  }
  if (node?.type !== "Identifier") {
    return node;
  }

  const definitions = localBinding(sourceCode, node)?.defs ?? [];
  const [definition] = definitions;
  if (
    definitions.length !== 1 ||
    definition.type !== "Variable" ||
    definition.parent.kind !== "const" ||
    definition.node.id.type !== "Identifier" ||
    seen.has(definition)
  ) {
    return;
  }

  seen.add(definition);
  return resolveConstant(sourceCode, definition.node.init, seen);
}

function staticText(sourceCode, node, seen = new Set()) {
  const resolved = resolveConstant(sourceCode, node, seen);
  if (resolved?.type === "Literal" && typeof resolved.value === "string") {
    return resolved.value;
  }
  if (resolved?.type === "TemplateLiteral") {
    return resolved.quasis
      .map(({ value }, index) => {
        const expression = resolved.expressions[index];
        const substitution = expression
          ? (staticText(sourceCode, expression, new Set(seen)) ??
            "INTERPOLATION")
          : "";
        return value.cooked + substitution;
      })
      .join("");
  }
}

function objectProperty(sourceCode, node, name) {
  if (node?.type !== "ObjectExpression") {
    return;
  }
  return node.properties.find(
    (property) =>
      property.type === "Property" &&
      (property.computed
        ? staticText(sourceCode, property.key)
        : (property.key.name ?? property.key.value)) === name,
  )?.value;
}

function readUrl(sourceCode, { callee, arguments: [first, options] }) {
  const member =
    callee.type === "MemberExpression"
      ? callee.computed
        ? staticText(sourceCode, callee.property)
        : callee.property.name
      : undefined;
  const name = member ?? callee.name;
  if (member === "get") {
    return staticText(sourceCode, first);
  }
  if (name !== "fetch" && name !== "axios" && member !== "request") {
    return;
  }

  const firstValue = resolveConstant(sourceCode, first);
  const config =
    firstValue?.type === "ObjectExpression"
      ? firstValue
      : resolveConstant(sourceCode, options);
  if (options && config?.type !== "ObjectExpression") {
    return;
  }
  const method = objectProperty(sourceCode, config, "method");
  if (!method || staticText(sourceCode, method)?.toUpperCase() === "GET") {
    return (
      staticText(sourceCode, first) ??
      staticText(sourceCode, objectProperty(sourceCode, config, "url"))
    );
  }
}

function isEntityReadPath(url) {
  const [path] = url.split(/[?#]/, 1);
  const route = path
    .replace(/^(?:https?:\/\/[^/]+|INTERPOLATION)\//i, "")
    .replace(/^\//, "")
    .replace(/^api\/v1\//, "")
    .replace(/^organizations\/[^/]+\//, "")
    .replace(/^(?:projects|initiatives)\/[^/]+\//, "")
    .replace(/\/$/, "");
  return entityReadPaths.some((pattern) => pattern.test(route));
}

function isMswHandler(sourceCode, { callee }) {
  const receiver = callee.type === "MemberExpression" && callee.object;
  if (!receiver || receiver.type !== "Identifier") {
    return false;
  }

  return (
    localBinding(sourceCode, receiver)?.defs.some(
      (definition) =>
        definition.type === "ImportBinding" &&
        definition.parent.source.value === "msw",
    ) ?? false
  );
}

export const entityReadRoutesPlugin = {
  rules: {
    "no-rest-entity-read-url": {
      create(context) {
        return {
          CallExpression(node) {
            const url = readUrl(context.sourceCode, node);
            if (
              url &&
              isEntityReadPath(url) &&
              !isMswHandler(context.sourceCode, node)
            ) {
              context.report({ node, message });
            }
          },
        };
      },
    },
  },
};
