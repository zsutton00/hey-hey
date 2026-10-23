import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageType,
  MessageStatus,
  type MessageRecordDto,
} from "../../../../api";
import type { ConversationMessage } from "../../../../types/conversation";
import {
  beginOptimisticInput,
  confirmOptimisticInput,
  failOptimisticInput,
  getOptimisticInputs,
  removeOptimisticInput,
  observeCanonicalInputs,
  inputScope,
} from "../../../../data/collections/optimisticConversationInputs";
import type { DirectTriggerInput } from "../../../AgentSession/operations/AgentOperationCoordinator";
import {
  useConversationScrolling,
  type ConversationScrollPolicy,
} from "../useConversationScrolling";

const message = (id: string): ConversationMessage => ({
  message: {
    id,
    conversationId: "conversation",
    projectId: "project",
    type: MessageType.System,
    status: MessageStatus.Completed,
    data: { type: "QUESTIONS" },
    createdAt: "2026-01-01T00:00:00Z",
    awaitingResponse: false,
    responses: [],
  },
  state: "completed",
  canEdit: false,
});
const input: DirectTriggerInput = {
  organizationId: "organization",
  projectId: "project",
  conversationId: "conversation",
  agentSessionId: "session",
  machineId: "machine",
  intent: { data: { message: "Hello" } },
};
const canonical = (operationId: string): MessageRecordDto => ({
  id: "confirmed",
  projectId: "project",
  conversationId: "conversation",
  type: MessageType.User,
  data: { message: "Hello" },
  createdAt: "2026-01-01T00:00:00Z",
  parentMessageId: null,
  executionOperationId: operationId,
});
function createOwner() {
  const owner = document.createElement("main");
  owner.scrollTo = vi.fn();
  Object.defineProperties(owner, {
    scrollHeight: { configurable: true, value: 1800 },
    clientHeight: { value: 600 },
  });
  document.body.append(owner);
  const ownerRef: RefObject<HTMLElement | null> = { current: owner };
  const policy: ConversationScrollPolicy = { mode: "owned", ownerRef };
  return { owner, policy, scrollTo: vi.mocked(owner.scrollTo) };
}
function append(owner: HTMLElement, id: string) {
  const target = document.createElement("article");
  target.dataset.messageId = id;
  owner.append(target);
  return target;
}
function mount(
  policy: ConversationScrollPolicy,
  timeline = [message("latest")]
) {
  return renderHook(
    ({ timeline, conversationId }) =>
      useConversationScrolling({
        scrollPolicy: policy,
        conversationTimeline: timeline,
        conversationId,
      }),
    { initialProps: { timeline, conversationId: "conversation" } }
  );
}
describe("conversation explicit scrolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    getOptimisticInputs().forEach((row) =>
      removeOptimisticInput(row.operationId)
    );
    vi.useRealTimers();
    document.body.replaceChildren();
  });
  it("waits for a conversation before revealing content", () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    const { result, rerender } = renderHook(
      ({ conversationId }: { conversationId: string | null }) =>
        useConversationScrolling({
          scrollPolicy: policy,
          conversationTimeline: [message("latest")],
          conversationId,
        }),
      { initialProps: { conversationId: null } }
    );
    act(() => vi.advanceTimersByTime(2300));
    expect(result.current.initialScrollReady).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();

    rerender({ conversationId: "conversation" });
    expect(result.current.initialScrollReady).toBe(false);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.initialScrollReady).toBe(true);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 1800,
      behavior: "instant",
    });
  });
  it("reveals latest content once, preserving native anchoring and ignoring subsequent growth or prepends", () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    const { result, rerender } = mount(policy);
    expect(result.current.initialScrollReady).toBe(false);
    act(() => vi.advanceTimersByTime(20));
    expect(result.current.initialScrollReady).toBe(true);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 1800,
      behavior: "instant",
    });
    expect(owner.style.overflowAnchor).toBe("");
    append(owner, "reply");
    rerender({
      timeline: [message("latest"), message("reply")],
      conversationId: "conversation",
    });
    rerender({
      timeline: [message("older"), message("latest"), message("reply")],
      conversationId: "conversation",
    });
    Object.defineProperty(owner, "scrollHeight", { value: 4000 });
    owner.dispatchEvent(new Event("scroll"));
    owner.dispatchEvent(new WheelEvent("wheel"));
    act(() => vi.runAllTimers());
    expect(scrollTo).toHaveBeenCalledOnce();
  });
  it("waits for initial target mounting, then reveals once", async () => {
    const { owner, policy, scrollTo } = createOwner();
    const { result } = mount(policy);
    act(() => vi.advanceTimersByTime(20));
    expect(scrollTo).not.toHaveBeenCalled();
    await act(async () => {
      append(owner, "latest");
    });
    expect(result.current.initialScrollReady).toBe(true);
    expect(scrollTo).toHaveBeenCalledOnce();
  });
  it("waits for the declared owner ref before performing initial reveal", () => {
    const { owner, scrollTo } = createOwner();
    append(owner, "latest");
    const ownerRef: RefObject<HTMLElement | null> = { current: null };
    const { result } = mount({ mode: "owned", ownerRef });
    act(() => vi.advanceTimersByTime(60));
    expect(scrollTo).not.toHaveBeenCalled();
    ownerRef.current = owner;
    act(() => vi.advanceTimersByTime(20));
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(result.current.initialScrollReady).toBe(true);
  });
  it("ignores pre-existing local inputs and cancels pending submission moves on unmount", async () => {
    beginOptimisticInput("existing", input);
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    const { unmount } = mount(policy);
    act(() => vi.advanceTimersByTime(20));
    scrollTo.mockClear();
    act(() => beginOptimisticInput("new-input", input));
    unmount();
    await act(async () => {
      for (const operationId of ["existing", "new-input"]) {
        const target = append(owner, operationId);
        target.dataset.operationId = operationId;
      }
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it("reveals a different conversation, but does not repeat reveal when messages are removed", () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    append(owner, "other");
    const { rerender } = mount(policy);
    act(() => vi.advanceTimersByTime(20));
    rerender({ timeline: [], conversationId: "conversation" });
    rerender({ timeline: [message("latest")], conversationId: "conversation" });
    act(() => vi.advanceTimersByTime(20));
    expect(scrollTo).toHaveBeenCalledOnce();
    rerender({
      timeline: [message("other")],
      conversationId: "other-conversation",
    });
    act(() => vi.advanceTimersByTime(20));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });
  it("releases loading when a target cannot mount and cancels pending observers on unmount", async () => {
    const { owner, policy, scrollTo } = createOwner();
    const { result, unmount } = mount(policy);
    act(() => vi.advanceTimersByTime(2300));
    expect(result.current.initialScrollReady).toBe(true);
    unmount();
    await act(async () => {
      append(owner, "latest");
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it("navigates only within its own owner; disabled scrolling never moves anything", () => {
    const one = createOwner(),
      two = createOwner();
    const target = append(one.owner, "latest");
    append(two.owner, "latest");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 450,
    } as DOMRect);
    const { result } = mount(one.policy);
    const disabled = mount({ mode: "disabled" });
    act(() => vi.advanceTimersByTime(20));
    one.scrollTo.mockClear();
    act(() => {
      result.current.handleStepClick(0, message("latest").message);
      disabled.result.current.handleStepClick(0, message("latest").message);
    });
    expect(one.scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 450,
      behavior: "smooth",
    });
    expect(two.scrollTo).not.toHaveBeenCalled();
  });
  it("loads older history and propagates failures without a custom position correction", async () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    const { result } = mount(policy);
    act(() => vi.advanceTimersByTime(20));
    scrollTo.mockClear();
    const load = vi.fn(async () => {
      append(owner, "older");
    });
    await act(async () => {
      await result.current.loadOlderMessages(load);
    });
    expect(load).toHaveBeenCalledOnce();
    const error = new Error("History unavailable");
    await expect(
      result.current.loadOlderMessages(async () => {
        throw error;
      })
    ).rejects.toBe(error);
    expect(scrollTo).not.toHaveBeenCalled();
  });
  it("moves once to a locally submitted preview, never again on confirmation or reply growth", async () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    mount(policy);
    act(() => vi.advanceTimersByTime(20));
    scrollTo.mockClear();
    act(() => beginOptimisticInput("operation", input));
    const preview = document.createElement("div");
    preview.dataset.previewKey = "operation";
    preview.dataset.deliveryState = "sending";
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      top: 420,
    } as DOMRect);
    await act(async () => owner.append(preview));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
      top: 420,
      behavior: "instant",
    });
    await act(async () => {
      confirmOptimisticInput("operation", canonical("operation"));
      preview.remove();
      const confirmed = append(owner, "confirmed");
      confirmed.dataset.operationId = "operation";
      append(owner, "reply");
    });
    expect(scrollTo).toHaveBeenCalledOnce();
  });
  it("moves to confirmation when it mounts before a preview, even if the local row is reconciled away", async () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    mount(policy);
    act(() => vi.advanceTimersByTime(20));
    scrollTo.mockClear();
    act(() => {
      beginOptimisticInput("fast", input);
      confirmOptimisticInput("fast", canonical("fast"));
      observeCanonicalInputs(
        inputScope("organization", "project", "conversation"),
        [canonical("fast")]
      );
    });
    await act(async () => {
      const target = append(owner, "confirmed");
      target.dataset.operationId = "fast";
    });
    expect(scrollTo).toHaveBeenCalledOnce();
  });
  it("does not move for remote arrivals, failed submissions, queued inputs or another conversation", async () => {
    const { owner, policy, scrollTo } = createOwner();
    append(owner, "latest");
    mount(policy);
    act(() => vi.advanceTimersByTime(20));
    scrollTo.mockClear();
    act(() => {
      beginOptimisticInput("failed", input);
      failOptimisticInput("failed", "Rejected");
      beginOptimisticInput("queued", input);
      confirmOptimisticInput("queued", {
        ...canonical("queued"),
        executionAdmissionDisposition: "QUEUED",
      });
      beginOptimisticInput("other", { ...input, conversationId: "other" });
    });
    await act(async () => {
      for (const id of ["failed", "queued", "other", "remote"]) {
        const target = append(owner, id);
        target.dataset.operationId = id;
      }
    });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
