
# Shura Hardening and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Shura prototype into a usable local-first web and Tauri application with correct session semantics, durable local persistence, safe credential handling, accessible UI, and a repeatable release gate.

**Architecture:** Keep the existing React/Vite/Tauri/Dexie stack and provider boundary. Add session-keyed state, persisted turn/attempt snapshots, a per-session operation coordinator, an atomic archive manifest with deletion tombstones, and a startup recovery gate. Provider tests use injected fetches and fake IndexedDB; real-provider checks remain an explicit human smoke test.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Tailwind 4, Radix/shadcn primitives, Zustand, Dexie 4, Vercel AI SDK 7, Tauri 2, Rust 2021, keyring 3 for desktop credentials, Vitest 5, Testing Library, Playwright, and GitHub Actions.

---

## Delivery rules

- Work from the repository root and use pnpm. Do not replace the lockfile or mix package managers.
- Preserve existing session data. Every Dexie schema change has a forward migration and a regression test.
- Use stateful context by default because the approved design and README promise session context. Stateless comparison remains available only when explicitly selected.
- Automated tests never use real provider keys, paid requests, deployment credentials, or external accounts. They intercept provider requests with the injected fetch.
- Do not reset Git history, delete user data, or discard unrelated working-tree changes.
- Each task ends with its focused test and a descriptive commit. Tasks 1-10 run the checks named in their final step; Task 11 runs the complete release gate. Do not merge a task whose acceptance criteria fail.
- The packaged Tauri smoke test is a separate release gate because this environment has no live packaged GUI or user-supplied disposable test key.

## File map

| File | Responsibility after this plan |
|---|---|
| `src/types/index.ts` | Session, target, turn/attempt, usage, and archive contracts |
| `src/lib/db/db.ts` and `src/lib/db/repos.ts` | Dexie versions, migrations, tombstones, turn records, transactional recovery imports |
| `src/lib/chat/context.ts` | Stateful/stateless model-message construction and complete-turn trimming |
| `src/lib/chat/dispatch.ts` | Streaming, abort/timeout outcomes, partial text, and usage |
| `src/lib/chat/chatController.ts` | Durable turn/attempt lifecycle and sidecar finalization |
| `src/lib/chat/operationCoordinator.ts` | One synchronous operation per session and stale-operation rejection |
| `src/state/composerStore.ts` | Composer drafts keyed by session ID |
| `src/state/sessionsStore.ts` | Session selection, stale-load protection, and current messages |
| `src/state/settingsStore.ts` | Non-secret settings and in-memory hydrated credentials |
| `src/lib/security/credentialStore.ts` | Tauri OS keychain and encrypted web fallback |
| `src/lib/security/redact.ts` | Provider/filesystem error redaction and size caps |
| `src/lib/limits.ts` | Shared input, output, timeout, and archive limits |
| `src/lib/markdown/sink.ts` | Backend-neutral file contract including delete and rename |
| `src/lib/markdown/tauriSink.ts` | Scoped cross-platform Tauri path resolution |
| `src/lib/markdown/writer.ts` | Locked, atomic archive commits and manifest generation |
| `src/lib/markdown/parser.ts` | Validated archive parsing and recovery reports |
| `src/lib/sessionDeletion.ts` | Coordinated disk tombstone, database deletion, and archive removal |
| `src/lib/providers/registry.ts` | Model metadata, shared headers, and complete cost calculation |
| `src/lib/providers/keyTest.ts` | One-shot key tests with the same headers as chat |
| `src/lib/usage/aggregate.ts` | Unknown-cost preservation and provider grouping |
| `src/lib/desktop/bootstrap.ts` and `src/main.tsx` | Awaited initialization and recovery gate |
| `src/features/chat/ChatScreen.tsx`, `src/features/chat/Composer.tsx`, `src/features/chat/ResultCard.tsx`, `src/features/chat/SummaryCard.tsx`, and `src/features/chat/Markdown.tsx` | Session-scoped orchestration, accessible result cards, and safe Markdown |
| `src/features/sessions/Sidebar.tsx` | Keyboard-operable session navigation and responsive layout |
| `src/features/settings/SettingsScreen.tsx` and `src/features/settings/ProviderKeyCard.tsx` | Dialog semantics, explicit credential flow, and validated provider/model pair |
| `src/styles/globals.css` and `src/components/ui/dialog.tsx` | Dark tokens, contrast, focus-safe dialogs, and reduced motion |
| `src-tauri/capabilities/default.json` | Correct `$DOCUMENT` scope and fs operations |
| `src-tauri/src/lib.rs` and `src-tauri/src/credentials.rs` | Registered native commands and OS keychain |
| `src-tauri/src/path_policy.rs` | Testable native path containment |
| `package.json`, `vite.config.ts`, `tsconfig.json`, and `tsconfig.node.json` | Complete typecheck, path resolution, and release scripts |
| `.github/workflows/ci.yml`, `playwright.config.ts`, `e2e/app.spec.ts`, and `e2e/mock-provider.ts` | Repeatable web, Rust, Tauri, and E2E gates |
| `docs/reviews/2026-09-24-shura-app-review.md`, `docs/adr/0001-session-context-and-persistence.md`, `README.md`, and `docs/environment.md` | Evidence, decisions, setup, security, and limitations |
| `src/test/helpers.ts` | Shared deterministic fixtures used by the new tests |

## Test fixture contract

Create `src/test/helpers.ts` in Task 1 and import these helpers in the focused specs. The helpers keep test examples complete instead of relying on undocumented global fixtures:

```ts
import type {
  BuiltPrompt, ChatMessage, ModelInfo, SessionMeta, TargetConfig,
  TargetSnapshot, TurnAttempt, Usage, UsageEvent,
} from "@/types";
import { memoryFileSink, type FileSink } from "@/lib/markdown/sink";
import type { TurnFileData } from "@/lib/markdown/writer";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function oldSession(id: string): SessionMeta {
  return {
    id, title: "جلسة", createdAt: 1, updatedAt: 1,
    modelIds: [], primaryTarget: null, layoutMode: "vertical", onDisk: false,
    contextMode: "stateful", targets: [],
  };
}

export const meta = oldSession;
export const target: TargetConfig = {
  targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o",
  modelInfo: { id: "openai/gpt-4o", label: "GPT-4o", contextLength: 128000 },
};
export const modelInfo = target.modelInfo;

export function message(sessionId: string): ChatMessage {
  return {
    id: "m-" + sessionId, sessionId, turnId: "turn-1", createdAt: 1,
    role: "assistant", kind: "result", text: "result", status: "done",
    providerId: "openrouter", modelId: "openai/gpt-4o", targetId: "t1",
    attemptId: "attempt-1", operationId: "op-1", attempt: 1, superseded: false,
  };
}
export function user(text: string): ChatMessage {
  return { id: "u-" + text, sessionId: "s1", turnId: "turn-1", createdAt: 1,
    role: "user", kind: "prompt", text, promptKind: "shared", status: "done" };
}
export function assistant(text: string): ChatMessage {
  return { ...message("s1"), id: "a-" + text, text, createdAt: 2 };
}
export function prompt(targetId: string): BuiltPrompt {
  return { targetId, providerId: "openrouter", modelId: "openai/gpt-4o",
    text: "سؤال", hasShared: true, hasCustom: false };
}
export function failingAfter(failAt: number, base: FileSink = memoryFileSink()): FileSink {
  let writes = 0;
  return { ...base, async writeFile(path, content) {
    writes += 1;
    if (writes === failAt) throw new Error(" simulated disk failure ");
    return base.writeFile(path, content);
  } };
}
export function turnData(): TurnFileData {
  const usage: Usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, costUSD: 0 };
  return {
    turn: { id: "turn-1", sharedPrompt: "سؤال", customs: {} },
    prompts: [{ targetId: "t1", providerId: "openrouter", modelId: "openai/gpt-4o", text: "سؤال", hasShared: true, hasCustom: false }],
    results: [{ targetId: "t1", text: "جواب", usage }],
    status: { t1: "done" }, errors: {}, createdAt: 1,
  };
}
export function persistedAttempt(customPrompt: string): TurnAttempt {
  const snapshot: TargetSnapshot = {
    ...target, sharedPrompt: "سؤال", customPrompt,
    promptText: "سؤال", hasShared: true, hasCustom: true,
  };
  return { id: "attempt-1", turnId: "turn-1", attempt: 1, kind: "retry",
    createdAt: 1, status: "error", targets: [snapshot] };
}
export function writeTombstone(sink: FileSink, id: string): Promise<void> {
  return sink.writeFile("sessions/tombstones/" + id + ".json", JSON.stringify({ id, deletedAt: 1 }));
}
export function event(overrides: Partial<UsageEvent>): UsageEvent {
  return {
    id: "usage-1", sessionId: "s1", turnId: "turn-1", ts: 1,
    attemptId: "attempt-1", providerId: "openrouter", modelId: "openai/gpt-4o",
    inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0,
    costUSD: 1, toolCalls: 0, durationMs: 1, status: "ok", ...overrides,
  };
}
export function model(overrides: Partial<ModelInfo>): ModelInfo {
  return { id: "model-1", label: "Model 1", contextLength: 128000, ...overrides };
}
```

