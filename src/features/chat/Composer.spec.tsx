import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Composer } from "./Composer";
import { useComposerStore } from "@/state/composerStore";
import { useSettingsStore } from "@/state/settingsStore";
import { DEFAULT_RAG_SETTINGS } from "@/types";

function renderComposer() {
  return render(<Composer sessionId="s1" onSend={() => {}} onStop={() => {}} onExtractSummary={() => {}} sending={false} sessionTokens={0} contextLimit={null} contextMode="stateful" onContextModeChange={() => {}} />);
}

describe("Composer agent mode switch", () => {
  beforeEach(() => {
    useComposerStore.setState({ drafts: {} });
  });

  it("يظهر مفتاح وضع الوكيل عندما يكون الإعداد toggle", () => {
    useSettingsStore.setState({ ragSettings: { ...DEFAULT_RAG_SETTINGS, agentMode: "toggle" } });
    renderComposer();
    expect(screen.getByLabelText("وضع الوكيل")).toBeTruthy();
  });

  it("يخفي مفتاح وضع الوكيل عندما يكون الإعداد always", () => {
    useSettingsStore.setState({ ragSettings: { ...DEFAULT_RAG_SETTINGS, agentMode: "always" } });
    renderComposer();
    expect(screen.queryByLabelText("وضع الوكيل")).toBeNull();
  });
});
