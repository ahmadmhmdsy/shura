import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "@/state/composerStore";
import { recoverFromDisk } from "@/lib/markdown/parser";
import { memoryFileSink } from "@/lib/markdown/sink";
import { writeSessionMeta } from "@/lib/markdown/writer";
import { LIMITS } from "@/lib/limits";
import type { SessionMeta } from "@/types";

const meta: SessionMeta = {
  id: "limits-session", title: "حدود", createdAt: 1, updatedAt: 1,
  modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: true, onDiskDir: "limits-session",
};

beforeEach(() => {
  useComposerStore.setState({ drafts: {} });
});

describe("input limits", () => {
  it("keeps a shared prompt at the hard limit", () => {
    useComposerStore.getState().setShared("s", "a".repeat(LIMITS.sharedPromptMax));
    expect(useComposerStore.getState().getDraft("s").sharedPrompt).toHaveLength(LIMITS.sharedPromptMax);
  });

  it("truncates a shared prompt past the hard limit instead of storing it", () => {
    useComposerStore.getState().setShared("s", "a".repeat(LIMITS.sharedPromptMax + 500));
    expect(useComposerStore.getState().getDraft("s").sharedPrompt).toHaveLength(LIMITS.sharedPromptMax);
  });

  it("truncates a custom prompt past the hard limit", () => {
    useComposerStore.getState().addTarget("s", { providerId: "minimax", modelId: "MiniMax-M2", modelInfo: { id: "MiniMax-M2", label: "M2" } });
    const targetId = useComposerStore.getState().getDraft("s").targets[0].targetId;
    useComposerStore.getState().setCustom("s", targetId, "b".repeat(LIMITS.customPromptMax + 1));
    expect(useComposerStore.getState().getDraft("s").customs[targetId]).toHaveLength(LIMITS.customPromptMax);
  });

  it("quarantines an archive larger than the hard limit", async () => {
    const sink = memoryFileSink();
    await writeSessionMeta(sink, "sessions/big", meta);
    await sink.writeFile("sessions/big/meta.json", "{ broken");
    await sink.writeFile("sessions/big/result.md", "x".repeat(LIMITS.archiveMaxChars + 10));

    const report = await recoverFromDisk(sink, "sessions", { now: () => 1000 });

    expect(report.imported).toHaveLength(0);
    expect(report.quarantined).toHaveLength(1);
    expect(report.errors).toEqual([]);
  });

  it("still imports a normal-size archive", async () => {
    const sink = memoryFileSink();
    await writeSessionMeta(sink, "sessions/small", { ...meta, id: "limits-small", onDiskDir: "small" });

    const report = await recoverFromDisk(sink, "sessions", { now: () => 1000 });

    expect(report.imported.map((session) => session.meta.id)).toEqual(["limits-small"]);
    expect(report.quarantined).toHaveLength(0);
  });
});