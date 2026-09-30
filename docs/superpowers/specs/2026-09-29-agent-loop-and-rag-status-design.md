# Agent Loop (A/C Modes) + RAG Status Indicator + Folder Wiring — Design Spec

Date: 2026-09-29
Status: Approved by user

## Problem

1. **"Let me search" then stops.** When the user asks about their files, the model says "Let me search" and the turn ends. Root cause: src/lib/chat/dispatch.ts calls streamText with the search_documents tool but no stopWhen. In the installed ai@7.0.92 the runtime default is stopWhen = isStepCount(1) (verified in node_modules/ai/dist/index.js), so the tool loop stops after one step: the model emits the tool call, the loop halts, the model never receives the results, and the stream ends.
2. **No status indicator.** Per-file status badges (مفهرس / جارٍ الفهرسة / خطأ) exist only inside Settings → RAG → Files. The chat UI has zero RAG visibility, so the user cannot know whether their files/folders have been embedded and stored.
3. **Folder manager is a stub.** RagFolderManager adds folders via prompt() to an in-memory store only — it never calls the real indexing pipeline, and "remove" does not delete indexed files despite the confirmation text promising it.

## Decisions (confirmed with user)

- **Agent mode:** implement both A (always-on multi-step) and C (per-turn toggle). The user chooses in Settings; **default is A**; the user can change the default to C.
- **C mode behavior:** the composer shows an "Agent mode" switch that starts **OFF** each turn — single-step (current behavior) unless the user explicitly enables multi-call for that turn.
- **Indicator location:** chat header chip + existing per-file badges in Settings.
- **Folder manager:** wire to the real pipeline.
- **Tool visibility:** show a live "Searching your documents…" note while the tool runs.

## Architecture

### 1. Agent loop fix + A/C mode setting

- src/types/index.ts: RagSettings gains agentMode: "always" | "toggle" (default "always" in DEFAULT_RAG_SETTINGS). Persisted inside the existing rag settings record — **no DB schema change**.
- src/lib/chat/dispatch.ts: streamText receives an explicit stopWhen:
  - multi-step → isStepCount(5) (import isStepCount from ai)
  - single-step → isStepCount(1)
  The choice comes from a new multiStepTools: boolean field in DispatchArgs.
- src/state/composerStore.ts: ComposerDraft gains agentMode: boolean (default false) and setAgentMode(sessionId, value).
- src/features/chat/Composer.tsx: shows an "وضع الوكيل" (Agent mode) switch **only when** ragSettings.agentMode === "toggle". In "always" mode the switch is hidden and every turn is multi-step.
- src/lib/chat/chatController.ts: SendArgs gains multiStepTools: boolean, forwarded to dispatchTurn.
- src/features/chat/ChatScreen.tsx: computes effectiveMultiStep = ragSettings.agentMode === "always" || draft.agentMode and passes it in SendArgs. The summary/extract path passes false (summaries do not search).

### 2. Tool execution visibility

- src/lib/chat/dispatch.ts: DispatchArgs gains optional onToolExecutionStart(targetId, toolName) / onToolExecutionEnd(targetId, toolName), wired to streamText's onToolExecutionStart / onToolExecutionEnd hooks (event exposes toolCall.toolName).
- src/lib/chat/chatController.ts: SendCallbacks gains the same two callbacks, forwarded to dispatchTurn.
- src/features/chat/ChatScreen.tsx: a toolActivity state (Record<targetId, toolName>) updated through the callbacks, passed to TurnView.
- src/features/chat/TurnView.tsx: renders a transient "جارٍ البحث في مستنداتك…" note inside the active turn while any of its targets has a running tool.

### 3. RAG status indicator

- src/state/ragStore.ts: load() subscribes via Dexie liveQuery to rag_documents and rag_folders so uploads, folder indexing, deletions, and status changes propagate to all subscribers automatically (no polling). refreshDocuments() remains for compatibility. Subscriptions are torn down on reload to avoid duplicates.
- New src/features/rag/RagStatusChip.tsx: rendered at the top of ChatScreen's <main> (above the message log). Aggregates store state:
  - no documents and no folders → "لا توجد ملفات مفهرسة بعد" (muted)
  - any indexing → "جارٍ الفهرسة…" (animated)
  - any error → error count (warning style)
  - otherwise → "N ملف مفهرس" (+ folder count)
  Clicking opens Settings.
- src/App.tsx: passes onOpenSettings={() => setShowSettings(true)} to ChatScreen.
- Settings per-file badges in RagFileManager stay unchanged.

### 4. Folder manager wiring

- src/state/ragStore.ts: addFolder becomes async and calls the real addExternalFolder() (persist + index); removeFolder calls the real removeExternalFolder() (deletes indexed files as the UI promises); folders load from the DB during load().
- src/features/rag/RagFolderManager.tsx: drops the prompt-only stub — add/remove go through the real pipeline; each folder row shows real status (active/error), lastIndexedAt, and its indexed file count; the auto-reindex switch calls updateFolder. Path entry stays a text prompt for now (Tauri directory dialog is a possible follow-up).

### 5. i18n

- New Arabic strings in src/i18n/ar.ts for the agent-mode setting, the composer switch, chip states, folder status, and the tool note.

## What does not change

- DB schema (the new setting joins the existing rag settings object).
- The search_documents tool's search logic.
- Chat persistence/recovery architecture and operation coordination.
- Settings record shape beyond the one new field.

## Testing

- Extend src/lib/chat/dispatch.spec.ts with a tool-calling SSE scenario: the model calls search_documents, receives results, then answers — proving the loop closes (and that single-step mode still stops after one step).
- New specs: RagStatusChip aggregate logic, ragStore folder wiring (add/remove through the real pipeline), TurnView tool note rendering.
- Validation: pnpm typecheck, pnpm lint, pnpm test, pnpm build.

## Risks / limitations

- isStepCount(5) bounds the loop; a model that searches more than 5 times in one turn stops early (acceptable; 5 covers search → answer with re-search).
- Folder path entry remains a manual text prompt; the Tauri directory dialog is deferred.
- The live store subscription means every RAG DB write updates all subscribers — intended for a status indicator, low volume.