New specs import only the symbols they use from these existing modules: `vi`, `beforeEach`, and `afterEach` from `vitest`; `render`, `screen`, and `waitFor` from `@testing-library/react`; `userEvent` from `@testing-library/user-event`; the affected Zustand stores; and the production function under test. The fixture module above supplies all domain factories. No test may read or write a real user database or provider account.

---

## Task 1: Establish durable domain contracts and a Dexie migration

**Files:**
- Modify: `src/types/index.ts:1-55`
- Modify: `src/lib/db/db.ts:4-18`
- Modify: `src/lib/db/repos.ts:1-51`
- Create: `src/lib/db/migration.spec.ts`
- Modify: `src/lib/db/repos.spec.ts`
- Create: `src/test/helpers.ts`
- Create: `docs/adr/0001-session-context-and-persistence.md`

- [ ] **Step 1: Write the failing migration and tombstone tests**

Add tests that prove old rows survive an upgrade and a deleted session cannot be imported again. The migration spec imports `Dexie` from `dexie` and `ShuraDB`/repository functions from the production modules:

```ts
it("adds turns and tombstones without removing existing sessions", async () => {
  const legacy = new Dexie("shura-migration-test");
  legacy.version(1).stores({
    sessions: "id, updatedAt",
    messages: "id, sessionId, [sessionId+turnId], createdAt",
    usage_events: "id, sessionId, ts, providerId",
    settings: "key",
  });
  await legacy.table("sessions").put(oldSession("s1"));
  await legacy.close();
  const upgraded = new ShuraDB("shura-migration-test");
  await upgraded.open();
  expect(await upgraded.sessions.get("s1")).toBeTruthy();
  expect(upgraded.turns).toBeDefined();
  expect(upgraded.tombstones).toBeDefined();
  await upgraded.close();
});

it("keeps a tombstone after deleting a session", async () => {
  await createSession(meta("s2"));
  await deleteSessionData("s2");
  expect(await hasTombstone("s2")).toBe(true);
  expect(await importSessionAtomically(meta("s2"), [], [], [])).toBe("tombstoned");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm test -- src/lib/db/repos.spec.ts src/lib/db/migration.spec.ts`

Expected: **FAIL** because version 2 tables and transactional functions do not exist.

- [ ] **Step 3: Add the shared contracts**

Use these types in every later task:

```ts
export type ContextMode = "stateful" | "stateless";
export type TurnStatus = "pending" | "streaming" | "done" | "stopped" | "error";

export interface TargetConfig {
  targetId: string;
  providerId: ProviderId;
  modelId: string;
  modelInfo: ModelInfo;
}

export interface TargetSnapshot extends TargetConfig {
  sharedPrompt: string | null;
  customPrompt: string | null;
  promptText: string;
  hasShared: boolean;
  hasCustom: boolean;
}

export interface TurnAttempt {
  id: string;
  turnId: string;
  attempt: number;
  kind: "send" | "retry" | "summary";
  createdAt: number;
  status: TurnStatus;
  targets: TargetSnapshot[];
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  createdAt: number;
  status: TurnStatus;
  contextMode: ContextMode;
  sharedPrompt: string | null;
  attempts: TurnAttempt[];
}

export interface SessionTombstone { id: string; deletedAt: number; }
```

Add `contextMode: ContextMode` and `targets: TargetConfig[]` to `SessionMeta`, retaining `modelIds` for old archive compatibility. Make the new `ChatMessage` fields (`attemptId`, `operationId`, `attempt`, and `superseded`) and `UsageEvent.attemptId` optional only for legacy rows; every newly-created record populates them. New sessions use stateful mode and an empty target list. Add `cacheWriteInputTokens: number` to new `Usage` and `UsageEvent` rows, defaulting legacy rows to `0` during migration.

- [ ] **Step 4: Add Dexie version 2 and a non-destructive upgrade**

Keep version 1 and add:

```ts
export class ShuraDB extends Dexie {
  // The optional name is only for isolated migration tests; production uses "shura".
  constructor(name = "shura") {
    super(name);
    this.version(1).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
    });
    this.version(2).stores({
      sessions: "id, updatedAt",
      messages: "id, sessionId, [sessionId+turnId], createdAt",
      usage_events: "id, sessionId, ts, providerId",
      settings: "key",
      turns: "id, sessionId, createdAt, status",
      tombstones: "id, deletedAt",
    }).upgrade(async (tx) => {
      const sessions = tx.table<SessionMeta, string>("sessions");
      const usage = tx.table<UsageEvent, string>("usage_events");
      for (const session of await sessions.toArray()) {
        session.contextMode ??= "stateful";
        session.targets ??= [];
        await sessions.put(session);
      }
      for (const event of await usage.toArray()) {
        event.cacheWriteInputTokens ??= 0;
        await usage.put(event);
      }
    });
  }
}
```

- [ ] **Step 5: Add repository operations**

Implement these repository contracts and keep the existing CRUD functions:

```ts
export type ImportSessionResult = "imported" | "tombstoned";
export async function deleteSessionData(id: string): Promise<void>;
export async function hasTombstone(id: string): Promise<boolean>;
export async function putTurn(turn: TurnRecord): Promise<void>;
export async function getTurn(id: string): Promise<TurnRecord | undefined>;
export async function getTurns(sessionId: string): Promise<TurnRecord[]>;
export async function importSessionAtomically(
  meta: SessionMeta, messages: ChatMessage[], turns: TurnRecord[], usageEvents: UsageEvent[],
): Promise<ImportSessionResult>;
```

`deleteSessionData` must put a tombstone and delete session, message, usage, and turn rows in one transaction. `importSessionAtomically` must check the tombstone inside that same transaction before writing any row. Existing CRUD functions remain compatible.

- [ ] **Step 6: Update fixtures and record the migration**

Update all test factories with the new fields and clear `db.turns` and `db.tombstones` in each repository test's `beforeEach`; close and delete the uniquely named migration database in `afterEach`. Create the ADR with these fixed decisions: stateful mode is the default; old `modelIds` remain readable; old sessions without provider-qualified targets open with no targets; `turns` and `tombstones` are additive; no database is reset; the archive is the recovery source.

Run: `pnpm test -- src/lib/db/repos.spec.ts src/lib/db/migration.spec.ts && pnpm typecheck`

Expected: **PASS**.

- [ ] **Step 7: Commit**

`git add src/types/index.ts src/lib/db/db.ts src/lib/db/repos.ts src/lib/db/repos.spec.ts src/lib/db/migration.spec.ts src/test/helpers.ts docs/adr/0001-session-context-and-persistence.md && git commit -m "feat: add session turn records and deletion tombstones"`

**Acceptance criteria:** Existing rows survive; deletion and recovery are idempotent; no test needs a real provider or a new user database.

---

## Task 2: Correct Tauri scope and make the filesystem backend portable

