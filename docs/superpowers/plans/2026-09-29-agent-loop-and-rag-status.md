# Agent Loop (A/C Modes) + RAG Status Indicator + Folder Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the "Let me search" tool-loop bug, add an always-on/per-turn agent mode setting, show a live RAG indexing-status indicator in the chat, and wire the folder manager to the real indexing pipeline.

**Architecture:** The AI SDK v7 `streamText` defaults to `stopWhen = isStepCount(1)`, so the model's tool call never receives results. We set `stopWhen: isStepCount(5)` when multi-step is enabled. A new `agentMode` setting ("always" | "toggle", default "always") controls whether every turn is multi-step or the user opts in per-turn via a composer switch. A `RagStatusChip` in the chat header reads live RAG state from a Dexie `liveQuery` subscription in `ragStore`. The folder manager calls the real `addExternalFolder`/`removeExternalFolder` pipeline.

**Tech Stack:** React 19, TypeScript, Zustand, Dexie (IndexedDB), AI SDK v7 (`ai@7.0.92`), Vitest, Testing Library, Tauri.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/types/index.ts` | Add `agentMode` to `RagSettings` + default |
| `src/i18n/ar.ts` | New Arabic strings for setting, switch, chip, folders |
| `src/state/composerStore.ts` | Add `agentMode` to `ComposerDraft` + `setAgentMode` |
| `src/lib/chat/dispatch.ts` | `stopWhen` from `multiStepTools`; tool execution hooks |
| `src/lib/chat/chatController.ts` | Forward `multiStepTools` + tool callbacks to dispatch |
| `src/features/chat/Composer.tsx` | Agent-mode switch (visible only in "toggle" setting) |
| `src/state/ragStore.ts` | Dexie `liveQuery` subscriptions; real folder add/remove |
| `src/features/rag/RagFolderManager.tsx` | Real pipeline add/remove; status + file count per folder |
| `src/features/rag/RagStatusChip.tsx` | **New** — chat header status chip |
| `src/features/chat/TurnView.tsx` | Transient "Searching…" note during tool execution |
| `src/features/chat/ChatScreen.tsx` | Wire chip, toolActivity, multiStepTools, onOpenSettings |
| `src/App.tsx` | Pass `onOpenSettings` to ChatScreen |
| `src/features/rag/RagSettings.tsx` | Agent-mode select in settings |

---

### Task 1: Add `agentMode` to RagSettings type + default

**Files:**
- Modify: `src/types/index.ts` (RagSettings interface + DEFAULT_RAG_SETTINGS)
- Test: `src/state/settingsStore.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/state/settingsStore.spec.ts` inside the `describe("settingsStore")` block:

```ts
it("defaults agentMode to always", () => {
  expect(useSettingsStore.getState().ragSettings.agentMode).toBe("always");
});

