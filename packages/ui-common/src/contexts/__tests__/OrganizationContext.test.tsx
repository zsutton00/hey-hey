import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { OrganizationProvider, useOrganization } from "../OrganizationContext";

const mocks = vi.hoisted(() => ({
  auth: {
    isAuthenticated: true,
    user: { id: "user", currentOrganizationId: null as string | null },
    organizationSelection: null as object | null,
    switchingOrganization: false,
    switchOrganization: vi.fn(),
  },
  getMyOrganizations: vi.fn(),
  createOrganization: vi.fn(),
}));
vi.mock("../AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("../../clients", () => ({ apiClient: mocks }));
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <OrganizationProvider>{children}</OrganizationProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.user = { id: "user", currentOrganizationId: null };
  mocks.auth.organizationSelection = null;
  mocks.auth.switchingOrganization = false;
  mocks.auth.switchOrganization.mockResolvedValue(undefined);
});

it("clears local selection and does not query scoped organizations while selection is required", () => {
  localStorage.setItem("currentOrganizationId", "stale");
  mocks.auth.organizationSelection = { status: "selection_required" };
  const { result } = renderHook(useOrganization, { wrapper });
  expect(result.current.currentOrganization).toBeNull();
  expect(localStorage.getItem("currentOrganizationId")).toBeNull();
  expect(mocks.getMyOrganizations).not.toHaveBeenCalled();
});

it("ignores a list response that arrives after confirmed selection is lost", async () => {
  mocks.auth.user.currentOrganizationId = "org-a";
  let resolve!: (value: unknown) => void;
  mocks.getMyOrganizations.mockReturnValue(
    new Promise((finish) => {
      resolve = finish;
    })
  );
  const { result, rerender } = renderHook(useOrganization, { wrapper });
  mocks.auth.user.currentOrganizationId = null;
  mocks.auth.organizationSelection = { status: "selection_denied" };
  rerender();
  await act(async () => {
    resolve({ data: { data: [{ id: "org-a", name: "Acme" }] } });
  });
  expect(result.current.currentOrganization).toBeNull();
  expect(result.current.organizations).toEqual([]);
});

it("does not adopt a created organization until server confirmation", async () => {
  const existing = { id: "org-a", name: "Acme" };
  const created = { id: "org-b", name: "New organization" };
  mocks.auth.user.currentOrganizationId = existing.id;
  mocks.getMyOrganizations.mockResolvedValue({ data: { data: [existing] } });
  mocks.createOrganization.mockResolvedValue({ data: { data: created } });
  mocks.auth.switchOrganization.mockRejectedValue(new Error("denied"));
  const { result } = renderHook(useOrganization, { wrapper });
  await waitFor(() =>
    expect(result.current.currentOrganization?.id).toBe(existing.id)
  );
  await act(async () => {
    await expect(
      result.current.createOrganization({ name: created.name })
    ).rejects.toThrow();
  });
  expect(mocks.auth.switchOrganization).toHaveBeenCalledWith(created.id);
  expect(result.current.currentOrganization?.id).toBe(existing.id);
});
