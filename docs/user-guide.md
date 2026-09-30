# Shura (شورى) — User Guide

Shura is a local-first AI chat application with a parallel multi-model design: one question goes out at the same instant to several providers/models you choose, and each answer streams back in its own card for side-by-side comparison. The UI is Arabic (RTL). There is no backend — your device talks directly to the providers with your own API keys.

This guide covers getting started, using RAG (document search), using the chat, settings, and keyboard shortcuts.

---

## 1. Getting Started

### Install and run

**Web version (easiest):**

```bash
pnpm install
pnpm dev
```

Then open the local URL Vite prints (default http://localhost:5173).

**Desktop version (Tauri 2):**

```bash
pnpm tauri dev      # dev window
pnpm tauri build    # production build (NSIS installer on Windows)
```

The desktop shell gives you CORS-free transport and real file writing under `Documents\Shura`. See `README.md` for the full environment notes.

### First run

1. **Add API keys.** Click the settings icon (gear) in the sidebar, or press `Ctrl+,` / `Ctrl+Shift+S`. For each provider (OpenRouter, Google Gemini, MiniMax, OpenCode Go) enter your API key in its card and press the live-test button to verify it.
2. **Add models.** In the composer at the bottom, click the **+** (add model) button and pick a provider + model. Add as many as you want — each becomes a target.
3. **Ask your first question.** Type in the shared prompt box and press **Send** (or `Ctrl+Enter`). Every target streams its answer live in its own card.

### Providers at a glance

| Provider | Notes |
|---|---|
| **OpenRouter** | Live model list fetched from the provider (cached). |
| **Google Gemini** | Static model list (Gemini 2.5 Pro / Flash). |
| **MiniMax** | Static model list. |
| **OpenCode Go** | **Desktop only** — blocked by CORS in the web version. |

---

## 2. Using RAG (Document Search)

Shura can index your documents and let the model search them during a chat. Embeddings run **locally with ONNX** — no document content is sent to any provider for indexing.

### 2.1 Upload documents

You can upload files in two places:

- **Composer paperclip button** — attaches files to the current session.
- **Settings → RAG Files** — drag-and-drop area and upload button.

**Supported formats:** PDF, MD, TXT, JSON, CSV, LOG.

Each file is chunked, embedded, and indexed. The file list shows status (indexing / indexed / error), chunk count, and size. Files marked **temp** are cleaned up automatically based on your temp-cleanup setting.

### 2.2 Index external folders

**Settings → RAG External Folders → Add folder.**

- Enter a folder path and an optional label.
- Toggle **auto-reindex** per folder to keep it up to date.
- Removing a folder deletes all indexed files from it.

### 2.3 Search

Search happens through the model's `search_documents` tool. When you ask about your files, past conversations, or anything that might be in your documents, the model searches and returns relevant excerpts with source file names.

**Search modes** (Settings → RAG Settings):

| Mode | What it does |
|---|---|
| **Hybrid** (default) | Combines semantic (vector) + keyword (BM25) results. |
| **Semantic** | Vector similarity only — best for meaning-based queries. |
| **Keyword** | BM25 keyword match only — best for exact terms. |

**Scopes:** all, uploads, sessions, external.

### 2.4 RAG settings

All under **Settings → RAG Settings**:

- **Embedding model** — local ONNX model (default `multilingual-e5-small`). Use the **Download** button to fetch it (one-time, progress shown).
- **Chunking preset** — Balanced / Precise / Contextual, or fine-tune **chunk size** (100–2000) and **chunk overlap** (0–300).
- **File persistence** — persistent, temp, or ask-per-file.
- **Temp cleanup** — after turn, after session, or manual.
- **Search result count** — 1–20 results returned per search.
- **Agent mode** — `always` (model can always search) or `toggle` (a switch appears in the composer).
- **Auto-reindex folders** — global on/off for external folders.

---

## 3. Using the Chat

### 3.1 Multi-model parallel sending

- Add multiple targets (models) via the **+** button.
- Write a **shared prompt** — sent to all targets.
- Toggle **sync mode** (link icon) to write a **custom prompt per model** (advanced options). Custom prompts are appended to the shared prompt; with no shared prompt, the custom prompt is used alone.
- Press **Send** — all targets stream simultaneously, each in its own card.

### 3.2 Sessions

- **New session** — sidebar **+** button or `Ctrl+N`.
- **Switch** — click a session in the sidebar.
- **Rename** — hover a session, click the edit (pencil) icon.
- **Delete** — hover, click the trash icon (asks for confirmation).
- **Search sessions** — the search box in the sidebar, or `Ctrl+K`.

Sessions persist in a local database (Dexie/IndexedDB). On desktop, each session is also written to disk under `Documents\Shura\sessions\<session-folder>` as:

- `session.md` — human-readable transcript (one section per turn).
- `meta.json` — session metadata used for recovery.
- One file per model result.

If the database is lost, sessions are recovered from these folders on startup (desktop only).

### 3.3 Context mode

Toggle in the composer (switch near the context meter):

- **Stateful** (default) — each send includes the session's prior completed turns (trimmed to 80% of the target model's context limit).
- **Stateless** — only the current question is sent.

The choice is stored per session.

### 3.4 Layout

The **⇄** toggle switches result cards between **vertical** and **horizontal** layout. Your choice is saved per session.

### 3.5 Summary

The **✦ Extract summary** button sends the last turn's results to the session's **primary model** and returns a composite summary. Set the primary model in **Settings → Primary model**.

### 3.6 Context meter & tokens

The meter next to the composer shows estimated token usage against the focused model's context limit. The estimate is approximate (chars ÷ 4) — treat it as a guide, not an exact bill.

### 3.7 Retry & stop

- **Retry** — each result card has a retry button to re-run just that model.
- **Stop** — the stop button (or `Escape`) halts the current streaming operation.

---

## 4. Settings Overview

Open settings via the sidebar gear icon `Ctrl+,`, or `Ctrl+Shift+S`.

| Section | What it controls |
|---|---|
| **Providers** | API keys (with live test), one card per provider. |
| **Primary model** | The model used for summaries and normal turns. |
| **Session directory** | Fixed to `Documents\Shura` (desktop). |
| **RAG settings** | Embedding model, chunking, persistence, search mode, agent mode, auto-reindex. |
| **RAG files** | Uploaded document list, upload/delete, clear temp. |
| **RAG external folders** | Folder indexing with auto-reindex toggles. |
| **Timeout** | Request timeout in seconds (min 10). |

Settings also has a search box and a table of contents to jump between sections.

---

## 5. Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Send the current prompt |
| `Ctrl+K` | Focus the session search box |
| `Ctrl+N` | New session |
| `Ctrl+,` or `Ctrl+Shift+S` | Open settings |
| `Escape` | Stop the current generation (when not typing in a field) |
| `?` | Open this shortcut help (when not typing in a field) |
| `Ctrl+/` | Toggle light/dark theme |
| `Ctrl+1`–`Ctrl+9` | Focus target model 1–9 |

---

## 6. Data & Privacy

- **Keys stay local.** API keys are stored on your device (OS keychain on desktop, IndexedDB on web) and only leave your device inside a direct call to the matching provider.
- **No server.** No backend, no accounts, no tracking.
- **Desktop is safest for real keys.** On the web, keys are protected from other sites but not from code running in the page origin. Use the desktop app for real keys; the web version is fine for trying things out or with limited keys.

See `README.md` for the full security model and known limitations.
