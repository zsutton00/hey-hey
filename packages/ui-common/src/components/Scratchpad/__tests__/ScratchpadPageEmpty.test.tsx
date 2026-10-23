import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ScratchpadPage } from "../ScratchpadPage";

vi.mock("../useScratchpad", () => ({
  useScratchpad: vi.fn(() => ({
    items: [],
    addFromDrag: vi.fn(),
    removeItem: vi.fn(),
    reorderItems: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: vi.fn(() => ({
    currentOrgId: "org-1",
    name: "Test User",
    email: "test@example.com",
  })),
}));

describe("ScratchpadPage — empty state", () => {
  it("shows empty state when no items", () => {
    render(
      <MemoryRouter>
        <ScratchpadPage />
      </MemoryRouter>
    );

    expect(screen.getByText("Scratchpad is empty")).toBeInTheDocument();
    expect(screen.getByText(/Drag and drop entities/)).toBeInTheDocument();
  });
});
