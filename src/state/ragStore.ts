import { create } from "zustand";
import { liveQuery, type Subscription } from "dexie";
import { getSetting, setSetting } from "@/lib/db/repos";
import { db } from "@/lib/db/db";
import { DEFAULT_RAG_SETTINGS, type RagSettings, type RagDocument, type RagFolder } from "@/types";
import { getDocuments } from "@/lib/rag/documentManager";
import { addExternalFolder, removeExternalFolder, getFolders } from "@/lib/rag/folderManager";

const RAG_SETTINGS_KEY = "settings.rag";

let docsSubscription: Subscription | null = null;
let foldersSubscription: Subscription | null = null;

interface RagState {
  settings: RagSettings;
  documents: RagDocument[];
  folders: RagFolder[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  indexingErrors: Record<string, string>;

  load(): Promise<void>;
  updateSettings(patch: Partial<RagSettings>): Promise<void>;
  setDocuments(docs: RagDocument[]): void;
  setFolders(folders: RagFolder[]): void;
  addFolder(path: string, label: string, autoReindex: boolean): Promise<RagFolder>;
  removeFolder(folderId: string): Promise<void>;
  refreshDocuments(): Promise<void>;
  setIndexingError(fileId: string, error: string): void;
  clearIndexingError(fileId: string): void;
}

export const useRagStore = create<RagState>((set, get) => ({
  settings: DEFAULT_RAG_SETTINGS,
  documents: [],
  folders: [],
  loaded: false,
  loading: false,
  error: null,
  indexingErrors: {},

  async load() {
    set({ loading: true, error: null });
    try {
      const saved = await getSetting<RagSettings>(RAG_SETTINGS_KEY);
      const settings = saved ?? DEFAULT_RAG_SETTINGS;
      const [docs, folders] = await Promise.all([getDocuments(), getFolders()]);
      set({ settings, documents: docs, folders, loaded: true, loading: false });
      docsSubscription?.unsubscribe();
      foldersSubscription?.unsubscribe();
      docsSubscription = liveQuery(() => db.rag_documents.toArray()).subscribe({
        next: (d) => set({ documents: d }),
        error: (e) => set({ error: String(e) }),
      });
      foldersSubscription = liveQuery(() => db.rag_folders.toArray()).subscribe({
        next: (f) => set({ folders: f }),
        error: (e) => set({ error: String(e) }),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error),
        loading: false,
      });
    }
  },

  async updateSettings(patch: Partial<RagSettings>) {
    const before = get().settings;
    set({ settings: { ...before, ...patch } });
    try {
      await setSetting(RAG_SETTINGS_KEY, get().settings);
    } catch (error) {
      set({ settings: before });
      throw error;
    }
  },

  setDocuments(docs: RagDocument[]) {
    set({ documents: docs });
  },

  setFolders(folders: RagFolder[]) {
    set({ folders });
  },

  async addFolder(path: string, label: string, autoReindex: boolean) {
    const folder = await addExternalFolder(path, label, autoReindex, get().settings);
    return folder;
  },

  async removeFolder(folderId: string) {
    await removeExternalFolder(folderId);
  },

  async refreshDocuments() {
    const docs = await getDocuments();
    set({ documents: docs });
  },

  setIndexingError(fileId: string, error: string) {
    set((state) => ({
      indexingErrors: { ...state.indexingErrors, [fileId]: error },
    }));
  },

  clearIndexingError(fileId: string) {
    set((state) => {
      const { [fileId]: _, ...rest } = state.indexingErrors;
      return { indexingErrors: rest };
    });
  },
}));
