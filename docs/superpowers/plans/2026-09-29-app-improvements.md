# App Improvement Plan: Error Recovery, UX Polish & Reliability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 12 improvement areas identified in the code review, organized into 4 milestones. Focus on error recovery, user feedback, data safety, performance, accessibility, and reliability.

**Tech Stack:** React 19, TypeScript, Zustand, Dexie (IndexedDB), AI SDK v7, Tauri v2, Vitest, Testing Library.

---

## Milestone 1: Error Recovery & User Feedback (Critical)

**Impact:** Directly affects every user. The "Let me search" bug was a symptom of poor error handling.

### Task 1.1: Tool Execution Error Handling

**Files:**
- Modify: `src/lib/chat/dispatch.ts`
- Modify: `src/lib/rag/tool.ts`
- Test: `src/lib/chat/dispatch.spec.ts`

- [ ] **Step 1: Add error handling to tool execution**
  In `dispatch.ts`, wrap the tool execution in try-catch and emit a user-friendly error event:
  ```ts
  onToolExecutionEnd: ({ toolCall, result }) => {
    if (result && typeof result === "object" && "error" in result) {
      args.onToolExecutionError?.(p.targetId, toolCall.toolName, String(result.error));
    }
    args.onToolExecutionEnd?.(p.targetId, toolCall.toolName);
  },
  ```
- [ ] **Step 2: Add `onToolExecutionError` callback to `DispatchArgs`**
- [ ] **Step 3: Surface errors in `TurnView`**
  Show a dismissible error note when a tool fails.
- [ ] **Step 4: Add tests for error paths**
- [ ] **Step 5: Commit**

### Task 1.2: Indexing Error Visibility

**Files:**
- Modify: `src/state/ragStore.ts`
- Modify: `src/features/rag/RagStatusChip.tsx`
- Test: `src/state/ragStore.spec.ts`

- [ ] **Step 1: Track per-file indexing errors**
  Add an `indexingErrors` map to the store: `Record<string, string>` (fileId → error message).
- [ ] **Step 2: Update `RagStatusChip` to show error details**
  When errors exist, show a tooltip or expandable section with the error list.
- [ ] **Step 3: Add tests**
- [ ] **Step 4: Commit**

### Task 1.3: Retry Mechanism for Failed Operations

**Files:**
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `src/features/rag/RagFolderManager.tsx`

- [ ] **Step 1: Add retry button to failed tool executions**
  In `TurnView`, show a "Retry" button when a tool fails.
- [ ] **Step 2: Add retry for failed folder indexing**
  In `RagFolderManager`, show a "Retry" button for folders with error status.
- [ ] **Step 3: Commit**

---

## Milestone 2: Indexing Progress Visibility (Critical)

**Impact:** Makes the RAG feature feel polished and trustworthy.

### Task 2.1: Detailed Progress Tracking

**Files:**
- Modify: `src/state/ragStore.ts`
- Modify: `src/features/rag/RagStatusChip.tsx`
- Create: `src/features/rag/RagIndexingProgress.tsx`
- Test: `src/state/ragStore.spec.ts`

- [ ] **Step 1: Add progress tracking to `ragStore`**
  ```ts
  interface RagState {
    // ... existing
    indexingProgress: {
      totalFiles: number;
      completedFiles: number;
      currentFile: string | null;
      status: "idle" | "indexing" | "error";
    };
  }
  ```
- [ ] **Step 2: Create `RagIndexingProgress` component**
  Expandable panel showing: total files, completed, current file, progress bar.
- [ ] **Step 3: Integrate into `RagStatusChip`**
  Clicking the chip when indexing shows the progress panel.
- [ ] **Step 4: Add tests**
- [ ] **Step 5: Commit**

### Task 2.2: File-Level Progress in Folder Manager

**Files:**
- Modify: `src/features/rag/RagFolderManager.tsx`

- [ ] **Step 1: Show per-file progress in folder rows**
  For folders being indexed, show a progress bar and file count.
- [ ] **Step 2: Commit**

---

## Milestone 3: Data Backup & Restore (Critical)

