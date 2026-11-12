import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import { useApprovalPolicyDraft } from "./useApprovalPolicyDraft";

const i18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: {} } },
  initImmediate: false,
});
const projectRule = (typeKey?: string): ProjectApprovalPolicyRule => ({
  conditions: typeKey ? { typeKey } : {},
  requirement: "PROJECT_REQUIRED",
  requiredApprovals: 1,
  allowsProposerApproval: false,
});
const initial = (projectId: string): ProjectApprovalPolicySnapshot => ({
  projectId,
  revision: 2,
  hasProjectOverride: true,
  rules: [
    {
      ...projectRule(),
      requirement: "FIXED_REQUIRED",
      order: 0,
      source: "FIXED",
      editable: false,
    },
    {
      ...projectRule("marketing"),
      order: 1,
      source: "PROJECT",
      editable: true,
    },
    { ...projectRule("FEATURE"), order: 2, source: "PROJECT", editable: true },
    { ...projectRule(), order: 3, source: "PROJECT", editable: true },
    { ...projectRule("SERVICE"), order: 4, source: "DEFAULT", editable: false },
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
  };
}
const ready = async () => {
  await screen.findByTestId("approval-add-rule");
};
const count = () =>
  within(screen.getByTestId("approval-rule-count")).getByRole("spinbutton");
beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("project approval settings delivery", () => {
  it.each([
    { restore: false, differentOrganization: false },
    { restore: true, differentOrganization: false },
    { restore: false, differentOrganization: true },
    { restore: true, differentOrganization: true },
  ])(
    "keeps pending state across remounts and protects newer drafts (restore: $restore, different organization: $differentOrganization)",
    async ({ restore, differentOrganization }) => {
      const view = setup();
      await ready();
      fireEvent.change(count(), { target: { value: "3" } });
      const release = view.holdWrites();
      await userEvent.click(
        screen.getByTestId(restore ? "approval-restore" : "approval-save"),
      );
      await waitFor(() => expect(view.writes).toHaveLength(1));
      view.unmount();
      const remounted = view.mount();
      await ready();
      expect(count()).toBeDisabled();
      expect(screen.getByTestId("approval-save")).toBeDisabled();
      expect(screen.getByTestId("approval-restore")).toBeDisabled();
      await userEvent.type(count(), "9");
      expect(count()).toHaveValue(3);

      // A separate owner can produce a newer draft while the submitted request is in flight.
      const owner = renderHook(
        () => useApprovalPolicyDraft(view.organizationId, view.projectId),
        { wrapper: view.Wrapper },
      );
      const otherOrganization = differentOrganization
        ? crypto.randomUUID()
        : view.organizationId;
      const otherProject = differentOrganization
        ? view.projectId
        : crypto.randomUUID();
      view.client.setQueryData(
        projectApprovalPolicyKey(otherOrganization, otherProject),
        initial(otherProject),
      );
      const other = renderHook(
        () => useApprovalPolicyDraft(otherOrganization, otherProject),
        { wrapper: view.Wrapper },
      );
      await waitFor(() =>
        expect(other.result.current.policy.data).not.toBeNull(),
      );
      act(() => {
        owner.result.current.update([
          { ...projectRule("marketing"), requiredApprovals: 4 },
        ]);
        other.result.current.update([
          { ...projectRule("marketing"), requiredApprovals: 7 },
        ]);
      });
      expect(other.result.current.isPending).toBe(false);
      await act(async () => release());
      await waitFor(() => expect(count()).toBeEnabled());
      expect(count()).toHaveValue(4);
      expect(owner.result.current.dirty).toBe(true);
      expect(other.result.current.rules[0].requiredApprovals).toBe(7);
      expect(other.result.current.dirty).toBe(true);
      // The retained draft keeps its original revision; a retry cannot silently overwrite.
      await userEvent.click(screen.getByTestId("approval-save"));
      await waitFor(() => expect(view.writes).toHaveLength(2));
      expect(view.writes[1].body.expectedRevision).toBe(2);
      expect(view.writes[1].body.rules?.[0].requiredApprovals).toBe(4);
      await waitFor(() => expect(owner.result.current.dirty).toBe(false));
      expect(other.result.current.dirty).toBe(true);
      remounted.unmount();
      owner.unmount();
      other.unmount();
    },
  );

  it.each([false, true])(
    "clears only the submitted draft after a pending remount (restore: %s)",
    async (restore) => {
      const view = setup();
      await ready();
      fireEvent.change(count(), { target: { value: "3" } });
      const release = view.holdWrites();
      await userEvent.click(
        screen.getByTestId(restore ? "approval-restore" : "approval-save"),
      );
      await waitFor(() => expect(view.writes).toHaveLength(1));
      view.unmount();
      view.mount();
      await ready();
      expect(count()).toBeDisabled();
      await act(async () => release());
      await waitFor(() =>
        expect(screen.getByTestId("approval-discard")).toBeDisabled(),
      );
      if (restore) {
        expect(
          screen.queryByTestId("approval-rule-editor"),
        ).not.toBeInTheDocument();
      } else {
        expect(count()).toBeEnabled();
        expect(count()).toHaveValue(3);
      }
    },
  );

  it.each(["validation", "network"] as const)(
    "retains %s feedback through failure while unmounted and subsequent navigation, then recovers on retry",
    async (failure) => {
      const view = setup();
      await ready();
      fireEvent.change(count(), { target: { value: "3" } });
      view.fail(failure);
      const release = view.holdWrites();
      await userEvent.click(screen.getByTestId("approval-save"));
      await waitFor(() => expect(view.writes).toHaveLength(1));
      const owner = renderHook(
        () => useApprovalPolicyDraft(view.organizationId, view.projectId),
        { wrapper: view.Wrapper },
      );
      view.unmount();
      await act(async () => release());
      await waitFor(() => expect(owner.result.current.isPending).toBe(false));
      let panel = view.mount();
      for (let visit = 0; visit < 2; visit++) {
        await screen.findByTestId("approval-save-error");
        expect(count()).toHaveValue(3);
        expect(screen.getByTestId("approval-save")).toBeEnabled();
        if (failure === "validation") {
          expect(count()).toHaveAttribute("aria-invalid", "true");
          const description = count().getAttribute("aria-describedby");
          expect(description).toBeTruthy();
          expect(document.getElementById(description!)).toHaveTextContent(
            "Unsupported count",
          );
        } else {
          expect(count()).not.toHaveAttribute("aria-invalid", "true");
        }
        if (visit === 0) {
          panel.unmount();
          panel = view.mount();
        }
      }
      view.fail(null);
      await userEvent.click(screen.getByTestId("approval-save"));
      await waitFor(() => expect(view.writes).toHaveLength(2));
      expect(view.writes[1].body.expectedRevision).toBe(2);
      expect(view.writes[1].body.rules?.[0].requiredApprovals).toBe(3);
      await waitFor(() => expect(owner.result.current.dirty).toBe(false));
      expect(
        screen.queryByTestId("approval-save-error"),
      ).not.toBeInTheDocument();
      expect(count()).not.toHaveAttribute("aria-invalid", "true");
      panel.unmount();
      owner.unmount();
    },
  );

  it.each(["validation", "network"] as const)(
    "does not attach late %s feedback to newer drafts or another scope",
    async (failure) => {
      const view = setup();
      await ready();
      fireEvent.change(count(), { target: { value: "3" } });
      view.fail(failure);
      const release = view.holdWrites();
      await userEvent.click(screen.getByTestId("approval-save"));
      await waitFor(() => expect(view.writes).toHaveLength(1));
      view.unmount();
      const owner = renderHook(
        () => useApprovalPolicyDraft(view.organizationId, view.projectId),
        { wrapper: view.Wrapper },
      );
      const otherProject = crypto.randomUUID();
      view.client.setQueryData(
        projectApprovalPolicyKey(view.organizationId, otherProject),
        initial(otherProject),
      );
      const other = renderHook(
        () => useApprovalPolicyDraft(view.organizationId, otherProject),
        { wrapper: view.Wrapper },
      );
      await waitFor(() =>
        expect(other.result.current.policy.data).not.toBeNull(),
      );
      act(() => {
        owner.result.current.update([
          { ...projectRule("marketing"), requiredApprovals: 4 },
        ]);
        other.result.current.update([
          { ...projectRule("marketing"), requiredApprovals: 7 },
        ]);
      });
      const panel = view.mount();
      await act(async () => release());
      await waitFor(() => expect(count()).toBeEnabled());
      expect(count()).toHaveValue(4);
      expect(count()).not.toHaveAttribute("aria-invalid", "true");
      expect(
        screen.queryByTestId("approval-save-error"),
      ).not.toBeInTheDocument();
      expect(owner.result.current.failure).toBeNull();
      expect(other.result.current.failure).toBeNull();
      expect(other.result.current.issues).toEqual([]);
      expect(other.result.current.rules[0].requiredApprovals).toBe(7);
      view.fail(null);
      await userEvent.click(screen.getByTestId("approval-save"));
      await waitFor(() => expect(owner.result.current.dirty).toBe(false));
      expect(view.writes[1].body.rules?.[0].requiredApprovals).toBe(4);
      expect(other.result.current.dirty).toBe(true);
      panel.unmount();
      owner.unmount();
      other.unmount();
    },
  );

  it("shows the actual API fallback as no proposal, without suggesting human review", async () => {
    setup();
    await ready();
    const fallback = screen.getByTestId("approval-fallback");
    expect(fallback).toHaveTextContent("No proposal required");
    expect(fallback).not.toHaveTextContent("Human approvals");
    expect(fallback).not.toHaveTextContent(
      "Allow eligible user proposer approval",
    );
  });

  it.each([
    {
      requirement: "PROJECT_REQUIRED",
      requiredApprovals: 3,
      allowsProposerApproval: true,
      outcome: "Human approvals: 3",
    },
    {
      requirement: "PROJECT_REQUIRED",
      requiredApprovals: 2,
      allowsProposerApproval: false,
      outcome: "Human approvals: 2",
    },
  ] satisfies Array<
    Pick<
      ProjectApprovalPolicySnapshot["fallback"],
      "requirement" | "requiredApprovals" | "allowsProposerApproval"
    > & { outcome: string }
  >)(
    "shows proposal-required fallback $requirement from the API",
    async ({ outcome, ...fallback }) => {
      setup("OWNER", "", undefined, (projectId) => ({
        ...initial(projectId),
        fallback: {
          ...initial(projectId).fallback,
          ...fallback,
          requiresProposal: true,
        },
      }));
      await ready();
      const summary = screen.getByTestId("approval-fallback");
      expect(summary).toHaveTextContent("Proposal required");
      expect(summary).toHaveTextContent(outcome);
      expect(summary).toHaveTextContent(
        `Allow eligible user proposer approval: ${fallback.allowsProposerApproval ? "Yes" : "No"}`,
      );
      expect(summary).not.toHaveTextContent("No proposal required");
    },
  );

  it("preserves interleaved default priorities, previews drafts globally, and restores authoritative order", async () => {
    const view = setup("OWNER", "", undefined, defaultSnapshot);
    await ready();
    const priorities = () =>
      screen
        .getAllByTestId("approval-effective-rule")
        .map((row) => within(row).getByText(/Global priority/).textContent);
    expect(priorities()).toEqual([
      "Global priority 15",
      "Global priority 16",
      "Global priority 10",
      ...Array.from({ length: 9 }, (_, i) => `Global priority ${i + 1}`),
    ]);
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    expect(priorities()).toContain("Global priority 1");
    expect(priorities()).toContain("Global priority 3");
    await userEvent.click(
      screen.getByRole("link", { name: /Marketing today/ }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: /Marketing today/ }),
      ).toHaveAttribute("aria-current", "page"),
    );
    await userEvent.click(screen.getByTestId("approval-add-rule"));
    const priority = within(
      screen.getByTestId("approval-rule-priority"),
    ).getByRole("spinbutton");
    await waitFor(() =>
      expect(
        within(screen.getByTestId("approval-rule-priority")).getByRole(
          "spinbutton",
        ),
      ).toHaveValue(3),
    );
    fireEvent.change(priority, { target: { value: "2" } });
    expect(priority).toHaveValue(2);
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(
      view.writes[0].body.rules?.map((rule) => rule.conditions.typeKey),
    ).toEqual(["marketing", undefined]);
    await waitFor(() =>
      expect(screen.getByTestId("approval-save")).toBeDisabled(),
    );
    await userEvent.click(screen.getByTestId("approval-restore"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("approval-rule-editor"),
      ).not.toBeInTheDocument(),
    );
    expect(priorities()).toContain("Global priority 10");
    expect(priorities()).toContain("Global priority 1");
    expect(new Set(priorities()).size).toBe(priorities().length);
    await userEvent.click(
      screen.getByRole("link", { name: /Default · All types/ }),
    );
    await waitFor(() =>
      expect(priorities()).toEqual([
        "Global priority 15",
        "Global priority 16",
        "Global priority 10",
        ...Array.from({ length: 9 }, (_, i) => `Global priority ${i + 1}`),
      ]),
    );
  });

  it("excludes archived types from creation, keeps their saved rules on save and lets them be removed", async () => {
    setup("OWNER", "?approvalType=retired", undefined, (projectId) => ({
      ...initial(projectId),
      rules: [
        ...initial(projectId).rules,
        {
          ...projectRule("retired"),
          source: "PROJECT",
          editable: true,
          order: 5,
        },
      ],
    }));
    await screen.findByTestId("approval-historical-rule");
    expect(screen.queryByTestId("approval-add-rule")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("approval-rule-editor"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByTestId("approval-type-group")
        .map((link) => link.getAttribute("data-type-key")),
    ).toEqual(["", "marketing", "FEATURE"]);
    await userEvent.click(
      screen.getByRole("link", { name: /Marketing today/ }),
    );
    expect(await screen.findByTestId("approval-add-rule")).toBeEnabled();
  });

  it("saves an unrelated change retaining the unavailable rule, or without it once removed", async () => {
    const retired = (projectId: string) => {
      const base = initial(projectId).rules;
      const lastProject = base.findLastIndex(
        (rule) => rule.source === "PROJECT",
      );
      return {
        ...initial(projectId),
        rules: [
          ...base.slice(0, lastProject + 1),
          {
            ...projectRule("retired"),
            source: "PROJECT" as const,
            editable: true,
          },
          ...base.slice(lastProject + 1),
        ].map((rule, order) => ({ ...rule, order })),
      };
    };
    const view = setup("OWNER", "?approvalType=retired", undefined, retired);
    await screen.findByTestId("approval-historical-rule");
    await userEvent.click(
      screen.getByTestId("approval-remove-unavailable-rule"),
    );
    expect(
      screen.queryByTestId("approval-historical-rule"),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(
      view.writes[0].body.rules?.map((rule) => rule.conditions.typeKey),
    ).not.toContain("retired");
  });

  it("uses exact registry keys, moves across groups globally, saves the revision and refreshes review queries, then restores", async () => {
    const view = setup();
    await ready();
    expect(
      screen.getByRole("link", { name: /Marketing today/ }),
    ).toHaveAttribute("data-type-key", "marketing");
    fireEvent.change(
      within(screen.getByTestId("approval-rule-priority")).getByRole(
        "spinbutton",
      ),
      { target: { value: "4" } },
    );
    const release = view.holdWrites();
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(screen.getByTestId("approval-save")).toBeDisabled();
    expect(count()).toBeDisabled();
    await act(async () => release());
    expect(view.writes[0].body.expectedRevision).toBe(2);
    expect(
      view.writes[0].body.rules?.map((rule) => rule.conditions.typeKey),
    ).toEqual(["FEATURE", undefined, "marketing"]);
    await waitFor(() =>
      expect(screen.getByTestId("approval-save")).toBeDisabled(),
    );
    expect(
      view.client.getQueryState(
        proposalKeys.detail(view.organizationId, view.projectId, "pending"),
      )?.isInvalidated,
    ).toBe(true);
    await userEvent.click(screen.getByTestId("approval-restore"));
    await waitFor(() => expect(view.writes).toHaveLength(2));
    expect(view.writes[1]).toEqual({
      method: "post",
      body: { expectedRevision: 3 },
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("approval-rule-editor"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("approval-effective-rule")).toHaveLength(10);
  });

  it("preserves drafts through field errors, network failures and background reads; requires review before retrying conflicts", async () => {
    const view = setup();
    await ready();
    fireEvent.change(count(), { target: { value: "3" } });
    view.fail("validation");
    await userEvent.click(screen.getByTestId("approval-save"));
    await screen.findByTestId("approval-save-error");
    expect(count()).toHaveAttribute("aria-invalid", "true");
    expect(count()).toHaveValue(3);
    view.fail("network");
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(2));
    expect(count()).toHaveValue(3);
    view.externalSave();
    await act(async () => {
      await view.client.refetchQueries({
        queryKey: projectApprovalPolicyKey(view.organizationId, view.projectId),
      });
    });
    expect(count()).toHaveValue(3);
    view.fail("conflict");
    await userEvent.click(screen.getByTestId("approval-save"));
    await screen.findByTestId("approval-review-latest");
    expect(view.writes[2].body.expectedRevision).toBe(2);
    expect(screen.getByTestId("approval-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("approval-review-latest"));
    await screen.findByTestId("approval-latest-settings");
    expect(screen.getByTestId("approval-save")).toBeDisabled();
    await userEvent.click(screen.getByTestId("approval-accept-revision"));
    view.fail(null);
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(4));
    expect(view.writes[3].body.expectedRevision).toBe(9);
    expect(view.writes[3].body.rules?.[0].requiredApprovals).toBe(3);
  });

  it("edits supported conditions and immediate outcomes through the generated request", async () => {
    const view = setup();
    await ready();
    for (const [field, option] of [
      ["author", "User"],
      ["action", "Update"],
      ["change", "Status only"],
      ["outcome", "Apply immediately"],
    ]) {
      await userEvent.click(
        within(screen.getByTestId(`approval-rule-${field}`)).getByRole(
          "combobox",
        ),
      );
      await userEvent.click(screen.getByRole("option", { name: option }));
    }
    expect(count()).toBeDisabled();
    expect(count()).toHaveValue(0);
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(view.writes).toHaveLength(1));
    expect(view.writes[0].body.rules?.[0]).toEqual({
      conditions: {
        typeKey: "marketing",
        author: "USER",
        action: "UPDATE",
        change: "STATUS_ONLY",
      },
      requirement: "IMMEDIATE",
      requiredApprovals: 0,
      allowsProposerApproval: false,
    });
    await userEvent.click(screen.getByRole("link", { name: /Feature/ }));
    await waitFor(() => expect(count()).toHaveValue(1));
  });

  it("lets readers inspect protected and project rules without write controls", async () => {
    setup("VIEWER");
    await screen.findByTestId("approval-rule-editor");
    expect(screen.queryByTestId("approval-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("approval-add-rule")).not.toBeInTheDocument();
    expect(count()).toBeDisabled();
    expect(screen.getAllByTestId("approval-effective-rule")).toHaveLength(2);
  });

  it("adds Default rules without a type selector and keeps projects' drafts separate", async () => {
    const first = setup("OWNER", "");
    await ready();
    act(() => screen.getByTestId("approval-add-rule").focus());
    await userEvent.keyboard("{Enter}");
    first.unmount();
    const second = setup("OWNER", "");
    await ready();
    expect(screen.getByTestId("approval-save")).toBeDisabled();
    second.unmount();
    const restored = setup("OWNER", "", first);
    await ready();
    expect(screen.getAllByTestId("approval-rule-editor")).toHaveLength(2);
    await userEvent.click(screen.getByTestId("approval-save"));
    await waitFor(() => expect(restored.writes).toHaveLength(1));
    expect(restored.writes[0].body.rules?.at(-1)?.conditions).toEqual({});
  });
});
