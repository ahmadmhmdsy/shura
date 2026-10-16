import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RagFolderManager } from "./RagFolderManager";
import { useRagStore } from "@/state/ragStore";
import { DEFAULT_RAG_SETTINGS, type RagDocument, type RagFolder } from "@/types";

const folder: RagFolder = {
  id: "f1",
  path: "/docs",
  label: "مستندات",
  autoReindex: true,
  lastIndexedAt: Date.parse("2026-09-29T10:00:00Z"),
  status: "active",
};

const doc: RagDocument = {
  id: "d1",
  source: "external",
  persistence: "persistent",
  fileName: "a.pdf",
  fileType: "pdf",
  fileSize: 10,
  status: "indexed",
  uploadedAt: 0,
  chunkCount: 2,
  embeddingModelId: "m",
  folderId: "f1",
};

describe("RagFolderManager", () => {
  beforeEach(() => {
    useRagStore.setState({
      settings: DEFAULT_RAG_SETTINGS,
      documents: [doc],
      folders: [folder],
      loaded: true,
      loading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("يعرض المجلد مع حالته وعدد ملفاته", () => {
    render(<RagFolderManager />);
    expect(screen.getByText("مستندات")).toBeTruthy();
    expect(screen.getByText("نشط")).toBeTruthy();
    expect(screen.getByText("ملف واحد")).toBeTruthy();
  });

  it("زر الإضافة يستدعي addFolder بالمسار", async () => {
    const addFolder = vi.fn(
      async (path: string, label: string, autoReindex: boolean) => {
        const newFolder: RagFolder = {
          id: "new-" + Date.now(),
          path,
          label,
          autoReindex,
          lastIndexedAt: null,
          status: "active",
        };
        useRagStore.setState((s) => ({ folders: [...s.folders, newFolder] }));
        return newFolder;
      },
    );
    useRagStore.setState({ addFolder });
    vi.stubGlobal("prompt", vi.fn(() => "/new-docs"));

    const user = userEvent.setup();
    render(<RagFolderManager />);
    await user.click(screen.getByText("إضافة مجلد"));

    await waitFor(() =>
      expect(addFolder).toHaveBeenCalledWith("/new-docs", "/new-docs", true),
    );
    expect(useRagStore.getState().folders.length).toBe(2);
  });
});