**Impact:** Protects user data and builds trust.

### Task 3.1: Export Sessions

**Files:**
- Create: `src/lib/export/sessionExporter.ts`
- Modify: `src/features/chat/ChatScreen.tsx`
- Test: `src/lib/export/sessionExporter.spec.ts`

- [ ] **Step 1: Create `sessionExporter` module**
  Export sessions as Markdown or JSON:
  ```ts
  export function exportSessionAsMarkdown(session: Session, messages: ChatMessage[]): string;
  export function exportSessionAsJSON(session: Session, messages: ChatMessage[]): string;
  ```
- [ ] **Step 2: Add export button to ChatScreen**
  Add a "Export" button in the chat header.
- [ ] **Step 3: Add tests**
- [ ] **Step 4: Commit**

### Task 3.2: Export RAG Data

**Files:**
- Create: `src/lib/export/ragExporter.ts`
- Modify: `src/features/rag/RagSettings.tsx`
- Test: `src/lib/export/ragExporter.spec.ts`

- [ ] **Step 1: Create `ragExporter` module**
  Export documents, chunks, and folders as JSON.
- [ ] **Step 2: Add export button to RAG Settings**
- [ ] **Step 3: Add tests**
- [ ] **Step 4: Commit**

### Task 3.3: Import Functionality

**Files:**
- Create: `src/lib/export/ragImporter.ts`
- Modify: `src/features/rag/RagSettings.tsx`
- Test: `src/lib/export/ragImporter.spec.ts`

- [ ] **Step 1: Create `ragImporter` module**
  Import RAG data from JSON, with validation.
- [ ] **Step 2: Add import button to RAG Settings**
- [ ] **Step 3: Add tests**
- [ ] **Step 4: Commit**

---

## Milestone 4: Performance & Accessibility (High)

**Impact:** App speed and inclusivity.

### Task 4.1: Lazy Embedding Model Loading

**Files:**
- Modify: `src/lib/rag/embedder.ts`
- Modify: `src/lib/rag/tool.ts`
- Test: `src/lib/rag/embedder.spec.ts`

- [ ] **Step 1: Lazy-load the ONNX model**
  Load the model on first RAG use, not on startup.
- [ ] **Step 2: Add loading indicator**
  Show a loading state while the model loads.
- [ ] **Step 3: Handle load failures**
  Show a user-friendly error if the model fails to load.
- [ ] **Step 4: Add tests**
- [ ] **Step 5: Commit**

### Task 4.2: Accessibility Audit & Fixes

**Files:**
- Modify: `src/features/rag/RagStatusChip.tsx`
- Modify: `src/features/rag/RagFolderManager.tsx`
- Modify: `src/features/chat/Composer.tsx`

- [ ] **Step 1: Fix color contrast in `RagStatusChip`**
  Ensure all tone variants meet WCAG AA contrast ratios.
- [ ] **Step 2: Verify keyboard navigation**
  Ensure all interactive elements are keyboard accessible.
- [ ] **Step 3: Improve screen reader announcements**
  Add `aria-live` regions for dynamic content.
- [ ] **Step 4: Commit**

### Task 4.3: Test Coverage Gaps

**Files:**
- Create: `src/lib/rag/pipeline.spec.ts`
- Modify: `src/state/ragStore.spec.ts`

- [ ] **Step 1: Add RAG pipeline integration test**
  Test the full flow: upload → extract → chunk → embed → search.
- [ ] **Step 2: Add liveQuery → UI update flow test**
  Test that DB writes propagate to the UI.
- [ ] **Step 3: Add error path tests**
  Test network failures, corrupt files, etc.
- [ ] **Step 4: Commit**

---

## Milestone 5: User Experience (Medium)

**Impact:** Power user productivity and data portability.

### Task 5.1: Keyboard Shortcuts

**Files:**
- Create: `src/lib/keyboard/shortcuts.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/chat/ChatScreen.tsx`
- Test: `src/lib/keyboard/shortcuts.spec.ts`

