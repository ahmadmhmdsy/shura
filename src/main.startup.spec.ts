import { describe, expect, it, vi } from "vitest";

vi.mock("react-dom/client", () => ({
  default: { createRoot: vi.fn(() => ({ render: vi.fn() })) },
}));
vi.mock("./App", () => ({ default: () => null }));
vi.mock("sonner", () => ({
  Toaster: () => null,
  toast: { success: vi.fn() },
}));
vi.mock("@/state/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      load: vi.fn(async () => undefined),
      sessionRootDir: null,
    }),
  },
}));
vi.mock("@/state/sessionsStore", () => ({
  useSessionsStore: {
    getState: () => ({
      load: vi.fn(async () => undefined),
      sessions: [],
    }),
  },
}));
vi.mock("@/lib/markdown/sink", () => ({
  getFileSink: vi.fn(),
  isFilePersistActive: () => false,
}));
vi.mock("@/lib/markdown/parser", () => ({ recoverFromDisk: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos", () => ({
  appendMessage: vi.fn(async () => undefined),
  createSession: vi.fn(async () => undefined),
  reconcileInterruptedTurns: vi.fn(async () => 0),
  recordUsage: vi.fn(async () => undefined),
}));
vi.mock("@/lib/transport/transport", () => ({ isTauri: () => false }));
vi.mock("@/lib/desktop/bootstrap", () => ({ bootstrapDesktop: vi.fn(async () => undefined) }));
vi.mock("@/lib/chat/operationCoordinator", () => ({
  sessionOperationCoordinator: { activeOperationKeys: () => [] },
}));

import { runStartup, type StartupPhases } from "./main";
import { liveOperationKey } from "@/lib/operationIdentity";

type StartupPhase = "bootstrap" | "settings" | "sessions" | "recover";
type FailingPhase = StartupPhase | "reconcile";

const startupPhases: readonly StartupPhase[] = ["bootstrap", "settings", "sessions", "recover"];

function createDeps(failingPhase: FailingPhase, events: string[]): StartupPhases {
  const phase = (name: StartupPhase): (() => Promise<void>) => vi.fn(async () => {
    events.push(name);
    if (name === failingPhase) throw new Error(`${name} failed`);
  });

  return {
    bootstrap: phase("bootstrap"),
    loadSettings: phase("settings"),
    loadSessions: phase("sessions"),
    recover: phase("recover"),
    activeOperationKeys: vi.fn(() => [liveOperationKey("session-live", "op-live"), liveOperationKey("session-live", "op-live-2")]),
    reconcile: vi.fn(async (liveOperationIds: ReadonlySet<string>) => {
      events.push("reconcile");
      expect([...liveOperationIds]).toEqual([liveOperationKey("session-live", "op-live"), liveOperationKey("session-live", "op-live-2")]);
      if (failingPhase === "reconcile") throw new Error("reconcile failed");
    }),
    render: vi.fn(() => {
      events.push("render");
    }),
  };
}

describe("startup seam", () => {
  it.each(startupPhases)("keeps a %s failure non-fatal and still reconciles before render", async (failingPhase) => {
    const events: string[] = [];
    const dependencies = createDeps(failingPhase, events);

    await expect(runStartup(dependencies)).resolves.toBeUndefined();

    expect(events).toEqual(["bootstrap", "settings", "sessions", "recover", "reconcile", "render"]);
    expect(dependencies.reconcile).toHaveBeenCalledWith(new Set([liveOperationKey("session-live", "op-live"), liveOperationKey("session-live", "op-live-2")]));
    expect(dependencies.render).toHaveBeenCalledOnce();
  });

  it("waits for reconciliation to settle before the first render", async () => {
    const events: string[] = [];
    let releaseReconciliation!: () => void;
    let signalReconciliationStarted!: () => void;
    const reconciliationGate = new Promise<void>((resolve) => {
      releaseReconciliation = resolve;
    });
    const reconciliationStarted = new Promise<void>((resolve) => {
      signalReconciliationStarted = resolve;
    });
    const render = vi.fn(() => {
      events.push("render");
    });
    const dependencies: StartupPhases = {
      bootstrap: async () => undefined,
      loadSettings: async () => undefined,
      loadSessions: async () => undefined,
      recover: async () => undefined,
      activeOperationKeys: () => [],
      reconcile: async () => {
        events.push("reconcile");
        signalReconciliationStarted();
        await reconciliationGate;
        events.push("reconciled");
      },
      render,
    };

    const startup = runStartup(dependencies);
    await reconciliationStarted;

    expect(events).toEqual(["reconcile"]);
    expect(dependencies.render).not.toHaveBeenCalled();

    releaseReconciliation();
    await startup;

    expect(events).toEqual(["reconcile", "reconciled", "render"]);
    expect(dependencies.render).toHaveBeenCalledOnce();
  });

  it("يؤجّل المطابقة ويعرض تحذيرًا محدودًا إذا فشل جمع مفاتيح العمليات", async () => {
    const events: string[] = [];
    const dependencies = createDeps("recover", events);
    dependencies.activeOperationKeys = vi.fn(() => { throw new Error("key enumeration failed"); });
    const warnings: string[] = [];
    dependencies.warn = (message: string) => { warnings.push(message); };
    dependencies.reconcile = vi.fn(async () => { events.push("reconcile"); });

    await expect(runStartup(dependencies)).resolves.toBeUndefined();
    // Fail safe: an unknown live-operation set must never be reconciled as "no live
    // work", because that would stop turns that are still running.
    expect(dependencies.reconcile).not.toHaveBeenCalled();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("العمليات الجارية");
    expect(events).toEqual(["bootstrap", "settings", "sessions", "recover", "render"]);
    expect(dependencies.render).toHaveBeenCalledOnce();
  });

  it("keeps reconciliation failure non-fatal and still renders", async () => {
    const events: string[] = [];
    const dependencies = createDeps("reconcile", events);

    await expect(runStartup(dependencies)).resolves.toBeUndefined();

    expect(events).toEqual(["bootstrap", "settings", "sessions", "recover", "reconcile", "render"]);
    expect(dependencies.render).toHaveBeenCalledOnce();
  });
});