**Files:**
- Modify: `src-tauri/capabilities/default.json:18-24`
- Modify: `src/lib/markdown/sink.ts:1-43`
- Modify: `src/lib/markdown/tauriSink.ts:1-75`
- Create: `src/lib/markdown/tauriSink.spec.ts`
- Create: `src-tauri/src/path_policy.rs`
- Modify: `src-tauri/src/lib.rs` if required by the module layout

- [ ] **Step 1: Write failing scope and path tests**

```ts
it("uses Tauri's singular document scope", () => {
  const capability = JSON.parse(readFileSync("src-tauri/capabilities/default.json", "utf8"));
  const serialized = JSON.stringify(capability);
  expect(serialized).toContain("$DOCUMENT/Shura/**");
  expect(serialized).not.toContain("$DOCUMENTS/Shura/**");
});

it("joins a relative path without replacing POSIX separators", async () => {
  vi.mocked(join).mockResolvedValue("/home/user/Documents/Shura/sessions/s1");
  await tauriFileSink().writeFile("sessions/s1/meta.json", "{}");
  expect(join).toHaveBeenCalledWith("/home/user/Documents/Shura", "sessions/s1/meta.json");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- src/lib/markdown/tauriSink.spec.ts`

Expected: **FAIL** because the current capability uses `$DOCUMENTS` and the sink converts every slash to a backslash.

- [ ] **Step 3: Fix capabilities and required permissions**

Change both existing scopes to `$DOCUMENT/Shura/**`. Add `fs:allow-remove`, `fs:allow-rename`, `fs:allow-read-text-file`, and `fs:allow-read-dir`, each scoped to `$DOCUMENT/Shura/**`. Validate the generated Tauri schema before proceeding. Do not widen the scope.

- [ ] **Step 4: Extend the sink contract**

```ts
export interface FileSink {
  ensureDir(path: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  readDir(path: string): Promise<string[]>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}
```

Implement memory and Tauri remove/rename operations. The Tauri implementation uses the scoped path resolver for both paths and maps plugin errors through `wrapSinkError`:

```ts
import { mkdir, readDir, readFile, remove as removePath, rename as renamePath, writeTextFile } from "@tauri-apps/plugin-fs";

async remove(p: string, options?: { recursive?: boolean }): Promise<void> {
  const rp = await resolvePath(p);
  try { await removePath(rp, { recursive: options?.recursive ?? false }); }
  catch (error) { throw wrapSinkError(rp, error); }
}
async rename(oldPath: string, newPath: string): Promise<void> {
  const oldRp = await resolvePath(oldPath);
  const newRp = await resolvePath(newPath);
  try { await renamePath(oldRp, newRp); }
  catch (error) { throw wrapSinkError(newRp, error); }
}
```

Keep these methods inside the returned `FileSink` object.

- [ ] **Step 5: Use Tauri path APIs and enforce containment**

Import `isAbsolute` and `join` from `@tauri-apps/api/path`. Resolve relative paths with `join(await desktopRoot(), p)`, normalize absolute paths, and reject `..` segments or a normalized path outside the desktop root. Never replace slashes with backslashes. Keep error codes but redact absolute paths before UI persistence.

- [ ] **Step 6: Add Rust path-policy tests**

Implement the native containment helper and test it without touching the user filesystem:

```rust
use std::path::{Component, Path, PathBuf};

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => { normalized.pop(); }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

pub fn is_within_root(root: &Path, candidate: &Path) -> bool {
    let root = lexical_normalize(root);
    let candidate = lexical_normalize(candidate);
    candidate == root || candidate.starts_with(&root)
}

#[cfg(test)]
mod tests {
    use super::is_within_root;
    use std::path::Path;
    #[test]
    fn child_is_allowed_and_sibling_prefix_is_not() {
        assert!(is_within_root(Path::new("/root"), Path::new("/root/session")));
        assert!(!is_within_root(Path::new("/root"), Path::new("/rootish/session")));
    }
    #[test]
    fn traversal_is_rejected() {
        assert!(!is_within_root(Path::new("/root"), Path::new("/root/../other")));
    }
    #[cfg(windows)]
    #[test]
    fn windows_separators_are_checked() {
        assert!(is_within_root(Path::new(r"C:\root"), Path::new(r"C:\root\session")));
    }
}
```

Run `cargo test --locked --manifest-path src-tauri/Cargo.toml` and require at least one native test to execute.

- [ ] **Step 7: Run checks and commit**

Run:

```powershell
pnpm test -- src/lib/markdown/tauriSink.spec.ts src/lib/markdown/writer.spec.ts src/lib/markdown/parser.spec.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

Expected: **PASS**. Commit with `git commit -m "fix: authorize portable Shura archive paths"`.

**Acceptance criteria:** Packaged writes are authorized only under the Shura directory; POSIX/Windows tests pass; scoped delete and rename are available.

---

## Task 3: Isolate composer state and protect session switching

**Files:**
- Modify: `src/state/composerStore.ts`
- Modify: `src/state/sessionsStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `src/features/chat/Composer.tsx`
- Create: `src/state/sessionScopedState.spec.ts`

- [ ] **Step 1: Write failing cross-session tests**

```ts
it("does not expose A's draft in B", () => {
  useComposerStore.getState().setDraft("session-a", { sharedPrompt: "سؤال A", targets: [target] });
  expect(useComposerStore.getState().getDraft("session-b").sharedPrompt).toBe("");
});

it("discards a message load that lost the open-generation race", async () => {
  const first = deferred<ChatMessage[]>();
  const second = deferred<ChatMessage[]>();
  vi.spyOn(repos, "getMessages")
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const openA = useSessionsStore.getState().open("a");
  const openB = useSessionsStore.getState().open("b");
  second.resolve([message("b")]);
  await openB;
  first.resolve([message("a")]);
  await openA;
  expect(useSessionsStore.getState().currentId).toBe("b");
  expect(useSessionsStore.getState().messages).toEqual([message("b")]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- src/state/sessionScopedState.spec.ts`

Expected: **FAIL** because the current store has one global draft and `open` has no generation guard.

- [ ] **Step 3: Store complete drafts per session**

Use this exact store contract so every action has a session identity:

```ts
export interface ComposerDraft {
  targets: TargetConfig[];
  syncMode: boolean;
  sharedPrompt: string;
  customs: Record<string, string>;
  focusTargetId: string | null;
}
export interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  getDraft(sessionId: string): ComposerDraft;
  setDraft(sessionId: string, patch: Partial<ComposerDraft>): void;
  addTarget(sessionId: string, target: Omit<TargetConfig, "targetId">): void;
  removeTarget(sessionId: string, targetId: string): void;
  setShared(sessionId: string, text: string): void;
  setCustom(sessionId: string, targetId: string, text: string): void;
  setSyncMode(sessionId: string, value: boolean): void;
  setFocus(sessionId: string, targetId: string | null): void;
  clearSession(sessionId: string): void;
}
```

`getDraft` returns a fresh empty object for an unknown session and never copies another session's values. Persist selected target metadata in `SessionMeta.targets`.

- [ ] **Step 4: Guard session loads and operations**

Add `loading`, `loadGeneration`, and `openGeneration` to the sessions store. Increment the generation synchronously at the start of `open`, `newSession`, and `remove`. Commit `getMessages` only if the generation and requested ID still match. Clear the deleted session's draft.

- [ ] **Step 5: Bind React to the session ID**

Remount `ChatScreen` with `key={currentSession.id}`. Pass `session.id` into every composer selector/action. Remove all unscoped store reads. Persist a late callback only when its session and operation identity still match.

Run: `pnpm test -- src/state/sessionScopedState.spec.ts src/state/composerStore.spec.ts src/features/chat/ChatScreen.spec.tsx`

Expected: **PASS**.

Commit: `git commit -m "fix: scope composer and message state to sessions"`.

**Acceptance criteria:** A's draft, targets, and deltas are invisible in B; stale async loads cannot replace B; every state action has an explicit session ID.

---

## Task 4: Implement stateful context and model-aware limits

