# Shura (شورى) — Troubleshooting

Common issues, solutions, and how to report bugs.

---

## 1. Model fails to load / errors on send

**Symptoms:** A result card shows an error, or the model never starts streaming.

**Causes and fixes:**

- **Missing or invalid API key.** Open Settings → Providers and re-enter the key, then press the live-test button. A failed test means the key is wrong or expired.
- **Provider is down or rate-limited.** Try again in a few minutes, or switch to a different model/provider.
- **Timeout too short.** Increase the timeout in Settings → Timeout (default 120s). Large models on slow connections may need more time.
- **CORS blocked (web only).** OpenCode Go is blocked by CORS in the web version — it shows "requires desktop app". Use the desktop version for OpenCode Go. OpenRouter, Gemini, and MiniMax work in the browser.
- **No models added.** Click the + button in the composer and add at least one model before sending.

---

## 2. Search returns no results

**Symptoms:** The model says "No relevant documents found" or search returns nothing.

**Causes and fixes:**

- **No documents indexed.** Upload files first (composer paperclip or Settings → RAG Files). Check the RAG status chip at the top of the chat.
- **Embedding model not downloaded.** Go to Settings → RAG Settings and press Download next to the embedding model. Wait for it to finish.
- **Wrong search mode.** If you are searching for exact terms, try Keyword mode. For meaning-based queries, try Semantic or Hybrid. Change in Settings → RAG Settings → Search mode.
- **Query too specific or too broad.** Try rephrasing. Hybrid mode is the most forgiving.
- **Documents still indexing.** Wait for the status to change from "indexing" to "indexed" in the file list.

---

## 3. Indexing fails

**Symptoms:** A file shows "error" status, or indexing hangs.

**Causes and fixes:**

- **Unsupported file type.** Supported: PDF, MD, TXT, JSON, CSV, LOG. Other formats are skipped.
- **File too large or corrupted.** Try a smaller file or re-export it.
- **Embedding model missing.** Download it in Settings → RAG Settings.
- **Folder path not found (external folders).** Check the path in Settings → RAG External Folders. The folder must exist and be accessible.
- **ONNX model failed to load.** Reload the app and retry. If it persists, check available disk space.

---

## 4. Other common issues

### Session history is lost

Sessions are stored in IndexedDB (browser) or recovered from on-disk folders (desktop). Clearing browser data will lose web sessions. On desktop, the folders under the session directory are the backup.

### Context meter shows "?" or wrong percentage

The estimate is approximate and Arabic-aware (about 2.5 characters per token for Arabic and 4 for Latin, weighted by the mix; src/lib/tokens/estimate.ts). If the model's context length is unknown, the meter shows "?". This is expected, not a bug.

### App is slow with many documents

Reduce the number of indexed documents, or increase chunk size in RAG settings (fewer, larger chunks). Disable auto-reindex for folders you don't need live.

### Keys don't persist after reload

On desktop, keys are stored in the OS keychain. On web, they are in IndexedDB. If they don't persist, check that you are not in private/incognito mode (which may clear storage).

---

## 5. How to report bugs

When filing a bug report, include:

1. **App version** — see `package.json`, `src-tauri/tauri.conf.json`, or the installer file name.
2. **Environment** — web (browser + version) or desktop (OS + version).
3. **Steps to reproduce** — what you did, what you expected, what happened.
4. **Provider and model** — which provider/model was involved.
5. **Error messages** — copy the exact error text from the result card or console.
6. **Logs** — if relevant, note any console errors (F12 → Console on web).

**Do not** include your API keys in bug reports. The app redacts keys from error messages, but double-check before posting.
