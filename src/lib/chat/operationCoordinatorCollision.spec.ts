import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/id", () => ({ newId: vi.fn(() => "shared-op") }));

import { SessionOperationCoordinator } from "./operationCoordinator";

describe("SessionOperationCoordinator composite tombstones", () => {
  it("does not let cancellation or finish of one session close a colliding operation", () => {
    const coordinator = new SessionOperationCoordinator();
    const first = coordinator.start("session-a", "send", new AbortController());
    const second = coordinator.start("session-b", "retry", new AbortController());
    expect(first?.id).toBe("shared-op");
    expect(second?.id).toBe("shared-op");
    expect(coordinator.isOperationOpen("shared-op", "session-a")).toBe(true);
    expect(coordinator.isOperationOpen("shared-op", "session-b")).toBe(true);

    coordinator.cancel("session-b");
    expect(coordinator.isOperationOpen("shared-op", "session-a")).toBe(true);
    expect(coordinator.isOperationOpen("shared-op", "session-b")).toBe(false);

    coordinator.finish("shared-op", "session-a");
    expect(coordinator.isActive("session-a")).toBe(false);
    expect(coordinator.isActive("session-b")).toBe(false);
  });
});