**Files:**
- Create: `src/lib/chat/context.ts`
- Modify: `src/lib/chat/dispatch.ts`
- Modify: `src/lib/chat/chatController.ts`
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `src/features/chat/ContextMeter.tsx`
- Create: `src/lib/chat/context.spec.ts`
- Modify: `src/lib/chat/dispatch.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-05-shura-app-design.md` and `README.md`

- [ ] **Step 1: Write failing context tests**

```ts
it("includes prior completed turns in stateful mode", () => {
  expect(buildContextMessages(
    [user("u1"), assistant("a1")], "follow-up", "stateful", 10000,
  )).toEqual([
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "follow-up" },
  ]);
});

it("sends only the current prompt in stateless mode", () => {
  expect(buildContextMessages(
    [user("u1"), assistant("a1")], "compare", "stateless", 10000,
  )).toEqual([{ role: "user", content: "compare" }]);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/chat/context.spec.ts`

Expected: **FAIL** because the context builder does not exist.

- [ ] **Step 3: Implement complete-turn trimming**

`buildContextMessages` must:

1. Keep only non-empty done messages from the requested session.
2. Exclude current placeholders, streaming rows, and error rows.
3. Group user/assistant rows by `turnId` and remove the oldest complete turn until estimated input is at most 80% of the model context.
4. Always append the current user prompt as the final message.
5. Throw before provider dispatch if the current prompt alone exceeds the limit.
6. Return AI SDK `ModelMessage` objects with text content.

Use persisted `modelInfo.contextLength`; use a displayed unknown value rather than a fabricated exact percentage when metadata is absent.

Implement the builder with a stable complete-turn order and the same 80% budget used by dispatch:

```ts
import type { ModelMessage } from "ai";
import type { ChatMessage, ContextMode } from "@/types";

type TextRow = { text: string };
export function buildContextMessages(
  history: readonly ChatMessage[], currentPrompt: string, mode: ContextMode, contextLength: number,
): ModelMessage[] {
  if (!Number.isFinite(contextLength) || contextLength <= 0) throw new Error("حد السياق غير صالح");
  const estimate = (rows: readonly TextRow[]): number =>
    Math.ceil(rows.reduce((sum, row) => sum + [...row.text].length, 0) / 4);
  const current: ModelMessage = { role: "user", content: currentPrompt };
  if (estimate([current]) > contextLength * 0.8) throw new Error("السؤال الحالي يتجاوز حد السياق الآمن");
  if (mode === "stateless") return [current];

  const groups = new Map<string, ChatMessage[]>();
  for (const row of history) {
    if (row.superseded || row.status !== "done" || !row.text.trim()) continue;
    const group = groups.get(row.turnId) ?? [];
    group.push(row);
    groups.set(row.turnId, group);
  }
  const complete = [...groups.values()]
    .filter((rows) => rows.some((row) => row.role === "user") && rows.some((row) => row.role === "assistant"))
    .sort((a, b) => Math.min(...a.map((row) => row.createdAt)) - Math.min(...b.map((row) => row.createdAt)));
  while (complete.length > 0) {
    const rows: TextRow[] = complete.flat().map((row) => ({ text: row.text }));
    if (estimate([...rows, { text: currentPrompt }]) <= contextLength * 0.8) break;
    complete.shift();
  }
  return [...complete.flat().map((row) => ({ role: row.role, content: row.text })), current];
}
```

- [ ] **Step 4: Pass messages to streamText**

Add these fields to `DispatchArgs`; every callback is bound to the operation identity so a late provider chunk cannot mutate another session:

```ts
export interface DispatchArgs {
  operationId: string;
  sessionId: string;
  turnId: string;
  prompts: readonly BuiltPrompt[];
  apiKeyFor(providerId: ProviderId): string;
  sessionHeaderFor(providerId: ProviderId): Record<string, string> | undefined;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  externalSignalFor?(targetId: string): AbortSignal | undefined;
  contextMode: ContextMode;
  historyFor(targetId: string): readonly ChatMessage[];
  modelInfoFor(targetId: string): ModelInfo;
  onUpdate?(operationId: string, targetId: string, chunk: string): void;
  onStatus?(operationId: string, targetId: string, status: TurnStatus, error?: string): void;
}
```

The call must use:

```ts
const modelInfo = args.modelInfoFor(p.targetId);
const history = args.historyFor(p.targetId).filter((row) => row.sessionId === args.sessionId);
const modelMessages = buildContextMessages(
  history, p.text, args.contextMode,
  modelInfo.contextLength ?? 128000,
);
let rawError: unknown;
const result = streamText({
  model,
  messages: modelMessages,
  abortSignal: ac.signal,
  onError: ({ error }) => { if (rawError === undefined) rawError = error; },
});
```

Do not pass `prompt` and `messages` together. Persist the mode and target snapshots in the turn record so retry uses identical semantics.

- [ ] **Step 5: Make the meter match dispatch**

Pass the selected target's context length and current mode to `ContextMeter`. Show “مقارنة stateless” only when selected. Update design/README after the tests prove the behavior.

Run: `pnpm test -- src/lib/chat/context.spec.ts src/lib/chat/dispatch.spec.ts src/features/chat/ChatScreen.spec.tsx && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "feat: send session context according to the selected mode"`.

**Acceptance criteria:** Stateful sessions send prior completed turns; stateless sessions do not; trimming never drops the current prompt; the meter uses the dispatch limit.

---

## Task 5: Preserve partial streams and classify terminal outcomes

**Files:**
- Modify: `src/lib/chat/dispatch.ts`
- Modify: `src/lib/chat/chatController.ts`
- Modify: `src/features/chat/ResultCard.tsx`
- Modify: `src/features/chat/SummaryCard.tsx`
- Create: `src/lib/chat/partialStreaming.spec.ts`
- Modify: `src/lib/chat/dispatch.spec.ts`

- [ ] **Step 1: Write the failing abort test**

```ts
it("retains text emitted before user abort", async () => {
  const controller = new AbortController();
  const updates: string[] = [];
  const pending = dispatchTurn({
    operationId: "op-1", sessionId: "s1", turnId: "t1",
    prompts: [prompt("t1")], apiKeyFor: () => "test-key",
    sessionHeaderFor: () => undefined, historyFor: () => [],
    contextMode: "stateful", modelInfoFor: () => modelInfo,
    externalSignalFor: () => controller.signal,
    onUpdate: (_operationId, _targetId, chunk) => updates.push(chunk),
  });
  await waitFor(() => expect(updates).toEqual(["بداية"]));
  controller.abort(new Error("ألغي بواسطة المستخدم"));
  const [outcome] = await pending;
  expect(outcome.status).toBe("stopped");
  expect(outcome.text).toBe("بداية");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/chat/partialStreaming.spec.ts src/lib/chat/dispatch.spec.ts`

Expected: **FAIL** because the current abort race returns empty text and maps abort to error.

- [ ] **Step 3: Add the terminal outcome contract**

```ts
export interface DispatchOutcome {
  targetId: string;
  operationId: string;
  status: "done" | "stopped" | "error";
  text: string;
  error?: string;
  usage?: Usage;
  ms: number;
  finishReason?: string;
}
```

Keep one shared text accumulator outside the abort race. User abort resolves stopped with accumulated text; timeout resolves error with accumulated text; provider failure after chunks resolves error with accumulated text. A missing finish reason is not success unless the SDK reports a successful finish; preserve the named benign compatibility test.

- [ ] **Step 4: Persist checkpoints and terminal text**

Create placeholders with the attempt ID, checkpoint at least every 250 ms or 512 new characters, and always write the final text/status. Ignore callbacks from another operation ID. Archive exactly the same terminal text/status written to Dexie.

- [ ] **Step 5: Render accessible terminal states**

Use polite live regions for streaming/status text, render stopped text, show a visible sidecar warning, and catch clipboard rejection with a toast. A stopped result is never rendered as an error.

Run: `pnpm test -- src/lib/chat/partialStreaming.spec.ts src/lib/chat/dispatch.spec.ts src/lib/chat/chatController.spec.ts src/features/chat/ResultCard.spec.tsx && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "fix: persist partial streams and terminal outcomes"`.