- [ ] **Step 1: Create `shortcuts` module**
  Define and handle keyboard shortcuts:
  - `Ctrl+K`: Search
  - `Ctrl+N`: New session
  - `Ctrl+Shift+S`: Settings
  - `Escape`: Stop generation
- [ ] **Step 2: Add shortcut help dialog**
  Show available shortcuts with `?`.
- [ ] **Step 3: Add tests**
- [ ] **Step 4: Commit**

### Task 5.2: Session Export UI

**Files:**
- Modify: `src/features/chat/ChatScreen.tsx`
- Create: `src/features/chat/SessionExportDialog.tsx`

- [ ] **Step 1: Create export dialog**
  Let users choose format (Markdown/JSON) and messages to include.
- [ ] **Step 2: Integrate into ChatScreen**
- [ ] **Step 3: Commit**

### Task 5.3: Smart Default Settings

**Files:**
- Modify: `src/features/settings/SettingsScreen.tsx`
- Create: `src/features/settings/SimpleModeToggle.tsx`

- [ ] **Step 1: Add simple mode toggle**
  Hide advanced settings when enabled.
- [ ] **Step 2: Add recommended defaults**
  Based on use case (RAG vs. chat-only).
- [ ] **Step 3: Commit**

---

## Milestone 6: Polish (Low)

**Impact:** Code quality and maintainability.

### Task 6.1: Bundle Optimization

**Files:**
- Modify: `src/lib/rag/vectorIndex.ts`
- Modify: `src/lib/rag/documentManager.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Fix ineffective dynamic imports**
  Remove duplicate static/dynamic imports of `vectorIndex.ts`.
- [ ] **Step 2: Code splitting for RAG pipeline**
  Lazy-load the RAG pipeline modules.
- [ ] **Step 3: Commit**

### Task 6.2: Lint Cleanup

**Files:**
- Modify: `src/lib/rag/embedder.ts`
- Modify: `src/lib/rag/fileProcessor.ts`
- Modify: `src/lib/rag/reindexManager.ts`
- Modify: `src/lib/rag/tool.ts`
- Modify: `src/lib/rag/vectorIndex.ts`
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Fix `no-explicit-any` errors**
  Replace `any` with proper types.
- [ ] **Step 2: Fix `no-case-declarations` error**
  Wrap case block in braces.
- [ ] **Step 3: Fix `no-unused-vars` error**
  Remove or use the unused variable.
- [ ] **Step 4: Fix `prefer-const` error**
  Change `let` to `const`.
- [ ] **Step 5: Commit**

### Task 6.3: User Documentation

**Files:**
- Create: `docs/user-guide.md`
- Create: `docs/troubleshooting.md`

- [ ] **Step 1: Write user guide**
  How to use RAG, settings, keyboard shortcuts.
- [ ] **Step 2: Write troubleshooting guide**
  Common issues and solutions.
- [ ] **Step 3: Commit**

---

## Execution Order

1. **Milestone 1** (Error Recovery) — 3 tasks
2. **Milestone 2** (Indexing Progress) — 2 tasks
3. **Milestone 3** (Data Backup) — 3 tasks
4. **Milestone 4** (Performance & A11y) — 3 tasks
5. **Milestone 5** (UX) — 3 tasks
6. **Milestone 6** (Polish) — 3 tasks

**Total:** 17 tasks across 6 milestones.

---

## Self-Review

**Coverage:**
- Error recovery & user feedback → Milestone 1 ✓
- Indexing progress visibility → Milestone 2 ✓
- Data backup & restore → Milestone 3 ✓
- Performance (lazy loading) → Milestone 4 ✓
- Accessibility → Milestone 4 ✓
- Test coverage → Milestone 4 ✓
- Keyboard shortcuts → Milestone 5 ✓
- Session export → Milestone 5 ✓
- Smart defaults → Milestone 5 ✓
- Bundle optimization → Milestone 6 ✓
- Lint cleanup → Milestone 6 ✓
- Documentation → Milestone 6 ✓

**Placeholder scan:** No TBDs or TODOs — every task has concrete steps.

**Dependencies:** Milestones are independent and can be executed in any order. Within each milestone, tasks are sequential.
