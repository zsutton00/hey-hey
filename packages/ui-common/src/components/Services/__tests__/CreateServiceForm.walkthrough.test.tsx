import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServiceDto } from "../../../api";
import { CreateServiceForm } from "../CreateServiceForm";
import { GuidedWalkthroughProvider } from "../../GuidedWalkthrough/GuidedWalkthroughProvider";
import {
  createGuidedWalkthroughRuntime,
  type GuidedWalkthroughRuntime,
} from "../../GuidedWalkthrough/guidedWalkthroughRuntime";
import type { WalkthroughEvent } from "../../GuidedWalkthrough/types";

const createdService = { id: "service-1", name: "Billing API" } as ServiceDto;
const mutate = vi.fn(async () => createdService);

vi.mock("../../../data", () => ({
  useCreateService: () => ({ mutate }),
}));

function renderForm(runtime: GuidedWalkthroughRuntime | null) {
  const onSuccess = vi.fn();
  const form = (
    <CreateServiceForm
      organizationId="org-1"
      projectId="project-1"
      onSuccess={onSuccess}
    />
  );
  const { unmount } = render(
    runtime === null ? (
      form
    ) : (
      <GuidedWalkthroughProvider runtime={runtime}>
        {form}
      </GuidedWalkthroughProvider>
    ),
  );
  return { onSuccess, unmount };
}

function recordEvents(runtime: GuidedWalkthroughRuntime): WalkthroughEvent[] {
  const events: WalkthroughEvent[] = [];
  runtime.events.subscribe((event) => events.push(event));
  return events;
}

describe("CreateServiceForm walkthrough wiring", () => {
  beforeEach(() => {
    mutate.mockClear();
  });

  it("publishes its instance and registers the name/type and submit targets", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    renderForm(runtime);

    const session = runtime.createServiceForms.current();
    expect(session).toMatchObject({ detailsReady: false });
    const formInstanceId = session!.formInstanceId;
    const details = runtime.targets.lookup({
      name: "create-service-details",
      formInstanceId,
    });
    expect(details).toContainElement(screen.getByLabelText(/Name/));
    expect(details).toContainElement(screen.getByLabelText("Type"));
    expect(
      runtime.targets.lookup({ name: "create-service-submit", formInstanceId }),
    ).toBe(screen.getByTestId("create-service-submit"));
  });

  it("raises details-ready once a name is entered", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const events = recordEvents(runtime);
    renderForm(runtime);
    expect(events).toEqual([]);

    await userEvent.type(screen.getByLabelText(/Name/), "Billing API");

    const formInstanceId = runtime.createServiceForms.current()!.formInstanceId;
    expect(runtime.createServiceForms.current()?.detailsReady).toBe(true);
    expect(events).toEqual([
      { type: "create-service-details-ready", formInstanceId },
    ]);
  });

  it("raises service-created from the existing completion callback, creating once", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const events = recordEvents(runtime);
    const { onSuccess } = renderForm(runtime);
    const formInstanceId = runtime.createServiceForms.current()!.formInstanceId;

    await userEvent.type(screen.getByLabelText(/Name/), "Billing API");
    await userEvent.click(screen.getByTestId("create-service-submit"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(createdService));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(events).toContainEqual({ type: "service-created", formInstanceId });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("unpublishes its instance and targets when unmounted", () => {
    const runtime = createGuidedWalkthroughRuntime();
    const { unmount } = renderForm(runtime);
    const formInstanceId = runtime.createServiceForms.current()!.formInstanceId;
    unmount();
    expect(runtime.createServiceForms.current()).toBeNull();
    expect(
      runtime.targets.lookup({ name: "create-service-submit", formInstanceId }),
    ).toBeNull();
  });

  it("works without a walkthrough provider", async () => {
    const { onSuccess } = renderForm(null);
    await userEvent.type(screen.getByLabelText(/Name/), "Billing API");
    await userEvent.click(screen.getByTestId("create-service-submit"));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(createdService));
  });
});