**Acceptance criteria:** Stop, timeout, provider error, and reload preserve partial text; no card remains streaming after a terminal outcome; sidecar failure cannot erase content.

---

## Task 6: Serialize operations and make retries immutable

**Files:**
- Create: `src/lib/chat/operationCoordinator.ts`
- Modify: `src/features/chat/ChatScreen.tsx`
- Modify: `src/lib/chat/chatController.ts`
- Modify: `src/lib/chat/synthesis.ts`
- Modify: `src/lib/db/repos.ts`
- Create: `src/lib/chat/operationCoordinator.spec.ts`
- Modify: `src/features/chat/ChatScreen.spec.tsx`

- [ ] **Step 1: Write failing concurrency and retry tests**

```ts
it("rejects a second operation synchronously", () => {
  const coordinator = new SessionOperationCoordinator();
  const first = coordinator.start("s1", "send", new AbortController());
  expect(first).not.toBeNull();
  expect(coordinator.start("s1", "retry", new AbortController())).toBeNull();
});

it("retries the persisted custom prompt instead of the current draft", () => {
  const attempt = persistedAttempt("سؤال المحفوظ");
  useComposerStore.getState().setCustom("s1", "t1", "سؤال مختلف");
  expect(buildRetryInput(attempt).targets[0].customPrompt).toBe("سؤال المحفوظ");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/chat/operationCoordinator.spec.ts src/features/chat/ChatScreen.spec.tsx`

Expected: **FAIL** because there is no coordinator or persisted attempt lookup.

- [ ] **Step 3: Implement the coordinator**

```ts
import { newId } from "@/lib/id";
import type { TurnAttempt, TargetSnapshot } from "@/types";

export type OperationKind = "send" | "retry" | "summary";
export interface OperationHandle {
  id: string;
  sessionId: string;
  kind: OperationKind;
  controller: AbortController;
}
export class SessionOperationCoordinator {
  private readonly active = new Map<string, OperationHandle>();

  start(sessionId: string, kind: OperationKind, controller: AbortController): OperationHandle | null {
    if (this.active.has(sessionId)) return null;
    const handle: OperationHandle = { id: newId("op"), sessionId, kind, controller };
    this.active.set(sessionId, handle);
    return handle;
  }
  activeFor(sessionId: string): OperationHandle | null { return this.active.get(sessionId) ?? null; }
  isActive(sessionId: string): boolean { return this.active.has(sessionId); }
  cancel(sessionId: string): void {
    const handle = this.active.get(sessionId);
    if (!handle) return;
    handle.controller.abort(new Error("أُلغي العملية"));
    this.active.delete(sessionId);
  }
  finish(operationId: string): void {
    for (const [sessionId, handle] of this.active) {
      if (handle.id === operationId) { this.active.delete(sessionId); return; }
    }
  }
  accepts(operationId: string, sessionId: string): boolean {
    return this.active.get(sessionId)?.id === operationId;
  }
}

export function buildRetryInput(attempt: TurnAttempt): { targets: TargetSnapshot[] } {
  return { targets: attempt.targets.map((target) => ({ ...target })) };
}
```

`start` synchronously rejects a second operation for the same session. ChatScreen uses the coordinator as the source of truth and disables send, retry, and summary while active. Finish only the matching operation ID.

- [ ] **Step 4: Persist attempts before provider calls**

For every send/retry/summary: build immutable `TargetSnapshot` values, create a `TurnAttempt` with a monotonically increasing attempt number, put it before placeholders/provider calls, pass its ID to callbacks/archive, and mark the prior attempt superseded only after the new placeholder is durable. Retry reads the original snapshot and never the current composer draft.

- [ ] **Step 5: Isolate sidecar finalization**

Use `Promise.allSettled` for usage, message finalization, and archive. Attempt primary text first. A failed usage row adds a warning but never replaces text with an empty error. A failed archive never deletes the Dexie result.

- [ ] **Step 6: Reconcile interrupted turns at startup**

Mark every persisted streaming turn with no live operation as stopped, keep its current text, and set a bounded error string. Run reconciliation after bootstrap and before opening the first session.

Run: `pnpm test -- src/lib/chat/operationCoordinator.spec.ts src/lib/chat/chatController.spec.ts src/features/chat/ChatScreen.spec.tsx`

Expected: **PASS**.

Commit: `git commit -m "fix: serialize chat operations and preserve retry attempts"`.

**Acceptance criteria:** One operation per session; every callback is bound to session/operation/attempt identity; retry prompts remain stable after reload.

---

## Task 7: Make archives atomic, recoverable, and permanently deletable

**Files:**
- Modify: `src/lib/markdown/writer.ts`
- Modify: `src/lib/markdown/parser.ts`
- Create: `src/lib/sessionDeletion.ts`
- Modify: `src/main.tsx`
- Modify: `src/lib/desktop/bootstrap.ts`
- Modify: `src/lib/db/repos.ts`
- Modify: `src/lib/markdown/writer.spec.ts`
- Modify: `src/lib/markdown/parser.spec.ts`
- Create: `src/lib/sessionDeletion.spec.ts`
- Create: `src/lib/recovery.spec.ts`

- [ ] **Step 1: Write failing atomicity and deletion tests**

```ts
it("does not publish a turn when a result file fails", async () => {
  const sink = failingAfter(2);
  const dir = "sessions/s1";
  const meta = oldSession("s1");
  await expect(appendTurn(sink, dir, meta, turnData())).rejects.toThrow();
  expect(await sink.exists(dir + "/meta.json")).toBe(false);
});

it("does not resurrect a tombstoned archive", async () => {
  const sink = memoryFileSink();
  await writeTombstone(sink, "s1");
  const report = await recoverFromDisk(sink, "sessions");
  expect(report.imported).toHaveLength(0);
  expect(report.skippedTombstoned).toContain("s1");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/markdown/writer.spec.ts src/lib/markdown/parser.spec.ts src/lib/sessionDeletion.spec.ts src/lib/recovery.spec.ts`

Expected: **FAIL** because the current writer publishes files separately and the parser silently skips errors.

- [ ] **Step 3: Write a versioned manifest**

Use:

```ts
export interface ArchiveResult {
  targetId: string;
  text: string;
  status: TurnStatus;
  error?: string;
  usage: Usage | null;
}
export interface ArchiveTurn {
  id: string;
  turnId: string;
  attemptId: string;
  dirName: string;
  prompts: TargetSnapshot[];
  results: ArchiveResult[];
  status: Record<string, TurnStatus>;
  errors: Record<string, string>;
  createdAt: number;
}
export interface ArchiveManifest {
  schemaVersion: 2;
  meta: SessionMeta;
  updatedAt: number;
  turns: ArchiveTurn[];
}
```

Each turn stores turn ID, attempt ID, immutable prompt snapshots, results, statuses, bounded redacted errors, usage, and creation time. Never store API keys, response bodies, or raw provider errors. The manifest is the commit marker: recovery imports only turns listed in the last valid `meta.json`; if `session.md` is missing or stale, regenerate it from that manifest rather than trusting the Markdown text. Accept the existing unversioned manifest as schema version 1, normalize its `modelIds` to empty `targets`, and write version 2 on the next commit without deleting the old folder.

- [ ] **Step 4: Serialize and publish atomically**

Keep a promise chain keyed by resolved session directory. For each attempt: create an attempt directory, write prompt/result files, build the next manifest, write `meta.json.tmp` and `session.md.tmp`, rename them, with `meta.json` renamed last, then update `onDisk`. A retry with the same attempt ID is idempotent. Failed temporary files are cleaned when possible; the previous valid manifest remains readable.

- [ ] **Step 5: Validate and quarantine malformed archives**

Extend the existing `RestoredSession` result so recovery can import the new turn table without losing archive data:

```ts
export interface RestoredSession {
  meta: SessionMeta;
  messages: ChatMessage[];
  usageEvents: UsageEvent[];
  turns: TurnRecord[];
}
```

Return this report instead of silently swallowing errors:

