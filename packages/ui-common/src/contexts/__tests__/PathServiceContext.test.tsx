import React from "react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { PathServiceProvider, usePathService } from "../PathServiceContext";
import {
  getPathService,
  resetPathService,
  type PathService,
} from "../../services";

describe("PathServiceContext", () => {
  beforeEach(() => {
    resetPathService();
  });

  it("falls back to the global service when no provider is present", () => {
    const { result } = renderHook(() => usePathService());
    expect(result.current).toBe(getPathService());
  });

  it("returns the provider path service override", () => {
    const baseService = getPathService();
    const customPathService: PathService = {
      ...baseService,
      service: ({ serviceId }) => `/custom/services/${serviceId}`,
    };

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PathServiceProvider pathService={customPathService}>
        {children}
      </PathServiceProvider>
    );

    const { result } = renderHook(() => usePathService(), { wrapper });
    expect(
      result.current.service({ projectId: "project-1", serviceId: "service-1" })
    ).toBe("/custom/services/service-1");
  });

  it("keeps navigable conversation hrefs separate from sessionless rendering", () => {
    const { result } = renderHook(() => usePathService());
    const params = { projectId: "project-1", conversationId: "conversation-1" };
    expect(result.current.conversation(params)).toBe("/projects/project-1/resolve-agent-session/conversation-1");
    expect(result.current.sessionlessConversation(params)).toBe("/projects/project-1/sessionless-conversations/conversation-1");
  });
});
