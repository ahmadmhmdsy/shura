import { describe, expect, it } from "vitest";
import { buildRetryInput, SessionOperationCoordinator } from "./operationCoordinator";
import type { ChatMessage, TurnAttempt } from "@/types";

const target = {
  targetId: "t1",
  providerId: "openrouter" as const,
  modelId: "model-1",
  modelInfo: { id: "model-1", label: "Model 1", pricing: { inputPerMTok: 1, outputPerMTok: 2 } },
  sharedPrompt: "سؤال محفوظ",
  customPrompt: "تعليمات محفوظة",
  promptText: "سؤال محفوظ\n\n[تعليمات خاصة بهذا النموذج]\nتعليمات محفوظة",
  hasShared: true,
  hasCustom: true,
};

const attempt: TurnAttempt = {
  id: "at-1",
  turnId: "turn-1",
  attempt: 1,
  kind: "send",
  createdAt: 1,
  status: "done",
  targets: [target],
};

describe("SessionOperationCoordinator", () => {
  it("rejects a second operation synchronously for the same session", () => {
    const coordinator = new SessionOperationCoordinator();
    const first = coordinator.start("s1", "send", new AbortController());
    expect(first).not.toBeNull();
    expect(coordinator.start("s1", "retry", new AbortController())).toBeNull();
    expect(coordinator.activeFor("s1")?.id).toBe(first?.id);
  });

  it("finish removes only the matching operation and accepts checks session identity", () => {
    const coordinator = new SessionOperationCoordinator();
    const first = coordinator.start("s1", "send", new AbortController());
    const other = coordinator.start("s2", "retry", new AbortController());
    expect(first).not.toBeNull();
    expect(other).not.toBeNull();
    expect(coordinator.accepts(first!.id, "s1")).toBe(true);
    expect(coordinator.accepts(first!.id, "s2")).toBe(false);
    coordinator.finish("not-the-operation");
    expect(coordinator.isActive("s1")).toBe(true);
    coordinator.finish(first!.id);
    expect(coordinator.isActive("s1")).toBe(false);
    expect(coordinator.isActive("s2")).toBe(true);
  });

  it("cancel aborts and releases the session slot", () => {
    const coordinator = new SessionOperationCoordinator();
    const controller = new AbortController();
    const handle = coordinator.start("s1", "summary", controller);
    expect(handle).not.toBeNull();
    coordinator.cancel("s1");
    expect(controller.signal.aborted).toBe(true);
    expect(coordinator.activeFor("s1")).toBeNull();
    coordinator.finish(handle!.id);
    expect(coordinator.activeFor("s1")).toBeNull();
  });

  it("notifies subscribers on start, cancel, and matching finish", () => {
    const coordinator = new SessionOperationCoordinator();
    const states: boolean[] = [];
    const unsubscribe = coordinator.subscribe(() => states.push(coordinator.isActive("s1")));
    const first = coordinator.start("s1", "send", new AbortController());
    expect(states).toEqual([true]);
    coordinator.finish(first!.id);
    expect(states).toEqual([true, false]);

    coordinator.start("s1", "retry", new AbortController());
    expect(states).toEqual([true, false, true]);
    coordinator.cancel("s1");
    expect(states).toEqual([true, false, true, false]);

    unsubscribe();
    coordinator.start("s1", "summary", new AbortController());
    expect(states).toHaveLength(4);
  });

  it("publishes exact operation progress and exposes terminal rows after release", () => {
    const coordinator = new SessionOperationCoordinator();
    const handle = coordinator.start("s-progress", "summary", new AbortController());
    const message: ChatMessage = {
      id: "m-progress",
      sessionId: "s-progress",
      turnId: "turn-progress",
      createdAt: 1,
      role: "assistant",
      kind: "synthesis",
      text: "",
      status: "streaming",
      operationId: handle!.id,
      attemptId: "at-progress",
      attempt: 1,
      targetId: "target-progress",
    };
    const versions: number[] = [];
    const unsubscribe = coordinator.subscribe(() => versions.push(coordinator.getVersion()));
    expect(coordinator.publishProgress({
      sessionId: message.sessionId,
      operationId: handle!.id,
      attemptId: message.attemptId!,
      turnId: message.turnId,
      messageId: message.id,
      targetId: message.targetId!,
      text: "جزئي",
      status: "streaming",
      message,
    })).toBe(true);
    expect(coordinator.progressFor("s-progress")[0]).toMatchObject({ messageId: message.id, text: "جزئي" });
    coordinator.cancel("s-progress");
    expect(coordinator.progressFor("s-progress")[0]).toMatchObject({ messageId: message.id, status: "stopped" });
    expect(versions.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
  });

  it("يعزل progress عن مراجع 메시 caller ويزامن حالة stopped داخل الرسالة", () => {
    const coordinator = new SessionOperationCoordinator();
    const handle = coordinator.start("s-clone", "send", new AbortController())!;
    const message: ChatMessage = {
      id: "m-clone", sessionId: "s-clone", turnId: "t-clone", createdAt: 1, role: "assistant", kind: "result",
      text: "original", status: "streaming", operationId: handle.id, attemptId: "at-clone", attempt: 1, targetId: "target-clone",
    };
    const entry = {
      sessionId: message.sessionId, operationId: handle.id, attemptId: message.attemptId!, turnId: message.turnId,
      messageId: message.id, targetId: message.targetId!, text: message.text, status: "streaming" as const, message,
    };
    expect(coordinator.publishProgress(entry)).toBe(true);
    message.text = "caller mutation";
    const returned = coordinator.progressFor("s-clone")[0]!;
    returned.message.text = "returned mutation";
    expect(coordinator.progressFor("s-clone")[0]?.message.text).toBe("original");
    coordinator.cancel("s-clone");
    expect(coordinator.progressFor("s-clone")[0]?.message.status).toBe("stopped");
  });

  it("closes finished operations and marks unfinished progress terminal", () => {
    const coordinator = new SessionOperationCoordinator();
    const handle = coordinator.start("s-finish-progress", "send", new AbortController());
    const message: ChatMessage = {
      id: "m-finish-progress", sessionId: "s-finish-progress", turnId: "t-finish-progress", createdAt: 1,
      role: "assistant", kind: "result", text: "", status: "streaming", operationId: handle!.id,
      attemptId: "at-finish-progress", attempt: 1, targetId: "target-finish-progress",
    };
    expect(coordinator.publishProgress({
      sessionId: message.sessionId, operationId: handle!.id, attemptId: message.attemptId!,
      turnId: message.turnId, messageId: message.id, targetId: message.targetId!, text: "جزئي", status: "streaming", message,
    })).toBe(true);
    coordinator.finish(handle!.id);
    expect(coordinator.isOperationOpen(handle!.id, "s-finish-progress")).toBe(false);
    expect(coordinator.progressFor("s-finish-progress")[0]).toMatchObject({ status: "stopped" });
    expect(coordinator.publishProgress({
      sessionId: message.sessionId, operationId: handle!.id, attemptId: message.attemptId!,
      turnId: message.turnId, messageId: message.id, targetId: message.targetId!, text: "متأخر", status: "streaming", message,
    })).toBe(false);
  });

  it("rejects progress envelopes whose target or message identity disagrees", () => {
    const coordinator = new SessionOperationCoordinator();
    const handle = coordinator.start("s-envelope", "send", new AbortController());
    const message: ChatMessage = {
      id: "m-envelope", sessionId: "s-envelope", turnId: "t-envelope", createdAt: 1,
      role: "assistant", kind: "result", text: "", status: "streaming", operationId: handle!.id,
      attemptId: "at-envelope", attempt: 1, targetId: "target-real",
    };
    expect(coordinator.publishProgress({
      sessionId: message.sessionId, operationId: handle!.id, attemptId: message.attemptId!,
      turnId: message.turnId, messageId: message.id, targetId: "target-forged", text: "x", status: "streaming", message,
    })).toBe(false);
  });

  it("retains a latest-operation tombstone after cancellation and replacement completion", () => {
    const coordinator = new SessionOperationCoordinator();
    const first = coordinator.start("s1", "summary", new AbortController());
    expect(first).not.toBeNull();
    coordinator.cancel("s1");
    const replacement = coordinator.start("s1", "send", new AbortController());
    expect(replacement).not.toBeNull();
    coordinator.finish(replacement!.id);
    expect(coordinator.isActive("s1")).toBe(false);
    expect(coordinator.isLatestOperation(first!.id, "s1")).toBe(false);
    expect(coordinator.isLatestOperation(replacement!.id, "s1")).toBe(true);
  });

  it("waitForIdle remains pending after immediate cancel until the finalizer finishes", async () => {
    const coordinator = new SessionOperationCoordinator();
    const handle = coordinator.start("s-idle", "send", new AbortController())!;
    let idle = false;
    const drained = coordinator.waitForIdle("s-idle").then(() => { idle = true; });
    expect(coordinator.pendingOperationIds("s-idle")).toEqual([handle.id]);

    coordinator.cancel("s-idle");
    await Promise.resolve();
    expect(idle).toBe(false);

    coordinator.finish(handle.id, "s-idle");
    await drained;
    expect(idle).toBe(true);
  });
});

describe("closed tombstone retention", () => {
  it("keeps retained closed keys bounded across many finished operations", () => {
    const coordinator = new SessionOperationCoordinator();
    for (let i = 0; i < 260; i += 1) {
      const handle = coordinator.start("s" + i, "send", new AbortController())!;
      coordinator.finish(handle.id, "s" + i);
    }
    // Without eviction every operation would retain a key forever.
    expect(coordinator.closedTombstoneCount()).toBeLessThanOrEqual(200);
    expect(coordinator.closedTombstoneCount()).toBeGreaterThan(0);
  });
});

describe("buildRetryInput", () => {
  it("returns independent target snapshots rather than mutable attempt state", () => {
    const input = buildRetryInput(attempt);
    expect(input.targets[0]?.customPrompt).toBe("تعليمات محفوظة");
    input.targets[0].customPrompt = "changed";
    input.targets[0].modelInfo.label = "changed";
    expect(attempt.targets[0].customPrompt).toBe("تعليمات محفوظة");
    expect(attempt.targets[0].modelInfo.label).toBe("Model 1");
  });
});