```ts
export interface RecoveryReport {
  imported: RestoredSession[];
  quarantined: { dir: string; reason: string }[];
  skippedTombstoned: string[];
  errors: string[];
}
```

Populate `RestoredSession.turns` by converting each manifest turn and attempt without losing IDs, snapshots, status, or usage. Reject missing IDs, invalid statuses, non-array turns, and non-finite timestamps. `recoverFromDisk(sink, rootDir)` must ignore the reserved `tombstones` directory, read its tombstone IDs, and never import a matching session. Rename malformed folders to a scoped `quarantine/<folder>-<timestamp>` path; if rename fails, leave the original and report a redacted reason. Change all callers from iterating a `RestoredSession[]` to iterating `report.imported`, and surface `report.errors` without hiding them.

- [ ] **Step 6: Gate rendering on initialization**

Move initialization before `createRoot` in `main.tsx`. Mount `App` only after settings, desktop bootstrap, migration, and recovery resolve. Render a dismissible warning for quarantined/error entries; do not claim success when the report contains errors.

- [ ] **Step 7: Coordinate durable deletion**

Implement this service order:

```ts
export interface DeleteSessionResult {
  deleted: boolean;
  warning?: string;
  retryable?: boolean;
}
export async function writeDiskTombstone(sink: FileSink, id: string): Promise<void> {
  const path = `sessions/tombstones/${id}.json`;
  const temp = path + ".tmp";
  await sink.ensureDir("sessions/tombstones");
  await sink.writeFile(temp, JSON.stringify({ id, deletedAt: Date.now() }));
  await sink.rename(temp, path);
}
export async function deleteSessionDurably(
  session: SessionMeta, sink: FileSink,
): Promise<DeleteSessionResult> {
  await writeDiskTombstone(sink, session.id);
  await deleteSessionData(session.id);
  if (!session.onDiskDir) return { deleted: true };
  try {
    await sink.remove(`sessions/${session.onDiskDir}`, { recursive: true });
    return { deleted: true };
  } catch (error) {
    return { deleted: true, warning: redactExternalError(error), retryable: true };
  }
}
```

If `deleteSessionData` fails after the disk tombstone is written, propagate a redacted error, keep the session visible, and expose retry; never remove the archive before the database transaction succeeds. If archive removal fails, retain the disk tombstone, return a warning, and expose retry. Recovery checks disk tombstones and Dexie tombstones. The visible session disappears only after the tombstone is durable.

Run: `pnpm test -- src/lib/markdown/writer.spec.ts src/lib/markdown/parser.spec.ts src/lib/sessionDeletion.spec.ts src/lib/recovery.spec.ts && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "feat: make archives recoverable and deletion durable"`.

**Acceptance criteria:** Manifest publication is serialized; startup recovery is observable; deleted archives cannot return after a simulated database reset.

---

## Task 8: Preserve live model metadata and calculate usage honestly

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/state/composerStore.ts`
- Modify: `src/features/chat/Composer.tsx`
- Modify: `src/lib/providers/registry.ts`
- Modify: `src/lib/providers/keyTest.ts`
- Modify: `src/features/chat/AddModelDialog.tsx`
- Modify: `src/features/settings/SettingsScreen.tsx`
- Modify: `src/lib/usage/aggregate.ts`
- Modify: `src/features/chat/ResultCard.tsx` and `SummaryCard.tsx`
- Create: `src/lib/providers/modelCatalog.spec.ts`
- Modify: `src/lib/providers/registry.spec.ts`, `src/lib/providers/keyTest.spec.ts`, `src/lib/usage/aggregate.spec.ts`, and `src/features/settings/SettingsScreen.spec.tsx`

- [ ] **Step 1: Write failing metadata, header, and cost tests**

```ts
it("uses cache-read pricing", () => {
  expect(computeCost(
    { inputTokens: 100, outputTokens: 20, cachedInputTokens: 80, cacheWriteInputTokens: 0 },
    model({ pricing: { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 } }),
  )).toBeCloseTo(0.000256);
});

it("keeps unknown aggregate cost unknown", () => {
  expect(summarize([event({ costUSD: null })]).costUSD).toBeNull();
});

it("sends the OpenCode session header during key testing", () => {
  expect(headersFor("opencodego", "s1")).toEqual({ "x-opencode-session": "s1" });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/providers/registry.spec.ts src/lib/providers/keyTest.spec.ts src/lib/providers/modelCatalog.spec.ts src/lib/usage/aggregate.spec.ts`

Expected: **FAIL** because cache pricing, catalog cancellation, shared headers, and null aggregate cost are absent.

- [ ] **Step 3: Persist validated model metadata**

Add `cacheReadPerMTok?: number` and `cacheWritePerMTok?: number` to `ModelPricing`. Persist the selected `ModelInfo` in `TargetConfig`. Accept only finite, non-negative live values. A failed catalog request keeps the static list and exposes a warning. Keep `Usage.cacheWriteInputTokens` and `UsageEvent.cacheWriteInputTokens` at zero for providers that do not report cache writes; never infer a zero cost for an unknown cache-write price.

- [ ] **Step 4: Make discovery cancellable and stale-safe**

Move the request into `fetchModelCatalog(providerId, signal)`. Use one controller per provider selection, `AbortSignal.timeout(10_000)`, and a request generation. Ignore responses from older generations and abort on dialog close. Pass the full model metadata to `addTarget`.

- [ ] **Step 5: Centralize headers and key tests**

Add this single header builder and use it in `buildLanguageModel`, normal dispatch, and `testProviderKey`:

```ts
export function headersFor(providerId: ProviderId, sessionId?: string): Record<string, string> {
  const provider = getProvider(providerId);
  const headers = { ...(provider.defaultHeaders ?? {}) };
  if (provider.id === "opencodego" && sessionId) headers[provider.sessionHeaderName!] = sessionId;
  return headers;
}
```

The key-test function signature becomes `testProviderKey(providerId, apiKey, modelId, sessionId?)`; it sends the same OpenCode header as chat and never logs the key.

- [ ] **Step 6: Make cost null-safe**

Use:

```ts
const cacheWriteInput = Math.max(0, usage.cacheWriteInputTokens);
const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedInputTokens - cacheWriteInput);
if (usage.cachedInputTokens > 0 && pricing.cacheReadPerMTok === undefined) return null;
if (cacheWriteInput > 0 && pricing.cacheWritePerMTok === undefined) return null;
const cacheReadRate = pricing.cacheReadPerMTok ?? 0;
const cacheWriteRate = pricing.cacheWritePerMTok ?? 0;
return (uncachedInput / 1e6) * pricing.inputPerMTok
  + (usage.cachedInputTokens / 1e6) * cacheReadRate
  + (cacheWriteInput / 1e6) * cacheWriteRate
  + (usage.outputTokens / 1e6) * pricing.outputPerMTok;
```

Change `UsageSummary.costUSD` to `number | null`. Initialize it to `null`, collect included event costs, and set it to the sum only when every included cost is a finite number:

```ts
const costs = events.filter((event) => !filter?.fromTs || event.ts >= filter.fromTs).map((event) => event.costUSD);
const knownCosts = costs.filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));
s.costUSD = costs.length === 0 ? 0 : knownCosts.length !== costs.length ? null : knownCosts.reduce((sum, cost) => sum + cost, 0);
```

Use the same rule in `groupByProvider`. Cards display “—” for null. Never turn unknown into zero.

- [ ] **Step 7: Prevent invalid provider/model pairs**

Changing provider clears the model selection. The model list is loaded for the selected provider. Save is disabled for an empty or absent model, and an invalid persisted pair produces a visible validation message.

Run: `pnpm test -- src/lib/providers/registry.spec.ts src/lib/providers/keyTest.spec.ts src/lib/providers/modelCatalog.spec.ts src/lib/usage/aggregate.spec.ts src/features/settings/SettingsScreen.spec.tsx src/features/chat/ResultCard.spec.tsx && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "fix: retain model metadata and account for cached usage"`.

**Acceptance criteria:** Live context/pricing survives selection; provider/model pairs cannot become invalid; costs are complete or explicitly unknown.

---

## Task 9: Protect credentials, CSP, Markdown, errors, and resource limits

**Files:**
- Create: `src/lib/security/credentialStore.ts`
- Create: `src/lib/security/redact.ts`
- Create: `src/lib/limits.ts`
- Modify: `src/lib/db/db.ts` and `src/lib/db/repos.ts`
- Modify: `src/state/settingsStore.ts`
- Modify: `src/features/settings/ProviderKeyCard.tsx`
- Modify: `src/features/chat/Markdown.tsx`
- Modify: `src/lib/providers/keyTest.ts` and `src/lib/chat/dispatch.ts`
- Modify: `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`
- Create: `src-tauri/src/credentials.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/lib/security/credentialStore.spec.ts`, `src/lib/security/redact.spec.ts`, and `src/features/chat/Markdown.security.spec.tsx`

- [ ] **Step 1: Write failing secret, redaction, and Markdown tests**

```ts
it("does not serialize a provider key into settings.main", async () => {
  await useSettingsStore.getState().setProviderKey("openrouter", "secret-value");
  expect(JSON.stringify(await getSetting("settings.main"))).not.toContain("secret-value");
});