it("persists agentMode through setRagSettings", async () => {
  await useSettingsStore.getState().setRagSettings({ agentMode: "toggle" });
  expect(useSettingsStore.getState().ragSettings.agentMode).toBe("toggle");
  const snapshot = vi.mocked(setSetting).mock.calls.at(-1)?.[1] as Record<string, unknown> | undefined;
  expect((snapshot!.rag as Record<string, unknown>).agentMode).toBe("toggle");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/state/settingsStore.spec.ts`
Expected: FAIL — `agentMode` is undefined on RagSettings.

- [ ] **Step 3: Write minimal implementation**

In `src/types/index.ts`, add to the `RagSettings` interface after `autoReindexFolders`:

```ts
  agentMode: "always" | "toggle";
```

In `DEFAULT_RAG_SETTINGS`, add after `autoReindexFolders: true`:

```ts
  agentMode: "always",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/state/settingsStore.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/state/settingsStore.spec.ts
git commit -m "feat: add agentMode setting to RagSettings"
```

---

### Task 2: Add i18n strings

**Files:**
- Modify: `src/i18n/ar.ts`

- [ ] **Step 1: Add strings**

In `src/i18n/ar.ts`, add after the last RAG string (`ragSearchExternal`):

```ts
  ragAgentMode: "وضع البحث العميق",
  ragAgentModeDesc: "كيف يستخدم النموذج أدوات البحث في مستنداتك",
  ragAgentAlways: "دائمًا (كل سؤال يمكنه البحث)",
  ragAgentToggle: "تبديل لكل سؤال (تختار عند الإرسال)",
  agentMode: "وضع الوكيل",
  agentModeHint: "السماح للنموذج بالبحث في مستنداتك قبل الإجابة",
  ragSearchingDocuments: "جارٍ البحث في مستنداتك…",
  ragChipNothing: "لا توجد ملفات مفهرسة بعد",
  ragChipIndexing: "جارٍ الفهرسة…",
  ragChipIndexed: "ملف مفهرس",
  ragChipErrors: "أخطاء",
  ragFolderActive: "نشط",
  ragFolderError: "خطأ",
  ragFolderLastIndexed: "آخر فهرسة",
  ragFolderFiles: "ملف",
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/ar.ts
git commit -m "feat: add i18n strings for agent mode and RAG status"
```

---

### Task 3: Add `agentMode` to ComposerDraft + setAgentMode

**Files:**
- Modify: `src/state/composerStore.ts`
- Test: `src/state/composerStore.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/state/composerStore.spec.ts` inside the describe block:

```ts
it("setAgentMode مقيد بجلسته ويبقى افتراضيًا false", () => {
  const s = useComposerStore.getState();
  expect(s.getDraft("s1").agentMode).toBe(false);
  s.setAgentMode("s1", true);
  expect(s.getDraft("s1").agentMode).toBe(true);
  expect(s.getDraft("s2").agentMode).toBe(false);
});
```

Also update the two existing `toEqual` assertions that check the full draft shape. On line 29, change:

```ts
expect(first).toEqual({ targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null });
```

to:

```ts
expect(first).toEqual({ targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null, agentMode: false });
```

On line 53, change:

```ts
expect(useComposerStore.getState().getDraft("s1")).toEqual({ targets: [], syncMode: true, sharedPrompt: "سؤال", customs: {}, focusTargetId: null });
```

to:

```ts
expect(useComposerStore.getState().getDraft("s1")).toEqual({ targets: [], syncMode: true, sharedPrompt: "سؤال", customs: {}, focusTargetId: null, agentMode: false });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/state/composerStore.spec.ts`
Expected: FAIL — `agentMode` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/state/composerStore.ts`:

1. Add to `ComposerDraft` interface:
```ts
  agentMode: boolean;
```

2. Update `emptyComposerDraft`:
```ts
export function emptyComposerDraft(): ComposerDraft {
  return { targets: [], syncMode: true, sharedPrompt: "", customs: {}, focusTargetId: null, agentMode: false };
}
```

3. Add `setAgentMode` to `ComposerState` interface:
```ts
  setAgentMode(sessionId: string, value: boolean): void;
```

4. Add the implementation in the store:
```ts
  setAgentMode(sessionId, value) {
    set((s) => ({ drafts: { ...s.drafts, [sessionId]: { ...(s.drafts[sessionId] ?? emptyComposerDraft()), agentMode: value } } }));
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/state/composerStore.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/composerStore.ts src/state/composerStore.spec.ts
git commit -m "feat: add agentMode to composer draft"
```

---

### Task 4: dispatch.ts — stopWhen + tool execution hooks

**Files:**
- Modify: `src/lib/chat/dispatch.ts`
- Test: `src/lib/chat/dispatch.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/chat/dispatch.spec.ts`:

```ts
it("multi-step: النموذج يستدعي search_documents ثم يجيب بنتائجها", async () => {
  const toolCallSse = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
    'data: [DONE]\n\n',
  ].join("");
  let callCount = 0;
  setTransportFetch((async () => {
    callCount++;
    if (callCount === 1) {
      return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return sseResponse(["الإجابة"]);
  }) as unknown as typeof fetch);

  const toolStarts: string[] = [];
  const toolEnds: string[] = [];
  const out = await dispatchTurn({
    ...baseArgs,
    prompts: [prompts[0]],
    multiStepTools: true,
    onToolExecutionStart: (_tid, name) => { toolStarts.push(name); },
    onToolExecutionEnd: (_tid, name) => { toolEnds.push(name); },
  });

  expect(callCount).toBe(2);
  expect(toolStarts).toEqual(["search_documents"]);
  expect(toolEnds).toEqual(["search_documents"]);
  expect(out[0].status).toBe("done");
  expect(out[0].text).toContain("الإجابة");
});

it("single-step: النموذج يستدعي الأداة لكن البث يتوقف بعد خطوة واحدة", async () => {
  const toolCallSse = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: "دعني أبحث" } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search_documents", arguments: '{"query":"test"}' } }] } }] }) + '\n\n',
    'data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + '\n\n',
    'data: [DONE]\n\n',
  ].join("");
  let callCount = 0;
  setTransportFetch((async () => {
    callCount++;
    return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(toolCallSse)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch);

  const out = await dispatchTurn({
    ...baseArgs,
    prompts: [prompts[0]],
    multiStepTools: false,
  });

  expect(callCount).toBe(1);
  expect(out[0].text).toBe("دعني أبحث");
});
```

Also update `baseArgs` in dispatch.spec.ts to include `multiStepTools: false`:

```ts
const baseArgs = {
  operationId: "op1",
  sessionId: "s",
  turnId: "turn1",
  apiKeyFor: () => "k",
  sessionHeaderFor: () => ({}),
  timeoutMs: 5000,
  contextMode: "stateful" as const,
  multiStepTools: false,
  modelInfoFor: (targetId: string) => { ... },
  historyFor: (): readonly ChatMessage[] => [],
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/lib/chat/dispatch.spec.ts`
Expected: FAIL — `multiStepTools` is not a valid DispatchArgs field (TypeScript error in test), and the multi-step test fails because the loop stops after one step.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/chat/dispatch.ts`:

1. Update the import:
```ts
import { streamText, isStepCount } from "ai";
```

2. Add to `DispatchArgs`:
```ts
  multiStepTools: boolean;
  onToolExecutionStart?(targetId: string, toolName: string): void;
  onToolExecutionEnd?(targetId: string, toolName: string): void;
```

3. In the `streamText` call, add `stopWhen` and the tool hooks:
```ts
const result = streamText({
  model, messages: modelMessages, abortSignal: ac.signal, maxRetries: 0,
  tools: { search_documents: searchTool },
  stopWhen: args.multiStepTools ? isStepCount(5) : isStepCount(1),
  onToolExecutionStart: ({ toolCall }) => { args.onToolExecutionStart?.(p.targetId, toolCall.toolName); },
  onToolExecutionEnd: ({ toolCall }) => { args.onToolExecutionEnd?.(p.targetId, toolCall.toolName); },
  onError: ({ error }) => { if (rawError === undefined) rawError = error; },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/lib/chat/dispatch.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/dispatch.ts src/lib/chat/dispatch.spec.ts
git commit -m "feat: enable multi-step tool loop with stopWhen and tool execution hooks"
```

---

### Task 5: chatController.ts — forward multiStepTools + tool callbacks

**Files:**
- Modify: `src/lib/chat/chatController.ts`
- Test: `src/lib/chat/chatController.spec.ts`

- [ ] **Step 1: Write the failing test**

In `src/lib/chat/chatController.spec.ts`, add a `lastArgs` capture to the `dispatchHook`:

```ts
const dispatchHook = vi.hoisted(() => ({
  // ... existing fields ...
  lastArgs: null as Parameters<typeof actual.dispatchTurn>[0] | null,
}));
```

In the dispatch mock, capture args:
```ts
dispatchTurn: async (args: Parameters<typeof actual.dispatchTurn>[0]) => {
  dispatchHook.lastArgs = args;
  dispatchHook.calls += 1;
  // ... existing logic ...
}
```

Add `multiStepTools: false` to `baseArgs`:
```ts
function baseArgs(session: SessionMeta, over: Partial<SendArgs> = {}): SendArgs {
  const operationSignal = new AbortController().signal;
  return {
    session, turn: { id: "turn-" + session.id, sharedPrompt: "سؤال مشترك؟", customs: {} },
    targets, syncMode: true,
    operationId: "op1",
    operationSignal,
    contextMode: "stateful",
    multiStepTools: false,
    historyFor: () => [],
    modelInfoFor: () => ({ id: "m", label: "نموذج", contextLength: 128000 }),
    apiKeyFor: () => "k", sessionHeaderFor: () => undefined,
    externalSignalFor: () => operationSignal, timeoutMs: 5000,
    ...over,
  };
}
```

Add the test:
```ts
it("multiStepTools وtool callbacks تمر من sendTurn إلى dispatchTurn", async () => {
  const s = await mkSession("tool-forward");
  const { cb } = makeCb();
  cb.onToolExecutionStart = () => {};
  cb.onToolExecutionEnd = () => {};
  await sendTurn(baseArgs(s, { targets: [targets[0]], multiStepTools: true }), cb);
  expect(dispatchHook.lastArgs?.multiStepTools).toBe(true);
  expect(dispatchHook.lastArgs?.onToolExecutionStart).toBe(cb.onToolExecutionStart);
  expect(dispatchHook.lastArgs?.onToolExecutionEnd).toBe(cb.onToolExecutionEnd);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/lib/chat/chatController.spec.ts`
Expected: FAIL — `multiStepTools` is not in SendArgs.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/chat/chatController.ts`:

1. Add to `SendCallbacks`:
```ts
  onToolExecutionStart?(targetId: string, toolName: string): void;
  onToolExecutionEnd?(targetId: string, toolName: string): void;
```

2. Add to `SendArgs`:
```ts
  multiStepTools: boolean;
```

3. In the `dispatchTurn` call, add the new fields:
```ts
      outcomes = await dispatchTurn({
        // ... existing fields ...
        multiStepTools: args.multiStepTools,
        onToolExecutionStart: args.onToolExecutionStart,
        onToolExecutionEnd: args.onToolExecutionEnd,
      });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/lib/chat/chatController.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chat/chatController.ts src/lib/chat/chatController.spec.ts
git commit -m "feat: forward multiStepTools and tool callbacks through chatController"
```

---

### Task 6: Composer.tsx — agent mode switch UI

**Files:**
- Modify: `src/features/chat/Composer.tsx`
- Test: `src/features/chat/Composer.spec.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/features/chat/Composer.spec.tsx`:

```tsx
import { describe, expect, it, beforeEach } from "vitest";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/chat/Composer.spec.tsx`
Expected: FAIL — the switch is not rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/features/chat/Composer.tsx`:

1. Add `agentMode` to the draft selector:
```ts
  const { targets, syncMode, sharedPrompt, customs, focusTargetId, agentMode } = useComposerStore(useShallow((s) => {
    const d = s.drafts[sessionId] ?? EMPTY_COMPOSER_DRAFT;
    return { targets: d.targets, syncMode: d.syncMode, sharedPrompt: d.sharedPrompt, customs: d.customs, focusTargetId: d.focusTargetId, agentMode: d.agentMode };
  }));
```

2. Add the store action:
```ts
  const setAgentMode = useComposerStore((s) => s.setAgentMode);
```

3. Add the switch in the targets row, after the context mode label:
```tsx
        {ragSettings.agentMode === "toggle" && (
          <label className="flex items-center gap-1 text-xs text-sura-muted" title={ar.agentModeHint}>
            <Switch checked={agentMode} onCheckedChange={(v) => setAgentMode(sessionId, v)} aria-label={ar.agentMode} />
            {ar.agentMode}
          </label>
        )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/features/chat/Composer.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/Composer.tsx src/features/chat/Composer.spec.tsx
git commit -m "feat: add agent mode switch to composer"
```

---

### Task 7: ragStore — liveQuery + folder wiring

**Files:**
- Modify: `src/state/ragStore.ts`
- Test: `src/state/ragStore.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/state/ragStore.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRagStore } from "./ragStore";
import { DEFAULT_RAG_SETTINGS } from "@/types";
import { db } from "@/lib/db/db";

vi.mock("@/lib/db/repos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/repos")>();
  return { ...actual, setSetting: vi.fn(async () => undefined), getSetting: vi.fn(async () => null) };
});

vi.mock("@/lib/rag/folderManager", () => ({
  addExternalFolder: vi.fn(async (path: string, label: string, autoReindex: boolean) => ({
    id: "folder-" + Date.now(), path, label, autoReindex, lastIndexedAt: Date.now(), status: "active" as const,
  })),
  removeExternalFolder: vi.fn(async () => undefined),
  getFolders: vi.fn(async () => []),
}));

describe("ragStore", () => {
  beforeEach(async () => {
    await db.rag_documents.clear();
    await db.rag_chunks.clear();
    await db.rag_folders.clear();
    await db.settings.clear();
    useRagStore.setState({ settings: DEFAULT_RAG_SETTINGS, documents: [], folders: [], loaded: false, loading: false, error: null });
  });

  it("load يجلب الإعدادات والمستندات والمجلدات", async () => {
    await useRagStore.getState().load();
    expect(useRagStore.getState().loaded).toBe(true);
    expect(useRagStore.getState().documents).toEqual([]);
    expect(useRagStore.getState().folders).toEqual([]);
  });

  it("liveQuery: مستند جديد ينتشر تلقائيًا إلى المخزن", async () => {
    await useRagStore.getState().load();
    await db.rag_documents.put({ id: "d1", source: "upload", persistence: "persistent", fileName: "f.pdf", fileType: "pdf", fileSize: 1, status: "indexing", uploadedAt: Date.now(), chunkCount: 0, embeddingModelId: "m" });
    await vi.waitFor(() => expect(useRagStore.getState().documents).toHaveLength(1));
  });

  it("addFolder يستدعي addExternalFolder بالمسار والاسم", async () => {
    await useRagStore.getState().load();
    const { addExternalFolder } = await import("@/lib/rag/folderManager");
    await useRagStore.getState().addFolder("/docs", "مستنداتي", true);
    expect(addExternalFolder).toHaveBeenCalledWith("/docs", "مستنداتي", true, expect.anything());
  });

  it("removeFolder يستدعي removeExternalFolder", async () => {
    await useRagStore.getState().load();
    const { removeExternalFolder } = await import("@/lib/rag/folderManager");
    await useRagStore.getState().removeFolder("folder-1");
    expect(removeExternalFolder).toHaveBeenCalledWith("folder-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/state/ragStore.spec.ts`
Expected: FAIL — `addFolder`/`removeFolder` have the old signature, no liveQuery.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/state/ragStore.ts`:

```ts
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

  load(): Promise<void>;
  updateSettings(patch: Partial<RagSettings>): Promise<void>;
  setDocuments(docs: RagDocument[]): void;
  setFolders(folders: RagFolder[]): void;
  addFolder(path: string, label: string, autoReindex: boolean): Promise<RagFolder>;
  removeFolder(folderId: string): Promise<void>;
  refreshDocuments(): Promise<void>;
}

export const useRagStore = create<RagState>((set, get) => ({
  settings: DEFAULT_RAG_SETTINGS,
  documents: [],
  folders: [],
  loaded: false,
  loading: false,
  error: null,

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
      set({ error: error instanceof Error ? error.message : String(error), loading: false });
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
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/state/ragStore.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state/ragStore.ts src/state/ragStore.spec.ts
git commit -m "feat: wire ragStore to liveQuery and real folder pipeline"
```

---

### Task 8: RagFolderManager.tsx — real pipeline UI

**Files:**
- Modify: `src/features/rag/RagFolderManager.tsx`
- Test: `src/features/rag/RagFolderManager.spec.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/features/rag/RagFolderManager.spec.tsx`:

```tsx
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RagFolderManager } from "./RagFolderManager";
import { useRagStore } from "@/state/ragStore";
import { DEFAULT_RAG_SETTINGS, type RagDocument, type RagFolder } from "@/types";

const folder: RagFolder = { id: "f1", path: "/docs", label: "مستندات", autoReindex: true, lastIndexedAt: Date.parse("2026-09-29T10:00:00Z"), status: "active" };
const doc: RagDocument = { id: "d1", source: "external", persistence: "persistent", fileName: "a.pdf", fileType: "pdf", fileSize: 10, status: "indexed", uploadedAt: 0, chunkCount: 2, embeddingModelId: "m", folderId: "f1" };

describe("RagFolderManager", () => {
  beforeEach(() => {
    useRagStore.setState({ settings: DEFAULT_RAG_SETTINGS, documents: [doc], folders: [folder], loaded: true, loading: false, error: null });
  });

  it("يعرض المجلد مع حالته وعدد ملفاته", () => {
    render(<RagFolderManager />);
    expect(screen.getByText("مستندات")).toBeTruthy();
    expect(screen.getByText("نشط")).toBeTruthy();
    expect(screen.getByText(/1 ملف/)).toBeTruthy();
  });

  it("زر الإضافة يستدعي addFolder بالمسار", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "/new-docs"));
    const user = userEvent.setup();
    render(<RagFolderManager />);
    await user.click(screen.getByText("إضافة مجلد"));
    await vi.waitFor(() => expect(useRagStore.getState().folders.length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/rag/RagFolderManager.spec.tsx`
Expected: FAIL — the component uses the old stub store API.

- [ ] **Step 3: Write minimal implementation**

Rewrite `src/features/rag/RagFolderManager.tsx`:

```tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useRagStore } from "@/state/ragStore";
import { updateFolder } from "@/lib/rag/folderManager";
import { toast } from "sonner";
import { ar } from "@/i18n/ar";

export function RagFolderManager() {
  const { folders, documents, addFolder, removeFolder } = useRagStore();
  const [adding, setAdding] = useState(false);

  const handleAddFolder = async () => {
    const path = prompt("أدخل مسار المجلد:");
    if (!path) return;
    const parts = path.split(/[\\/]/);
    const label = prompt("اسم المجلد (اختياري):") ?? parts[parts.length - 1] ?? path;
    setAdding(true);
    try {
      await addFolder(path, label, true);
    } catch {
      toast.error("فشل إضافة المجلد");
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveFolder = async (folderId: string) => {
    if (!confirm("إزالة هذا المجلد؟ سيتم حذف جميع الملفات المفهرسة منه.")) return;
    try {
      await removeFolder(folderId);
    } catch {
      toast.error("فشل إزالة المجلد");
    }
  };

  const fileCountFor = (folderId: string) => documents.filter((d) => d.folderId === folderId).length;

  return (
    <div className="space-y-3 text-sm" dir="rtl">
      {folders.length === 0 ? (
        <p className="text-xs text-sura-muted text-center py-4">
          لا توجد مجلدات خارجية. أضف مجلدًا لفهرسة ملفاته.
        </p>
      ) : (
        <div className="space-y-2">
          {folders.map((folder) => (
            <div key={folder.id} className="flex items-center gap-2 p-2 rounded border border-sura-border text-xs">
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{folder.label}</p>
                <p className="text-sura-muted truncate">{folder.path}</p>
                <p className="text-sura-muted">
                  {folder.status === "error" ? ar.ragFolderError : ar.ragFolderActive}
                  {folder.lastIndexedAt ? " · " + ar.ragFolderLastIndexed + ": " + new Date(folder.lastIndexedAt).toLocaleString() : ""}
                  {fileCountFor(folder.id) > 0 ? " · " + fileCountFor(folder.id) + " " + ar.ragFolderFiles : ""}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-sura-muted">تلقائي</span>
                <Switch checked={folder.autoReindex} onCheckedChange={(v) => { void updateFolder(folder.id, { autoReindex: v }); }} />
              </div>
              <button className="text-sura-muted hover:text-sura-warn" onClick={() => void handleRemoveFolder(folder.id)} aria-label={ar.ragRemoveFolder}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <Button size="sm" variant="outline" disabled={adding} onClick={() => void handleAddFolder()}>
        {ar.ragAddFolder}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/features/rag/RagFolderManager.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/rag/RagFolderManager.tsx src/features/rag/RagFolderManager.spec.tsx
git commit -m "feat: wire RagFolderManager to real indexing pipeline"
```

---

### Task 9: RagStatusChip.tsx — new component

**Files:**
- Create: `src/features/rag/RagStatusChip.tsx`
- Test: `src/features/rag/RagStatusChip.spec.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/features/rag/RagStatusChip.spec.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { summarizeRagStatus } from "./RagStatusChip";
import type { RagDocument, RagFolder } from "@/types";

const doc = (over: Partial<RagDocument>): RagDocument => ({
  id: "d", source: "upload", persistence: "persistent", fileName: "f", fileType: "pdf",
  fileSize: 1, status: "indexed", uploadedAt: 0, chunkCount: 0, embeddingModelId: "m", ...over,
});

describe("summarizeRagStatus", () => {
  it("لا توجد ملفات مفهرسة عندما يكون كل شيء فارغًا", () => {
    expect(summarizeRagStatus([], []).tone).toBe("muted");
  });
  it("جارٍ الفهرسة عندما يوجد مستند قيد الفهرسة", () => {
    expect(summarizeRagStatus([doc({ status: "indexing" })], []).tone).toBe("active");
  });
  it("تحذير عند وجود أخطاء", () => {
    expect(summarizeRagStatus([doc({ status: "error" })], []).tone).toBe("warn");
  });
  it("عدد الملفات المفهرسة عند عدم وجود نشاط", () => {
    const s = summarizeRagStatus([doc({ status: "indexed" }), doc({ status: "indexed" })], []);
    expect(s.tone).toBe("ok");
    expect(s.label).toContain("2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/rag/RagStatusChip.spec.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/rag/RagStatusChip.tsx`:

```tsx
import { useRagStore } from "@/state/ragStore";
import { ar } from "@/i18n/ar";
import type { RagDocument, RagFolder } from "@/types";

export type RagStatusTone = "muted" | "active" | "warn" | "ok";

export interface RagStatusSummary {
  label: string;
  tone: RagStatusTone;
}

export function summarizeRagStatus(documents: RagDocument[], folders: RagFolder[]): RagStatusSummary {
  const indexing = documents.filter((d) => d.status === "indexing").length;
  const errors = documents.filter((d) => d.status === "error").length;
  const indexed = documents.filter((d) => d.status === "indexed").length;

  if (documents.length === 0 && folders.length === 0) {
    return { label: ar.ragChipNothing, tone: "muted" };
  }
  if (indexing > 0) {
    return { label: ar.ragChipIndexing, tone: "active" };
  }
  if (errors > 0) {
    return { label: errors + " " + ar.ragChipErrors, tone: "warn" };
  }
  const folderPart = folders.length > 0 ? " · " + folders.length + " " + ar.ragFolderFiles : "";
  return { label: indexed + " " + ar.ragChipIndexed + folderPart, tone: "ok" };
}

export function RagStatusChip({ onOpenSettings }: { onOpenSettings(): void }) {
  const documents = useRagStore((s) => s.documents);
  const folders = useRagStore((s) => s.folders);
  const summary = summarizeRagStatus(documents, folders);

  return (
    <button
      type="button"
      onClick={onOpenSettings}
      className={"flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors " + (
        summary.tone === "muted" ? "border-sura-border text-sura-muted" :
        summary.tone === "active" ? "border-sura-accent text-sura-accent" :
        summary.tone === "warn" ? "border-sura-warn text-sura-warn" :
        "border-sura-border text-sura-foreground"
      )}
      title={ar.ragFiles}
    >
      {summary.tone === "active" && <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" />}
      {summary.label}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/features/rag/RagStatusChip.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/rag/RagStatusChip.tsx src/features/rag/RagStatusChip.spec.tsx
git commit -m "feat: add RagStatusChip component"
```

---

### Task 10: TurnView.tsx — tool activity note

**Files:**
- Modify: `src/features/chat/TurnView.tsx`
- Test: `src/features/chat/TurnView.spec.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `src/features/chat/TurnView.spec.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TurnView } from "./TurnView";
import type { ChatMessage } from "@/types";

const result: ChatMessage = {
  id: "r1", sessionId: "s", turnId: "t", createdAt: 0,
  role: "assistant", kind: "result", text: "",
  status: "streaming", targetId: "t1",
};

describe("TurnView tool activity note", () => {
  it("يعرض ملاحظة البحث عندما تكون هناك أداة نشطة", () => {
    render(<TurnView prompts={[]} results={[result]} layout="vertical" customPrompts={{}} onToggleLayout={() => {}} onStop={() => {}} onRetry={() => {}} toolActivity={{ t1: "search_documents" }} />);
    expect(screen.getByText("جارٍ البحث في مستنداتك…")).toBeTruthy();
  });

  it("لا يعرض ملاحظة البحث عندما لا توجد أداة نشطة", () => {
    render(<TurnView prompts={[]} results={[result]} layout="vertical" customPrompts={{}} onToggleLayout={() => {}} onStop={() => {}} onRetry={() => {}} />);
    expect(screen.queryByText("جارٍ البحث في مستنداتك…")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/chat/TurnView.spec.tsx`
Expected: FAIL — `toolActivity` prop not accepted.

- [ ] **Step 3: Write minimal implementation**

In `src/features/chat/TurnView.tsx`:

1. Add the prop:
```tsx
export function TurnView({ prompts, results, layout, customPrompts, onToggleLayout, onStop, onRetry, disabled = false, stopDisabled = false, toolActivity }: {
  prompts: ChatMessage[]; results: ChatMessage[]; layout: "vertical" | "horizontal";
  customPrompts: Record<string, string | null>;
  onToggleLayout(): void; onStop(message: ChatMessage): void; onRetry(message: ChatMessage): void;
  disabled?: boolean;
  stopDisabled?: boolean | ((message: ChatMessage) => boolean);
  toolActivity?: Record<string, string>;
}) {
```

2. Add the note before the ResultCards:
```tsx
      {Object.keys(toolActivity ?? {}).some((tid) => results.some((r) => r.targetId === tid)) && (
        <div className="flex items-center gap-2 text-xs text-sura-accent" role="status">
          <span className="size-1.5 rounded-full bg-sura-accent animate-pulse" />
          {ar.ragSearchingDocuments}
        </div>
      )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/features/chat/TurnView.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/TurnView.tsx src/features/chat/TurnView.spec.tsx
git commit -m "feat: show tool activity note in TurnView"
```

---

### Task 11: ChatScreen.tsx + App.tsx — wiring

**Files:**
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `src/App.tsx`
- Test: `src/features/chat/ChatScreen.spec.tsx` (extend existing)

- [ ] **Step 1: Write the failing test**

In `src/features/chat/ChatScreen.spec.tsx`, add a test that verifies the RagStatusChip renders and clicking it calls onOpenSettings. (Follow the existing patterns in that file for rendering ChatScreen with mocked stores.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run src/features/chat/ChatScreen.spec.tsx`
Expected: FAIL — chip not rendered.

- [ ] **Step 3: Write minimal implementation**

In `src/features/chat/ChatScreen.tsx`:

1. Add the prop:
```tsx
export function ChatScreen({ session, onOpenSettings }: { session: SessionMeta; onOpenSettings(): void }) {
```

2. Add toolActivity state and multiStep computation:
```tsx
  const [toolActivity, setToolActivity] = useState<Record<string, string>>({});
  const agentMode = useComposerStore((s) => (s.drafts[sessionId] ?? EMPTY_COMPOSER_DRAFT).agentMode);
  const ragSettings = useSettingsStore((s) => s.ragSettings);
  const multiStepTools = ragSettings.agentMode === "always" || agentMode;
```

3. In the `sendTurn` call, add:
```tsx
          multiStepTools,
          onToolExecutionStart: (targetId, toolName) => {
            setToolActivity((prev) => ({ ...prev, [targetId]: toolName }));
          },
          onToolExecutionEnd: (targetId) => {
            setToolActivity((prev) => {
              const next = { ...prev };
              delete next[targetId];
              return next;
            });
          },
```

4. In the summary `dispatchTurn` call, add `multiStepTools: false`.

5. In the render, add the chip and pass toolActivity:
```tsx
    <main ref={mainRef} tabIndex={-1} className="flex-1 flex flex-col h-full min-w-0">
      <div className="px-4 pt-3 flex justify-start">
        <RagStatusChip onOpenSettings={onOpenSettings} />
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4" dir="rtl" role="log" aria-live="polite" aria-label="الرسائل">
        {turns.map(([turnId, t]) => (
          <TurnView key={turnId} prompts={t.prompts} results={t.results} layout={session.layoutMode}
            customPrompts={t.customPrompts} onToggleLayout={() => void onToggleLayout()}
            onStop={(message) => { cancelCurrentOperation(message); }}
            disabled={sending}
            stopDisabled={stopDisabledFor}
            onRetry={(message) => { ... }}
            toolActivity={toolActivity} />
        ))}
      </div>
      <Composer ... />
    </main>
```

In `src/App.tsx`:
```tsx
<ChatScreen key={currentSession.id} session={currentSession} onOpenSettings={() => setShowSettings(true)} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run src/features/chat/ChatScreen.spec.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/ChatScreen.tsx src/App.tsx src/features/chat/ChatScreen.spec.tsx
git commit -m "feat: wire RagStatusChip and toolActivity into ChatScreen"
```

---

### Task 12: RagSettings.tsx — agent mode select UI

**Files:**
- Modify: `src/features/rag/RagSettings.tsx`

- [ ] **Step 1: Add the UI**

In `src/features/rag/RagSettings.tsx`, add a new section before the External Folders Auto Reindex section:

```tsx
      {/* Agent Mode */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragAgentMode}</h3>
        <p className="text-xs text-sura-muted">{ar.ragAgentModeDesc}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          value={ragSettings.agentMode}
          onChange={(e) => update({ agentMode: e.target.value as RagSettingsType["agentMode"] })}
        >
          <option value="always">{ar.ragAgentAlways}</option>
          <option value="toggle">{ar.ragAgentToggle}</option>
        </select>
      </section>
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/rag/RagSettings.tsx
git commit -m "feat: add agent mode select to RAG settings"
```

---

### Task 13: Final validation

**Files:** none (validation only)

- [ ] **Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: PASS (no new errors).

- [ ] **Step 3: Run all tests**

Run: `pnpm test`
Expected: PASS (all tests green).

- [ ] **Step 4: Run build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Review the diff**

Run: `git log --oneline` and `git diff main...HEAD --stat` (or equivalent) to review all commits.
Expected: 13 clean commits, one per task.

---

## Self-Review

**Spec coverage:**
- Agent loop fix (stopWhen) → Task 4 ✓
- A/C mode setting + default "always" → Tasks 1, 12 ✓
- Per-turn toggle in composer (C mode, default OFF) → Tasks 3, 6 ✓
- Tool execution visibility → Tasks 4, 5, 10, 11 ✓
- RAG status indicator (chat header + settings) → Tasks 7, 9, 11 ✓
- Folder manager wiring → Tasks 7, 8 ✓
- i18n → Task 2 ✓
- Testing → Tasks 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13 ✓

**Placeholder scan:** No TBDs, TODOs, or "implement later" — every step has complete code.

**Type consistency:** `agentMode` is `"always" | "toggle"` in types, defaults, store, composer, and UI. `multiStepTools` is `boolean` in DispatchArgs and SendArgs. `toolActivity` is `Record<string, string>` in ChatScreen and TurnView. `addFolder(path, label, autoReindex)` signature is consistent between store and manager.
