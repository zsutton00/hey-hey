import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProjectApprovalPolicyRule,
  ProjectApprovalPolicySnapshot,
} from "../../api";
import { createApiRuntime } from "../../clients/createApiRuntime";
import { registerApiRuntime } from "../../clients/runtimeRegistry";
import { projectApprovalPolicyKey } from "../../data/collections/projectApprovalPolicy";
import { proposalKeys } from "../../data/collections/proposals";
import { ProjectApprovalSettings } from "./ProjectApprovalSettings";

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: {} } },
  initImmediate: false,
});
const effective = (
  order: number,
  source: "FIXED" | "PROJECT" | "DEFAULT",
  conditions: ProjectApprovalPolicySnapshot["rules"][number]["conditions"],
  rest: Partial<ProjectApprovalPolicySnapshot["rules"][number]> = {},
): ProjectApprovalPolicySnapshot["rules"][number] => ({
  order,
  source,
  editable: source === "PROJECT",
  conditions,
  requirement: "PROJECT_REQUIRED",
  requiredApprovals: 1,
  allowsProposerApproval: false,
  ...rest,
});
// A populated project: several types, Default, a retired type, fixed and built-in rules.
const initial = (projectId: string): ProjectApprovalPolicySnapshot => ({
  projectId,
  revision: 2,
  hasProjectOverride: true,
  rules: [
    effective(
      0,
      "FIXED",
      { typeKey: "FEATURE", topLevel: true },
      {
        requirement: "FIXED_REQUIRED",
      },
    ),
    effective(
      1,
      "PROJECT",
      {
        typeKey: "marketing",
        author: "USER",
        action: "UPDATE",
        change: "STATUS_ONLY",
      },
      {
        requirement: "IMMEDIATE",
        requiredApprovals: 0,
        allowsProposerApproval: true,
      },
    ),
    effective(
      2,
      "PROJECT",
      { typeKey: "marketing", author: "USER", change: "CONTENT_CHANGE" },
      { requiredApprovals: 2 },
    ),
    effective(3, "PROJECT", {
      typeKey: "FEATURE",
      author: "AGENT",
      topLevel: true,
    }),
    effective(4, "PROJECT", { typeKey: "retired", action: "DELETE" }),
    effective(5, "PROJECT", {}, { requiredApprovals: 3 }),
    effective(6, "DEFAULT", { typeKey: "SERVICE" }),
  ],
  fallback: {
    source: "DEFAULT",
    editable: false,
    requiresProposal: false,
    requirement: "PROJECT_REQUIRED",
    requiredApprovals: 1,
    allowsProposerApproval: false,
  },
});
// Mirrors the API's code-owned defaults: the protected FEATURE rule is tenth.
const defaultSnapshot = (projectId: string): ProjectApprovalPolicySnapshot => ({
  ...initial(projectId),
  hasProjectOverride: false,
  rules: [
    {
      typeKey: "GOAL",
      author: "USER",
      action: "UPDATE",
      change: "STATUS_ONLY",
    },
    { typeKey: "GOAL", author: "USER", action: "UPDATE" },
    { typeKey: "DESIGN_DOC", author: "USER" },
    { typeKey: "DESIGN_DOC", author: "AGENT" },
    { typeKey: "PLAN_STAGE", author: "USER" },
    { typeKey: "PLAN_STAGE", author: "AGENT" },
    { typeKey: "WORK_ITEM_TYPE", author: "USER" },
    { typeKey: "WORK_ITEM_TYPE", author: "AGENT" },
    { typeKey: "TASK_MONITOR", author: "USER", action: "UPDATE" },
    {
      typeKey: "FEATURE",
      topLevel: true,
      author: "AGENT",
      toolName: "shared-generate-features",
    },
    {
      typeKey: "FEATURE",
      topLevel: true,
      author: "USER",
      featureContentChange: true,
    },
    { typeKey: "FEATURE", topLevel: true, featureContentChange: true },
    {
      typeKey: "FEATURE",
      topLevel: true,
      author: "USER",
      featureContentChange: false,
    },
    {
      typeKey: "FEATURE",
      topLevel: true,
      author: "AGENT",
      featureContentChange: false,
    },
    { topLevel: false, author: "USER" },
    { topLevel: false, author: "AGENT" },
  ].map(
    (conditions, order) =>
      ({
        conditions,
        order,
        editable: false,
        source: order === 9 ? "FIXED" : "DEFAULT",
        requirement:
          order === 9
            ? "FIXED_REQUIRED"
            : [0, 2, 4, 6, 8, 10, 12, 14].includes(order)
              ? "IMMEDIATE"
              : "PROJECT_REQUIRED",
        requiredApprovals: [0, 2, 4, 6, 8, 10, 12, 14].includes(order) ? 0 : 1,
        allowsProposerApproval: conditions.author === "USER",
      }) satisfies ProjectApprovalPolicySnapshot["rules"][number],
  ),
});
function setup(
  role = "OWNER",
  searchParams = "?approvalType=marketing",
  scope = {
    organizationId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
  },
  snapshot = initial,
) {
  const { organizationId, projectId } = scope;
  let saved = snapshot(projectId);
  let fail: "validation" | "conflict" | "network" | null = null;
  let pendingWrite: Promise<void> | null = null;
  const holdWrites = () => {
    let release = () => {};
    pendingWrite = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      pendingWrite = null;
      release();
    };
  };
  const writes: {
    method: string;
    body: { expectedRevision: number; rules?: ProjectApprovalPolicyRule[] };
  }[] = [];
  const requests: InternalAxiosRequestConfig[] = [];
  const transport = axios.create({
    adapter: async (config) => {
      requests.push(config);
      const reply = (data: unknown, status = 200) => ({
        data,
        status,
        statusText: "OK",
        headers: new AxiosHeaders(),
        config,
      });
      if (config.url?.endsWith("/approval-policy")) {
        if (config.method === "get") {
          const requestedProjectId = config.url.split("/").at(-2);
          return reply({
            data:
              requestedProjectId === projectId
                ? saved
                : initial(requestedProjectId!),
          });
        }
        const body = JSON.parse(config.data);
        writes.push({ method: config.method!, body });
        if (pendingWrite) {
          await pendingWrite;
        }
        if (fail === "network") {
          throw new AxiosError("Offline", "ERR_NETWORK", config);
        }
        if (fail) {
          const data =
            fail === "conflict"
              ? { code: "PROJECT_APPROVAL_POLICY_REVISION_CONFLICT" }
              : {
                  code: "PROJECT_APPROVAL_POLICY_VALIDATION_FAILED",
                  issues: [
                    {
                      path: "/rules/0/requiredApprovals",
                      message: "Unsupported count",
                    },
                  ],
                };
          throw new AxiosError(
            "Rejected",
            "ERR_BAD_REQUEST",
            config,
            undefined,
            reply(data, fail === "conflict" ? 409 : 400),
          );
        }
        if (config.method === "post") {
          saved = {
            ...defaultSnapshot(projectId),
            revision: saved.revision + 1,
          };
          return reply({ data: saved });
        }
        saved = {
          ...saved,
          revision: saved.revision + 1,
          hasProjectOverride: config.method !== "post",
          rules: [
            ...saved.rules.filter((rule) => rule.source === "FIXED"),
            ...(body.rules ?? []).map(
              (rule: ProjectApprovalPolicyRule, index: number) => ({
                ...rule,
                source: "PROJECT",
                editable: true,
                order: index + 1,
              }),
            ),
            ...saved.rules.filter((rule) => rule.source === "DEFAULT"),
          ],
        };
        return reply({ data: saved });
      }
      if (config.url?.endsWith("/work-item-types")) {
        return reply({
          data: ["marketing", "FEATURE", "retired"].map((key) => ({
            id: key,
            projectId,
            status: key === "retired" ? "ARCHIVED" : "ACTIVE",
            effectiveSource: "CANONICAL",
            definition: {
              key,
              name: key === "marketing" ? "Marketing today" : "Feature",
              role: "project-info",
              sections: [],
              allowedStatuses: [],
            },
          })),
        });
      }
      if (config.url?.endsWith(projectId)) {
        return reply({ data: { id: projectId, currentUserRole: role } });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    },
  });
  registerApiRuntime(
    createApiRuntime({
      baseUrl: "http://approval.test/api/v1",
      transport: {
        axios: transport,
        request: (config) => transport.request(config),
        setAuthToken: vi.fn(),
      },
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    proposalKeys.detail(organizationId, projectId, "pending"),
    { previous: true },
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter searchParams={searchParams} hasMemory>
          {children}
        </NuqsTestingAdapter>
      </I18nextProvider>
    </QueryClientProvider>
  );
  const mount = () =>
    render(
      <ProjectApprovalSettings
        organizationId={organizationId}
        projectId={projectId}
      />,
      { wrapper: Wrapper },
    );
  const view = mount();
  return {
    ...view,
    mount,
    Wrapper,
    client,
    holdWrites,
    organizationId,
    projectId,
    writes,
    requests,
    fail: (value: typeof fail) => {
      fail = value;
    },
    externalSave: () => {
      saved = { ...saved, revision: 9 };
    },
    // Another person removes the project rule at this order and saves.
    externalRemove: (order: number) => {
      saved = {
        ...saved,
        revision: 9,
        rules: saved.rules
          .filter((rule) => rule.order !== order)
          .map((rule, position) => ({ ...rule, order: position })),
      };
    },
  };
}
const ready = async () => {
  await screen.findByTestId("approval-add-rule");
};
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

const field = (name: string) =>
  within(screen.getByTestId(`approval-rule-field-${name}`));
const control = (name: string) =>
  name === "credit" || name === "approvals" || name === "priority"
    ? field(name).getByRole(name === "credit" ? "checkbox" : "textbox")
    : field(name).getByRole("combobox");
const submit = () =>
  userEvent.click(screen.getByTestId("approval-rule-submit"));

describe("project approval settings", () => {
  it("lists saved rules read-only, stating every condition including Any", async () => {
    setup("OWNER", "?approvalType=marketing");
    await ready();
    expect(screen.queryByTestId("approval-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-discard")).not.toBeInTheDocument();

    const rows = screen.getAllByTestId("approval-effective-rule");
    const group = rows.filter((row) => row.textContent?.includes("marketing"));
    expect(group).toHaveLength(2);
    group.forEach((row) => {
      expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
      expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();
      expect(within(row).queryByRole("checkbox")).not.toBeInTheDocument();
    });
    expect(group[1]).toHaveTextContent(
      "Author: User · Action: Any · Changes: Content changes",
    );
    // Add rule shares the group's heading line.
    const heading = screen.getByTestId("approval-group-heading");
    expect(within(heading).getByTestId("approval-add-rule")).toBeVisible();
    expect(
      screen.getByTestId("approval-restore").parentElement,
    ).toContainElement(screen.getByRole("heading", { name: "Approval rules" }));
  });

  it("states Top-level on Feature rules", async () => {
    setup("OWNER", "?approvalType=FEATURE");
    await ready();
    expect(
      screen
        .getAllByTestId("approval-effective-rule")
        .map((row) => row.textContent),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "Author: Agent · Action: Any · Changes: Any · Top-level: Top-level only",
        ),
      ]),
    );
  });

  it("lets readers inspect rules without any controls", async () => {
    setup("VIEWER", "?approvalType=marketing");
    await screen.findAllByTestId("approval-effective-rule");
    expect(screen.queryByTestId("approval-add-rule")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-restore")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-rule-edit")).not.toBeInTheDocument();
  });

  it("adds a rule with explicit starting values, saving it at once with the revision", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    const opener = screen.getByTestId("approval-add-rule");
    await userEvent.click(opener);

    expect(screen.getByTestId("approval-rule-type")).toHaveTextContent(
      "Marketing today",
    );
    expect(control("author")).toHaveValue("ANY");
    expect(control("action")).toHaveValue("ANY");
    expect(control("change")).toHaveValue("ANY");
    expect(control("outcome")).toHaveValue("PROJECT_REQUIRED");
    expect(control("approvals")).toHaveValue("1");
    expect(control("priority")).toHaveValue("7");
    expect(
      screen.queryByTestId("approval-rule-field-topLevel"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("approval-rule-delete"),
    ).not.toBeInTheDocument();

    await userEvent.selectOptions(control("author"), "AGENT");
    await submit();

    await waitFor(() => expect(view.writes).toHaveLength(1));
    const { body } = view.writes[0];
    expect(body.expectedRevision).toBe(2);
    expect(body.rules).toHaveLength(6);
    expect(body.rules?.at(-1)).toEqual({
      conditions: { typeKey: "marketing", author: "AGENT" },
      requirement: "PROJECT_REQUIRED",
      requiredApprovals: 1,
      allowsProposerApproval: false,
    });
    // The retired type's stored rule is re-sent unchanged.
    expect(body.rules?.[3].conditions).toEqual({
      typeKey: "retired",
      action: "DELETE",
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("approval-rule-modal"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("approval-effective-rule")
          .filter((row) => row.textContent?.includes("marketing")),
      ).toHaveLength(3),
    );
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("adds a Default rule without a type", async () => {
    const view = setup("OWNER", "");
    await ready();
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    expect(screen.queryByTestId("approval-rule-type")).not.toBeInTheDocument();
    await submit();
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0].body.rules?.at(-1)?.conditions).toEqual({});
  });

  it("edits one rule in place, moving it by its priority", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getAllByTestId("approval-rule-edit")[1]);
    expect(screen.getByRole("heading", { name: /Edit rule/ })).toBeVisible();
    expect(control("author")).toHaveValue("USER");
    expect(control("change")).toHaveValue("CONTENT_CHANGE");
    expect(control("approvals")).toHaveValue("2");
    expect(control("priority")).toHaveValue("3");

    await userEvent.selectOptions(control("outcome"), "IMMEDIATE");
    expect(control("approvals")).toHaveValue("0");
    await userEvent.clear(control("priority"));
    await userEvent.type(control("priority"), "2");
    await userEvent.click(screen.getByText("Update rule"));

    await waitFor(() => expect(view.writes).toHaveLength(1));
    const rules = view.writes[0].body.rules!;
    expect(rules).toHaveLength(5);
    expect(rules[0]).toMatchObject({
      conditions: {
        typeKey: "marketing",
        author: "USER",
        change: "CONTENT_CHANGE",
      },
      requirement: "IMMEDIATE",
      requiredApprovals: 0,
    });
    expect(rules[1].conditions.change).toBe("STATUS_ONLY");
  });

  it("deletes only the chosen rule after confirmation", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getAllByTestId("approval-rule-edit")[0]);
    await userEvent.click(screen.getByTestId("approval-rule-delete"));
    expect(view.writes).toHaveLength(0);
    expect(screen.getByTestId("approval-rule-delete-confirm")).toBeVisible();
    await userEvent.click(
      screen.getByTestId("approval-rule-delete-confirm-button"),
    );
    await waitFor(() => expect(view.writes).toHaveLength(1));
    const rules = view.writes[0].body.rules!;
    expect(rules).toHaveLength(4);
    expect(rules.map((rule) => rule.conditions.typeKey)).toEqual([
      "marketing",
      "FEATURE",
      "retired",
      undefined,
    ]);
  });

  it("shows an unavailable type, keeps it from being chosen and lets its rule be deleted", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    const historical = await screen.findByTestId("approval-historical-rule");
    expect(historical).toHaveTextContent("Unavailable type");
    await userEvent.click(within(historical).getByTestId("approval-rule-edit"));
    expect(screen.getByTestId("approval-rule-type")).toHaveTextContent(
      "retired · Unavailable type",
    );
    await userEvent.click(screen.getByTestId("approval-rule-delete"));
    await userEvent.click(
      screen.getByTestId("approval-rule-delete-confirm-button"),
    );
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(
      view.writes[0].body.rules?.some(
        (rule) => rule.conditions.typeKey === "retired",
      ),
    ).toBe(false);
  });

  it("shows invalid entries beside their field and saves nothing", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    await userEvent.clear(control("approvals"));
    await userEvent.type(control("approvals"), "0");
    await submit();

    const input = control("approvals");
    expect(input).toHaveAttribute("aria-invalid", "true");
    const messageId = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(messageId)).toHaveTextContent(
      /whole number of approvals/,
    );
    expect(view.writes).toHaveLength(0);
    expect(screen.getByTestId("approval-rule-modal")).toBeVisible();
  });

  it("keeps entries and offers the latest settings when the API rejects the rule", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    await userEvent.selectOptions(control("author"), "USER");
    view.fail("validation");
    await submit();
    await waitFor(() =>
      expect(control("approvals")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(field("approvals").getByText("Unsupported count")).toBeVisible();
    expect(control("author")).toHaveValue("USER");
  });

  it("keeps every entry after a revision conflict and requires reviewing the latest settings", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    await userEvent.selectOptions(control("action"), "CREATE");
    await userEvent.clear(control("approvals"));
    await userEvent.type(control("approvals"), "4");
    view.fail("conflict");
    view.externalSave();
    await submit();

    expect(
      await screen.findByTestId("approval-rule-save-error"),
    ).toHaveTextContent(/Your entries are kept/);
    expect(control("action")).toHaveValue("CREATE");
    expect(control("approvals")).toHaveValue("4");

    // Retrying before reviewing sends nothing.
    view.fail(null);
    await submit();
    expect(view.writes).toHaveLength(1);

    await userEvent.click(screen.getByTestId("approval-review-latest"));
    await waitFor(() =>
      expect(screen.getByTestId("approval-review-latest")).toBeEnabled(),
    );
    await submit();
    await waitFor(() => expect(view.writes).toHaveLength(2));
    expect(view.writes[1].body.expectedRevision).toBe(9);
    expect(view.writes[1].body.rules?.at(-1)).toMatchObject({
      conditions: { typeKey: "marketing", action: "CREATE" },
      requiredApprovals: 4,
    });
  });

  it("applies a save after reviewing to the rule that was opened, not to whatever now sits at its position", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    // Edit the second marketing rule (position 2) while someone removes rule 1.
    await userEvent.click(screen.getAllByTestId("approval-rule-edit")[1]);
    await userEvent.clear(control("approvals"));
    await userEvent.type(control("approvals"), "5");
    view.fail("conflict");
    view.externalRemove(1);
    await submit();
    await screen.findByTestId("approval-rule-save-error");

    view.fail(null);
    await userEvent.click(screen.getByTestId("approval-review-latest"));
    await waitFor(() =>
      expect(screen.getByTestId("approval-review-latest")).toBeEnabled(),
    );
    await submit();

    await waitFor(() => expect(view.writes).toHaveLength(2));
    const rules = view.writes[1].body.rules!;
    expect(view.writes[1].body.expectedRevision).toBe(9);
    expect(rules).toHaveLength(4);
    expect(
      rules.map((rule) => [rule.conditions.typeKey, rule.requiredApprovals]),
    ).toEqual([
      ["marketing", 5],
      ["FEATURE", 1],
      ["retired", 1],
      [undefined, 3],
    ]);
  });

  it("does not delete another rule when the opened rule was removed meanwhile", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getAllByTestId("approval-rule-edit")[1]);
    await userEvent.click(screen.getByTestId("approval-rule-delete"));
    view.fail("conflict");
    view.externalRemove(2);
    await userEvent.click(
      screen.getByTestId("approval-rule-delete-confirm-button"),
    );
    await screen.findByTestId("approval-rule-save-error");

    view.fail(null);
    await userEvent.click(screen.getByTestId("approval-review-latest"));
    await waitFor(() =>
      expect(screen.getByTestId("approval-review-latest")).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId("approval-rule-delete"));
    await userEvent.click(
      screen.getByTestId("approval-rule-delete-confirm-button"),
    );

    expect(
      await screen.findByTestId("approval-rule-save-error"),
    ).toHaveTextContent(/removed or changed/);
    expect(view.writes).toHaveLength(1);
    expect(screen.getByTestId("approval-rule-modal")).toBeVisible();
  });

  it("saves a Feature rule as Top-level only, Not top-level or Any", async () => {
    const view = setup("OWNER", "?approvalType=FEATURE");
    await ready();
    for (const [choice, expected] of [
      ["TOP_LEVEL", true],
      ["NOT_TOP_LEVEL", false],
      ["ANY", undefined],
    ] as const) {
      await userEvent.click(screen.getByTestId("approval-add-rule"));
      expect(control("topLevel")).toHaveValue("ANY");
      await userEvent.selectOptions(control("topLevel"), choice);
      await submit();
      await waitFor(() =>
        expect(
          screen.queryByTestId("approval-rule-modal"),
        ).not.toBeInTheDocument(),
      );
      const rule = view.writes.at(-1)!.body.rules!.at(-1)!;
      expect(rule.conditions).toEqual({
        typeKey: "FEATURE",
        ...(expected === undefined ? {} : { topLevel: expected }),
      });
    }
    expect(view.writes).toHaveLength(3);
  });

  it("closes without saving on Cancel, the close control and Escape, returning focus", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    const opener = screen.getByTestId("approval-add-rule");
    await userEvent.click(opener);
    await userEvent.selectOptions(control("author"), "USER");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByTestId("approval-rule-modal"),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(opener).toHaveFocus());

    await userEvent.click(opener);
    expect(control("author")).toHaveValue("ANY");
    await userEvent.click(screen.getByTestId("approval-rule-cancel"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("approval-rule-modal"),
      ).not.toBeInTheDocument(),
    );
    expect(view.writes).toHaveLength(0);
  });

  it("gives each field an info control that is keyboard reachable and readable", async () => {
    setup("OWNER", "?approvalType=FEATURE");
    await ready();
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    const info = screen.getByRole("button", { name: "About Top-level" });
    info.focus();
    await userEvent.keyboard("{Enter}");
    expect(info).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent(
      "A Feature is top-level when it has no parent task",
    );
  });

  it("moves a rule's priority with the same revision check and offers review on conflict", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getAllByTestId("approval-rule-move-later")[0]);
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0].body.expectedRevision).toBe(2);
    expect(view.writes[0].body.rules?.[0].conditions.change).toBe(
      "CONTENT_CHANGE",
    );

    view.fail("conflict");
    await userEvent.click(screen.getAllByTestId("approval-rule-move-later")[0]);
    expect(await screen.findByTestId("approval-save-error")).toHaveTextContent(
      /Someone saved newer settings/,
    );
    expect(screen.getByTestId("approval-page-review-latest")).toBeVisible();
  });

  it("splits project rules from locked built-in rules into two tabs with continuous priorities", async () => {
    setup("OWNER", "");
    await ready();
    const projectTab = screen.getByRole("tab", { name: "Project rules (5)" });
    const builtinTab = screen.getByRole("tab", { name: "Built-in rules (2)" });
    expect(projectTab).toHaveAttribute("aria-selected", "true");
    expect(builtinTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("approval-builtin-panel")).toBeNull();

    // The Default group lists only the typeless project rule; the retired
    // type's rule sits in its own Unavailable card. No built-in rows appear.
    const groupRows = within(
      screen.getByTestId("approval-group-heading").parentElement!,
    ).getAllByTestId("approval-effective-rule");
    expect(groupRows).toHaveLength(1);
    expect(groupRows[0]).toHaveTextContent("Global priority 6");
    expect(groupRows[0]).toHaveTextContent("Project configuration");
    expect(screen.getAllByTestId("approval-effective-rule")).toHaveLength(2);
    expect(screen.queryByText(/Built-in/, { selector: "span" })).toBeNull();
    expect(screen.queryByText("Fixed requirement")).toBeNull();

    await userEvent.click(builtinTab);
    expect(builtinTab).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByTestId("approval-project-panel")).toBeNull();
    expect(screen.queryByTestId("approval-add-rule")).toBeNull();
    expect(screen.queryByTestId("approval-rule-edit")).toBeNull();
    expect(screen.queryByTestId("approval-rule-move-later")).toBeNull();

    const fixedPart = within(screen.getByTestId("approval-fixed-counts"));
    expect(fixedPart.getByText("Fixed approval counts")).toBeVisible();
    expect(
      fixedPart.getByText(/set by Hey Hey\. The project approval setting/),
    ).toBeVisible();
    const fixedRows = fixedPart.getAllByTestId("approval-effective-rule");
    expect(fixedRows).toHaveLength(1);
    expect(fixedRows[0]).toHaveTextContent("Global priority 1");
    expect(fixedRows[0]).toHaveTextContent("Built-in · Fixed");
    expect(fixedRows[0]).toHaveTextContent(
      "Always requires exactly 1 human approval(s). The project's approval setting does not change it.",
    );

    const defaultsPart = within(
      screen.getByTestId("approval-standard-defaults"),
    );
    expect(defaultsPart.getByText("Standard defaults")).toBeVisible();
    expect(
      defaultsPart.getByText(/when no project rule matches/),
    ).toBeVisible();
    const defaultBuiltIns = defaultsPart.getAllByTestId(
      "approval-effective-rule",
    );
    expect(defaultBuiltIns).toHaveLength(1);
    expect(defaultBuiltIns[0]).toHaveTextContent("Global priority 7");
    expect(defaultBuiltIns[0]).toHaveTextContent("Type: SERVICE");
    expect(defaultsPart.getByTestId("approval-fallback")).toBeVisible();
  });

  it("opens the Built-in rules tab from the link and keeps viewers read-only", async () => {
    setup("VIEWER", "?approvalTab=builtin");
    await screen.findByTestId("approval-builtin-panel");
    expect(screen.getByRole("tab", { name: /Built-in rules/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("restores defaults for project rules only, after confirmation", async () => {
    const view = setup("OWNER", "?approvalTab=builtin");
    await screen.findByTestId("approval-builtin-panel");
    await userEvent.click(screen.getByTestId("approval-restore"));
    expect(
      screen.getByText(
        /Built-in rules, including fixed approval counts, never change/,
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByTestId("approval-restore-confirm"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0].method).toBe("post");
  });

  it("asks before restoring defaults", async () => {
    const view = setup("OWNER", "?approvalType=marketing");
    await ready();
    await userEvent.click(screen.getByTestId("approval-restore"));
    await userEvent.click(screen.getByTestId("approval-restore-cancel"));
    expect(view.writes).toHaveLength(0);

    await userEvent.click(screen.getByTestId("approval-restore"));
    await userEvent.click(screen.getByTestId("approval-restore-confirm"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0]).toMatchObject({
      method: "post",
      body: { expectedRevision: 2 },
    });
  });
});