it("removes remote images and unsafe links", () => {
  render(<Markdown text="![tracker](https://tracker.invalid/pixel) [run](javascript:alert(1))" />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/lib/security/credentialStore.spec.ts src/lib/security/redact.spec.ts src/features/chat/Markdown.security.spec.tsx`

Expected: **FAIL** because keys are plaintext settings, raw errors are returned, and Markdown uses default URL rendering.

- [ ] **Step 3: Implement the credential abstraction**

Use this interface:

```ts
export interface CredentialStore {
  get(providerId: ProviderId): Promise<string | null>;
  set(providerId: ProviderId, value: string): Promise<void>;
  clear(providerId: ProviderId): Promise<void>;
}
```

Tauri invokes `get_provider_key`, `set_provider_key`, and `delete_provider_key`. Web uses AES-GCM Web Crypto with a non-extractable IndexedDB key and stores only IV/ciphertext. If Web Crypto is unavailable, refuse persistence and show a setup error; never fall back to plaintext.

- [ ] **Step 4: Add serialized OS-keychain commands**

Add:

```toml
keyring = { version = "3", features = ["apple-native", "windows-native", "sync-secret-service"] }
```

Implement provider validation against the four known IDs, service `app.shura.local`, and commands using `Entry::new`, `set_password`, `get_password`, and `delete_credential`. Serialize Windows credential-store access with a mutex, return short user-facing errors, and never log keys or raw entry errors. Register the commands in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Migrate settings and change key editing**

On load, move legacy non-empty `providerKeys` through `CredentialStore`, then write settings without that field. If encryption/keychain migration fails, do not keep a plaintext copy: leave that provider empty, show a re-entry warning, and record only the bounded error. Keep keys in memory only. `ProviderKeyCard` uses a local draft, a 512-character limit, explicit save-on-blur, a clear button, and a programmatic password label. It tests only the saved value.

- [ ] **Step 6: Make settings writes ready, serialized, and rollback-safe**

Add `loaded`, `saving`, and `error` state. Serialize every settings write through one promise queue; persist a non-secret snapshot only after the credential write succeeds, restore the previous in-memory snapshot on failure, and expose the bounded error to the Settings dialog. Add this regression test:

```ts
it("rolls back a failed settings write and exposes a bounded error", async () => {
  const before = useSettingsStore.getState().timeoutMs;
  vi.spyOn(repos, "setSetting").mockRejectedValueOnce(new Error("C:\\Users\\name\\private\\settings"));
  await expect(useSettingsStore.getState().setTimeoutMs(33_000)).rejects.toThrow();
  expect(useSettingsStore.getState().timeoutMs).toBe(before);
  expect(useSettingsStore.getState().error).not.toContain("Users");
});
```

- [ ] **Step 7: Redact and cap external errors**

`redactExternalError` removes absolute filesystem paths, URL query strings, API-key-like long tokens, and response bodies, then caps the result at 240 Unicode code points. Apply it before messages, usage, toasts, and archive records. Never persist the original error object.

- [ ] **Step 8: Apply CSP and safe Markdown**

Set the production CSP to:

```text
default-src 'self'; connect-src 'self' https://openrouter.ai https://generativelanguage.googleapis.com https://api.minimax.io https://opencode.ai ipc: http://ipc.localhost; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'
```

If the installed Tauri schema supports `devCsp`, add only the Vite HMR origin for development; otherwise disable HMR in Tauri dev and keep browser HMR separate. Markdown renders remote images as alt text and links as non-clickable text, so model output cannot load a resource or control navigation.

- [ ] **Step 9: Enforce hard limits**

Create:

```ts
export const LIMITS = {
  apiKeyMax: 512,
  sharedPromptMax: 100_000,
  customPromptMax: 100_000,
  timeoutMinMs: 10_000,
  timeoutMaxMs: 300_000,
  responseMaxChars: 1_000_000,
  archiveMaxChars: 2_000_000,
} as const;
```

Reject oversized input before dispatch, abort a response over `responseMaxChars`, clamp timeout input, and quarantine an archive over `archiveMaxChars`.

Run: `pnpm test -- src/lib/security/credentialStore.spec.ts src/lib/security/redact.spec.ts src/features/chat/Markdown.security.spec.tsx src/features/settings/ProviderKeyCard.spec.tsx && cargo test --locked --manifest-path src-tauri/Cargo.toml && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "feat: protect provider credentials and untrusted output"`.

**Acceptance criteria:** Desktop keys use the OS store; web keys are encrypted or rejected; errors are bounded/redacted; remote output cannot fetch or navigate; inputs have hard limits.

---

## Task 10: Complete accessibility and responsive behavior

**Files:**
- Modify: `src/features/sessions/Sidebar.tsx`
- Modify: `src/features/settings/SettingsScreen.tsx`
- Modify: `src/features/chat/AddModelDialog.tsx`
- Modify: `src/features/chat/Composer.tsx`
- Modify: `src/features/chat/ResultCard.tsx` and `SummaryCard.tsx`
- Modify: `src/features/settings/ProviderKeyCard.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles/globals.css`
- Modify: `src/components/ui/dialog.tsx`
- Create: `src/features/accessibility.spec.tsx`
- Modify: `src/features/chat/ChatScreen.spec.tsx` and `src/features/settings/SettingsScreen.spec.tsx`

- [ ] **Step 1: Write failing keyboard and mobile tests**

```ts
it("closes Settings with Escape and restores focus", async () => {
  const user = userEvent.setup();
  render(<App />);
  const opener = screen.getByRole("button", { name: "الإعدادات" });
  await user.click(opener);
  expect(screen.getByRole("dialog", { name: "الإعدادات" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

it("activates a session row with Enter", async () => {
  const user = userEvent.setup();
  render(<App />);
  const row = screen.getByRole("button", { name: "جلسة" });
  row.focus();
  await user.keyboard("{Enter}");
  expect(useSessionsStore.getState().currentId).toBe("cs1");
});
```

- [ ] **Step 2: Run and verify RED**

Run: `pnpm test -- src/features/accessibility.spec.tsx`

Expected: **FAIL** because session rows are divs and Settings is a custom overlay.

- [ ] **Step 3: Apply the intended dark theme and contrast**

Add `document.documentElement.classList.add("dark")` before React renders. Align the light/dark values used by body, cards, dialogs, buttons, borders, and focus rings to WCAG AA. Add a `prefers-reduced-motion` rule that disables pulse/zoom animations. Verify the Add Model provider button and dialog background have at least 4.5:1 text contrast.

- [ ] **Step 4: Use Radix dialogs**

Replace the Settings custom overlay with `Dialog`, `DialogContent`, `DialogTitle`, and `DialogDescription`. Keep an explicit close button, logical `end-4` positioning, Escape/background close, focus containment, and opener focus restoration.

- [ ] **Step 5: Make controls semantic and labeled**

Render session rows as buttons or links with Enter/Space activation. Show rename/delete controls at keyboard focus, not only hover. Associate labels with search, provider, model, path, timeout, key, and custom-prompt inputs. Make model badges buttons and stop remove clicks from selecting a badge.

- [ ] **Step 6: Add mobile navigation**

Below 768px, `App` renders a menu button with `aria-expanded`, an overlay sidebar, and Escape/selection close behavior. Use `w-full md:w-64` for the sidebar and `min-w-0 flex-1` for main. At 390px, the main region has at least 320px usable width and the document has no horizontal overflow.

- [ ] **Step 7: Add status announcements and clipboard feedback**

Put streaming, stopped, error, model-loading, key-test, and recovery messages in appropriate polite/assertive live regions. Catch clipboard failures and announce success/failure.

Run: `pnpm test -- src/features/accessibility.spec.tsx src/features/chat/ChatScreen.spec.tsx src/features/settings/SettingsScreen.spec.tsx && pnpm typecheck`

Expected: **PASS**.

Commit: `git commit -m "fix: make Shura keyboard and mobile accessible"`.

**Acceptance criteria:** Keyboard-only users reach every primary action; dialogs trap/restore focus; status changes are announced; contrast passes AA; mobile content does not collapse.

---

## Task 11: Add complete build, test, and release gates

**Files:**
- Modify: `package.json` and `pnpm-lock.yaml`
- Modify: `vite.config.ts`
- Modify: `tsconfig.json` and `tsconfig.node.json`
- Create: `playwright.config.ts`
- Create: `e2e/app.spec.ts` and `e2e/mock-provider.ts`
- Create: `.github/workflows/ci.yml`
- Modify: `README.md` and `docs/environment.md`
- Modify: `src-tauri/tauri.conf.json` version

- [ ] **Step 1: Add only required development tools and scripts**

Run:

```powershell
pnpm add -D @types/node @vitest/coverage-v8 @playwright/test @axe-core/playwright
```

Set scripts:

```json
{
  "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json",
  "test": "vitest run",
  "test:coverage": "vitest run --coverage",
  "test:e2e": "playwright test",
  "check:all": "pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build",
  "build": "tsc --noEmit && tsc --noEmit -p tsconfig.node.json && vite build",
  "tauri:build:windows": "pnpm tauri build --bundles nsis"
}
```

Commit the pnpm-generated lockfile with the package change.

- [ ] **Step 2: Fix Vite/Node config typing and path loading**

Use `fileURLToPath(new URL("./src", import.meta.url))` for the alias. Keep the Node project strict and included in the normal typecheck script. Add these concrete Vite/Vitest limits so the release gate is reproducible:

```ts
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 },
    },
  },
});
```

The prior TS2688 failure must no longer occur in the standard gate. Record the actual output chunk sizes in `docs/environment.md`; a chunk above 1200 kB requires a documented code split before release.

- [ ] **Step 3: Add deterministic Playwright fixtures**

Configure a fixed Vite preview port and Chromium. Intercept all four provider origins and return fixed SSE. Record request bodies so E2E can assert history, cancellation, and prompt-faithful retry without contacting a provider.

- [ ] **Step 4: Add E2E scenarios**

Test: session-A draft isolation in B; partial stop surviving reload; historical custom retry; Settings Escape/focus; keyboard session navigation; 390px no-overflow; remote Markdown network blocking.

- [ ] **Step 5: Run the local full gate**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm check:all
pnpm test:e2e
```

Expected: typecheck, lint, coverage, production build, and mocked E2E all **PASS**. Set coverage thresholds at 80% statements and 75% branches; do not lower them to hide a failure.

- [ ] **Step 6: Add CI and native checks**

CI installs Node 24/pnpm 11 with a frozen lockfile, runs `check:all` and E2E, checks Rust format/check/tests, uploads Windows NSIS artifacts, and reports `cargo-audit` as unavailable when the tool is not installed. CI makes no real provider request and uploads no secrets.

Run in the documented x64 Native Tools environment:

```powershell
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles nsis
```

Expected: Rust tests execute and the NSIS installer is produced. MSI remains a documented host limitation until WiX/.NET 3.5 is installed.

- [ ] **Step 7: Reconcile version and documentation drift**

Choose `0.1.0` for the first hardened release and set both package and Tauri versions to it. Update README so test counts come from current output, scope says `$DOCUMENT/Shura/**`, desktop persistence states its packaged-smoke requirement, and the web credential fallback threat model is explicit. Update the design spec/ADR with stateful context, tombstones, operation IDs, and recovery.

Commit: `git commit -m "ci: add complete web and desktop release gates"`.

**Acceptance criteria:** A clean checkout reproduces typecheck, lint, unit/coverage, build, E2E, Rust tests, and the documented NSIS build without untracked local configuration.

---

## Task 12: Execute the packaged smoke and release decision

**Files:**
- No source changes unless a failing release-gate check identifies a defect.
- Create: `docs/reviews/2026-09-24-shura-hardening-smoke.md`
- Modify: `README.md` only with verified final limitations.

- [ ] **Step 1: Run the web smoke with mocked providers**

Run `pnpm dev --host 127.0.0.1` and manually exercise create, send, stop, reload, retry, summary, Settings, keyboard, and 390px layout. Do not enter a real key.

- [ ] **Step 2: Run the packaged Tauri smoke with a disposable key**

Build/install NSIS and verify: a real `Documents/Shura/sessions/<folder>/meta.json` write; Dexie reload; stopped partial text; exactly one prompt-faithful retry; archive deletion with no resurrection; malformed-archive warning; Settings Escape/focus; and no uncaught console errors.

This step is **NEEDS USER DECISION** until the user supplies a disposable test key or accepts mock-only desktop validation. Never use a production key.

- [ ] **Step 3: Record evidence and decide release status**

Write exact commands, OS, commit, package path, test counts, and skipped checks to `docs/reviews/2026-09-24-shura-hardening-smoke.md` using `PASS`, `FAIL`, `SKIPPED`, `BLOCKED`, and `NEEDS USER DECISION`.

Release only when every mandatory criterion is **PASS**: no cross-session leakage; stateful follow-ups include history; stop/reload/retry preserve text/status; deleted sessions do not return; packaged Tauri paths work; secrets are absent from settings/logs; keyboard/focus/contrast/mobile checks pass; full automated and Rust gates pass.

Do not create a tag, upload an installer, publish a release, or contact a provider without a separate explicit instruction.

---

## Global validation checklist

Run from the repository root after Tasks 1-11:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:coverage
pnpm build
pnpm audit --json
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
```

Required results:

- JavaScript typecheck includes root and Node configs: **PASS**.
- Lint: **PASS**.
- Unit/integration tests: **PASS**, with new persistence/security/operation branches covered.
- Coverage: **PASS** at configured thresholds.
- Web build: **PASS** with a documented bundle budget or approved code split.
- JavaScript audit: **PASS** or a reviewed, time-bounded exception with advisory IDs recorded.
- Rust format/check/test: **PASS**, with at least one Rust test executed.
- E2E: **PASS** using intercepted provider responses.
- Packaged Tauri filesystem smoke: **PASS** or **NEEDS USER DECISION** when no disposable key/GUI is available.
- No build output, tsbuildinfo, provider key, or user archive is added to Git.

## Definition of done

The implementation is complete only when it has:

- fixed the Tauri `$DOCUMENT` scope and verified a packaged archive write;
- session-keyed drafts, targets, messages, and operations;
- stateful context with explicit model-aware trimming;
- durable partial streams, terminal statuses, checkpoints, and startup reconciliation;
- immutable retries and one-operation-per-session coordination;
- atomic archive manifests, validated recovery, tombstones, and coordinated deletion;
- live model metadata, cache-aware/unknown cost handling, and shared provider headers;
- OS-backed desktop credentials, encrypted-or-rejected web credentials, redacted errors, CSP, Markdown restrictions, and hard limits;
- keyboard/focus/contrast/live-region/mobile behavior;
- reproducible web, Rust, E2E, and NSIS release gates;
- synchronized README/design/environment documentation and evidence.

No item is complete merely because lint or the existing unit suite passes.
