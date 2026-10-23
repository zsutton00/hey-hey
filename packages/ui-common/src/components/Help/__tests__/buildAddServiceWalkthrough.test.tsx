import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAddServiceWalkthrough } from "../buildAddServiceWalkthrough";
import {
  GuidedWalkthroughProvider,
  useGuidedWalkthroughControls,
} from "../../GuidedWalkthrough";
import { GuidedWalkthroughRunner } from "../../GuidedWalkthrough/GuidedWalkthroughRunner";
import {
  createGuidedWalkthroughRuntime,
  type GuidedWalkthroughRuntime,
} from "../../GuidedWalkthrough/guidedWalkthroughRuntime";
import {
  createCreateServiceFormInstanceId,
  type CreateServiceFormInstanceId,
} from "../../GuidedWalkthrough/types";

function mountForm(runtime: GuidedWalkthroughRuntime): {
  formInstanceId: CreateServiceFormInstanceId;
  details: HTMLElement;
  submit: HTMLElement;
} {
  const formInstanceId = createCreateServiceFormInstanceId();
  const mount = (name: "create-service-details" | "create-service-submit") => {
    const element = document.createElement("div");
    element.scrollIntoView = vi.fn();
    element.getBoundingClientRect = () => new DOMRect(20, 20, 100, 30);
    document.body.appendChild(element);
    runtime.targets.register({ name, formInstanceId }, () => element);
    return element;
  };
  runtime.createServiceForms.publish(Symbol("form"), {
    formInstanceId,
    detailsReady: false,
  });
  return {
    formInstanceId,
    details: mount("create-service-details"),
    submit: mount("create-service-submit"),
  };
}

describe("buildAddServiceWalkthrough", () => {
  it("is a titled two-step walkthrough over registered Create Service actions", () => {
    const walkthrough = buildAddServiceWalkthrough();
    expect(walkthrough.title).toBe("Add a service");
    expect(walkthrough.steps.map((step) => step.actionKey)).toEqual([
      "describe-service",
      "create-service",
    ]);
    expect(Object.isFrozen(walkthrough)).toBe(true);
  });

  describe("on the runner", () => {
    let runtime: GuidedWalkthroughRuntime;
    let runner: GuidedWalkthroughRunner;

    beforeEach(() => {
      vi.useFakeTimers();
      runtime = createGuidedWalkthroughRuntime();
      runner = new GuidedWalkthroughRunner(runtime);
    });

    afterEach(() => {
      runner.dispose();
      vi.useRealTimers();
      document.body.innerHTML = "";
    });

    it("describes name and type, then optional machine-local directory linking, with no Next step", () => {
      const form = mountForm(runtime);
      runner.start(buildAddServiceWalkthrough());

      const first = runner.getView();
      expect(first).toMatchObject({
        status: "active",
        stepNumber: 1,
        stepCount: 2,
        target: form.details,
      });
      expect(first.status === "active" && first.copy).toMatch(
        /name .* what kind of code base/i,
      );

      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: form.formInstanceId,
      });
      const second = runner.getView();
      expect(second).toMatchObject({
        status: "active",
        stepNumber: 2,
        target: form.submit,
      });
      expect(second.status === "active" && second.copy).toMatch(
        /optional and local to one CLI machine/,
      );
    });

    it("advances only on each step's own event and ends when the Service is created", () => {
      const form = mountForm(runtime);
      runner.start(buildAddServiceWalkthrough());

      runtime.events.emit({
        type: "service-created",
        formInstanceId: form.formInstanceId,
      });
      expect(runner.getView()).toMatchObject({ stepNumber: 1 });

      runtime.events.emit({
        type: "create-service-details-ready",
        formInstanceId: form.formInstanceId,
      });
      expect(runner.getView()).toMatchObject({ stepNumber: 2 });

      runtime.events.emit({
        type: "service-created",
        formInstanceId: form.formInstanceId,
      });
      expect(runner.getView().status).toBe("idle");
    });

    it("Exit ends the walkthrough", () => {
      mountForm(runtime);
      runner.start(buildAddServiceWalkthrough());
      runner.exit();
      expect(runner.getView().status).toBe("idle");
    });
  });

  it("Escape ends the walkthrough through the provider", () => {
    const runtime = createGuidedWalkthroughRuntime();
    const form = mountForm(runtime);
    const Starter: React.FC = () => {
      const controls = useGuidedWalkthroughControls();
      return (
        <button
          onClick={() =>
            controls?.startWalkthrough(buildAddServiceWalkthrough())
          }
        >
          Start
        </button>
      );
    };
    render(
      <GuidedWalkthroughProvider runtime={runtime}>
        <Starter />
      </GuidedWalkthroughProvider>,
    );

    fireEvent.click(screen.getByText("Start"));
    expect(screen.getByText(/Give your Service a name/)).toBeTruthy();

    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(screen.queryByText(/Give your Service a name/)).toBeNull();
    expect(form.formInstanceId).toBeTruthy();
  });
});
