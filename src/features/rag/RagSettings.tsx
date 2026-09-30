import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/state/settingsStore";
import { ar } from "@/i18n/ar";
import { EMBEDDING_MODELS } from "@/lib/rag/embedder";
import { CHUNKING_PRESETS } from "@/lib/rag/chunker";
import { downloadModel } from "@/lib/rag/modelDownloader";
import { downloadRagData } from "@/lib/export/ragExporter";
import { importRagData, validateRagImportData } from "@/lib/export/ragImporter";
import { toast } from "sonner";
import type { RagSettings as RagSettingsType } from "@/types";

export function RagSettings() {
  const { ragSettings, setRagSettings } = useSettingsStore();
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ percent: number; loaded: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (patch: Partial<RagSettingsType>) => {
    void setRagSettings(patch);
  };

  const handleDownload = async () => {
    const modelId = ragSettings.embeddingModelId;
    setDownloading(modelId);
    setProgress(null);
    try {
      await downloadModel(modelId, (p) => setProgress(p));
    } catch (e) {
      console.error("Model download failed:", e);
    } finally {
      setDownloading(null);
      setProgress(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!validateRagImportData(data)) {
        toast.error(ar.ragImportError);
        return;
      }
      await importRagData(data);
      toast.success(ar.ragImportSuccess);
    } catch (err) {
      console.error("Import failed:", err);
      toast.error(ar.ragImportError);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4 text-sm" dir="rtl">
      {/* Embedding Model */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{ar.ragEmbeddingModel}</h3>
        <p className="text-xs text-sura-muted">{ar.ragEmbeddingModelDesc}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          value={ragSettings.embeddingModelId}
          onChange={(e) => update({ embeddingModelId: e.target.value })}
        >
          {EMBEDDING_MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={downloading !== null}
          onClick={() => void handleDownload()}
        >
          {downloading ? ar.ragDownloading : ar.ragDownloadModel}
        </Button>
        {progress && (
          <div className="space-y-1">
            <div className="h-2 bg-sura-border rounded-full overflow-hidden">
              <div
                className="h-full bg-sura-accent transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <p className="text-[11px] text-sura-muted">
              {progress.percent}% ({Math.round(progress.loaded / 1024 / 1024)}MB / {Math.round(progress.total / 1024 / 1024)}MB)
            </p>
          </div>
        )}
      </section>

      {/* Chunking */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragPreset}</h3>
        <div className="flex gap-2">
          {(["balanced", "precise", "contextual"] as const).map((preset) => (
            <Button
              key={preset}
              size="sm"
              variant={ragSettings.chunkSize === CHUNKING_PRESETS[preset].chunkSize ? "default" : "outline"}
              onClick={() =>
                update({
                  chunkSize: CHUNKING_PRESETS[preset].chunkSize,
                  chunkOverlap: CHUNKING_PRESETS[preset].overlap,
                })
              }
            >
              {preset === "balanced" ? ar.ragPresetBalanced : preset === "precise" ? ar.ragPresetPrecise : ar.ragPresetContextual}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted">
            {ar.ragChunkSize}: {ragSettings.chunkSize}
          </label>
          <Input
            type="range"
            min={100}
            max={2000}
            step={50}
            value={ragSettings.chunkSize}
            onChange={(e) => update({ chunkSize: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{ar.ragChunkSizeDesc}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted">
            {ar.ragChunkOverlap}: {ragSettings.chunkOverlap}
          </label>
          <Input
            type="range"
            min={0}
            max={300}
            step={25}
            value={ragSettings.chunkOverlap}
            onChange={(e) => update({ chunkOverlap: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{ar.ragChunkOverlapDesc}</p>
        </div>
      </section>

      {/* File Persistence */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragPersistence}</h3>
        <p className="text-xs text-sura-muted">{ar.ragPersistenceDesc}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          value={ragSettings.defaultPersistence}
          onChange={(e) => update({ defaultPersistence: e.target.value as RagSettingsType["defaultPersistence"] })}
        >
          <option value="persistent">{ar.ragPersistent}</option>
          <option value="temp">{ar.ragTemp}</option>
          <option value="ask">{ar.ragAsk}</option>
        </select>
      </section>

      {/* Temp Cleanup */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragTempCleanup}</h3>
        <p className="text-xs text-sura-muted">{ar.ragTempCleanupDesc}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          value={ragSettings.tempCleanup}
          onChange={(e) => update({ tempCleanup: e.target.value as RagSettingsType["tempCleanup"] })}
        >
          <option value="after_turn">{ar.ragAfterTurn}</option>
          <option value="after_session">{ar.ragAfterSession}</option>
          <option value="manual">{ar.ragManual}</option>
        </select>
      </section>

      {/* Search Mode */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragSearchMode}</h3>
        <p className="text-xs text-sura-muted">{ar.ragSearchModeDesc}</p>
        <select
          className="w-full bg-sura-bg border border-sura-border rounded p-2 text-sm"
          value={ragSettings.defaultSearchMode}
          onChange={(e) => update({ defaultSearchMode: e.target.value as RagSettingsType["defaultSearchMode"] })}
        >
          <option value="hybrid">{ar.ragHybrid}</option>
          <option value="semantic">{ar.ragSemantic}</option>
          <option value="keyword">{ar.ragKeyword}</option>
        </select>
        <div className="space-y-1">
          <label className="text-xs text-sura-muted">
            {ar.ragResultsCount}: {ragSettings.searchResultCount}
          </label>
          <Input
            type="range"
            min={1}
            max={20}
            value={ragSettings.searchResultCount}
            onChange={(e) => update({ searchResultCount: Number(e.target.value) })}
            className="w-full"
          />
          <p className="text-[11px] text-sura-muted">{ar.ragResultsCountDesc}</p>
        </div>
      </section>

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

      {/* External Folders Auto Reindex */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">{ar.ragAutoReindex}</h3>
            <p className="text-xs text-sura-muted">{ar.ragAutoReindexDesc}</p>
          </div>
          <Switch
            checked={ragSettings.autoReindexFolders}
            onCheckedChange={(v) => update({ autoReindexFolders: v })}
          />
        </div>
      </section>

      {/* Export RAG Data */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragExportData}</h3>
        <p className="text-xs text-sura-muted">{ar.ragExportDataDesc}</p>
        <Button size="sm" variant="outline" onClick={() => void downloadRagData()}>
          {ar.ragExportDataButton}
        </Button>
      </section>

      {/* Import RAG Data */}
      <section className="space-y-2 border-t border-sura-border pt-3">
        <h3 className="text-sm font-medium">{ar.ragImportData}</h3>
        <p className="text-xs text-sura-muted">{ar.ragImportDataDesc}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => void handleImportFile(e)}
        />
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          {ar.ragImportDataButton}
        </Button>
      </section>
    </div>
  );
}
